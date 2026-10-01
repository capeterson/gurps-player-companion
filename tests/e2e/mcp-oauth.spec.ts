import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type Page, expect, test } from '@playwright/test';
import { SignJWT, decodeJwt } from 'jose';
import { selectCharacterSection } from './character-navigation';
import { captureReviewScreenshot } from './review-artifacts';

/**
 * Full delegated-access acceptance test. The app must be started with a
 * matching pre-registered public client, for example:
 *
 * OAUTH_CLIENTS='[{"clientId":"playwright-mcp","name":"Playwright MCP Agent","redirectUris":["http://localhost:3001/oauth/callback"],"scopes":["gpc:read","gpc:write","gpc:manage"]}]'
 *
 * The callback is deliberately just a same-origin browser landing page. The
 * test captures its query string and performs the public-client code exchange.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
const CLIENT_ID = process.env.MCP_E2E_CLIENT_ID ?? 'playwright-mcp';
const CLIENT_NAME = process.env.MCP_E2E_CLIENT_NAME ?? 'Playwright MCP Agent';
const REDIRECT_URI =
  process.env.MCP_E2E_REDIRECT_URI ?? new URL('/oauth/callback', BASE_URL).toString();
const RESOURCE = new URL('/mcp', BASE_URL).toString();
const PASSWORD = 'CorrectHorseBatteryStaple1';
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-only-secret-replace-me-replace-me-replace-me';

interface AuthorizationAttempt {
  readonly state: string;
  readonly verifier: string;
  readonly url: string;
}

interface TokenResponse {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

interface ToolEnvelope<T> {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: T;
}

function suffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function pkceAttempt(): AuthorizationAttempt {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const url = new URL('/oauth/authorize', BASE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'gpc:read gpc:write gpc:manage',
    state,
    resource: RESOURCE,
  }).toString();
  return { state, verifier, url: url.toString() };
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('MCP E2E Player');
  await page.getByLabel(/^password\b/i).fill(PASSWORD);
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
}

async function requireBuiltServiceWorker(page: Page): Promise<void> {
  if (process.env.MCP_E2E_BUILT_SERVER !== '1' && process.env.PLAYWRIGHT_BUILT_SERVER !== '1')
    return;
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  }
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 15_000,
    })
    .toBe(true);
}

async function makeBrowserSessionStale(page: Page): Promise<void> {
  const stored = await page.evaluate(() => localStorage.getItem('gpc.tokenPair.v1'));
  if (!stored) throw new Error('registered browser session is missing');
  const pair = JSON.parse(stored) as { accessToken: string } & Record<string, unknown>;
  const current = decodeJwt(pair.accessToken);
  if (typeof current.sub !== 'string') throw new Error('browser access token is missing its user');
  const now = Math.floor(Date.now() / 1000);
  const staleAccessToken = await new SignJWT({
    type: 'access',
    av: Number.isInteger(current.av) ? Number(current.av) : 0,
    auth_time: now - 601,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(current.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 15 * 60)
    .sign(new TextEncoder().encode(JWT_SECRET));
  await page.evaluate(
    ({ original, accessToken }) => {
      localStorage.setItem(
        'gpc.tokenPair.v1',
        JSON.stringify({ ...(JSON.parse(original) as object), accessToken }),
      );
    },
    { original: stored, accessToken: staleAccessToken },
  );
}

async function beginAuthorization(page: Page, attempt: AuthorizationAttempt): Promise<void> {
  await page.goto(attempt.url);
  await expect(page.getByRole('heading', { name: `Authorize ${CLIENT_NAME}` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Read your characters, campaigns/i)).toBeVisible();
  await expect(page.getByText(/Create and update ordinary player/i)).toBeVisible();
  await expect(page.getByText(/Delete content and manage invitations/i)).toBeVisible();
}

async function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  const response = await fetch(new URL('/oauth/token', BASE_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  });
  const body = (await response.json()) as
    | TokenResponse
    | { error?: string; error_description?: string };
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ token_type: 'Bearer', scope: 'gpc:read gpc:write gpc:manage' });
  return body as TokenResponse;
}

function toolEnvelope<T>(result: {
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
  readonly content?: unknown;
}): ToolEnvelope<T> {
  const diagnostic = JSON.stringify({
    isError: result.isError,
    structuredContent: result.structuredContent,
    content: result.content,
  });
  expect(result.isError, `sanitized MCP result: ${diagnostic}`).not.toBe(true);
  expect(result.structuredContent).toEqual(
    expect.objectContaining({ status: expect.any(Number), body: expect.anything() }),
  );
  const envelope = result.structuredContent as ToolEnvelope<T>;
  expect(envelope.status).toBeGreaterThanOrEqual(200);
  expect(envelope.status).toBeLessThan(300);
  return envelope;
}

test.describe('delegated MCP OAuth acceptance', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test('browser consent, SDK operations, cursor/history convergence, offline replay, and revoke', async ({
    page,
  }) => {
    let blockedWebSockets = 0;
    let successfulCursorPulls = 0;
    let successfulOperationPushes = 0;
    await page.routeWebSocket('**/api/v1/sync/ws**', (socket) => {
      blockedWebSockets++;
      socket.close();
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/v1/sync/cursor') && response.ok()) {
        successfulCursorPulls++;
      }
      if (response.url().includes('/api/v1/sync/operations') && response.ok()) {
        successfulOperationPushes++;
      }
    });

    const email = `mcp-oauth-${suffix()}@example.com`;
    await register(page, email);
    await requireBuiltServiceWorker(page);

    // A valid but no-longer-recent browser session must return to login before
    // any consent controls render, while retaining the complete OAuth request.
    await makeBrowserSessionStale(page);

    const denied = pkceAttempt();
    await page.goto(denied.url);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Authorize', exact: true })).toHaveCount(0);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password$/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: `Authorize ${CLIENT_NAME}` })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Deny', exact: true }).click();
    await page.waitForURL((url) => url.pathname === new URL(REDIRECT_URI).pathname);
    const deniedCallback = new URL(page.url());
    expect(deniedCallback.searchParams.get('error')).toBe('access_denied');
    expect(deniedCallback.searchParams.get('state')).toBe(denied.state);

    const approved = pkceAttempt();
    await beginAuthorization(page, approved);
    await page.getByRole('button', { name: 'Authorize', exact: true }).click();
    await page.waitForURL((url) => url.pathname === new URL(REDIRECT_URI).pathname);
    const approvedCallback = new URL(page.url());
    expect(approvedCallback.searchParams.get('state')).toBe(approved.state);
    const code = approvedCallback.searchParams.get('code');
    expect(code).toBeTruthy();
    const tokens = await exchangeCode(code as string, approved.verifier);

    const client = new Client({ name: 'gpc-playwright-acceptance', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
      requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
    });
    await client.connect(transport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'get_current_user',
          'character',
          'get_character',
          'get_character_history',
        ]),
      );
      expect(tools.tools).toHaveLength(51);
      expect(tools.tools.some((tool) => tool.name.startsWith('gpc_'))).toBe(false);
      expect(
        tools.tools.find((tool) => tool.name === 'get_character')?.annotations?.readOnlyHint,
      ).toBe(true);
      expect(tools.tools.every((tool) => !tool._meta?.ui)).toBe(true);
      expect((await client.listResources()).resources).toEqual([]);
      await expect(
        client.readResource({ uri: 'ui://gurps-player-companion/character.html' }),
      ).rejects.toThrow();

      await page.goto('/settings');
      const experiments = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Experimental Features', exact: true }) });
      const mcpUiToggle = experiments.getByRole('checkbox', { name: 'MCP UI', exact: true });
      await expect(mcpUiToggle).not.toBeChecked();
      for (const width of [320, 639, 640, 641, 767, 768, 769]) {
        await page.setViewportSize({ width, height: 900 });
        await experiments.scrollIntoViewIfNeeded();
        await expect(mcpUiToggle).toBeVisible();
        const box = await mcpUiToggle.boundingBox();
        expect(box).not.toBeNull();
        if (!box) throw new Error('MCP UI toggle geometry unavailable');
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(
          await page.locator('html').evaluate((root) => root.scrollWidth <= root.clientWidth),
        ).toBe(true);
        await experiments.screenshot({
          path: test.info().outputPath(`experimental-features-${width}.png`),
        });
      }
      const enabledSave = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/experimental-features') &&
          response.request().method() === 'PATCH',
      );
      await mcpUiToggle.check();
      expect((await enabledSave).status()).toBe(200);
      const enabledTools = await client.listTools();
      expect(enabledTools.tools.find((tool) => tool.name === 'get_character')?._meta?.ui).toEqual({
        resourceUri: 'ui://gurps-player-companion/character.html',
      });
      expect((await client.listResources()).resources).toHaveLength(1);
      const ui = await client.readResource({ uri: 'ui://gurps-player-companion/character.html' });
      expect(ui.contents[0]?.mimeType).toBe('text/html;profile=mcp-app');
      expect(ui.contents[0] && 'text' in ui.contents[0] ? ui.contents[0].text : '').toContain(
        '<!doctype html>',
      );
      await page.reload();
      await expect(mcpUiToggle).toBeChecked();
      const disabledSave = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/experimental-features') &&
          response.request().method() === 'PATCH',
      );
      await mcpUiToggle.uncheck();
      expect((await disabledSave).status()).toBe(200);
      expect((await client.listTools()).tools.every((tool) => !tool._meta?.ui)).toBe(true);
      expect((await client.listResources()).resources).toEqual([]);
      await expect(
        client.readResource({ uri: 'ui://gurps-player-companion/character.html' }),
      ).rejects.toThrow();
      const characterTool = tools.tools.find((tool) => tool.name === 'character');
      expect(characterTool?.annotations?.readOnlyHint).toBe(false);
      expect(characterTool?.inputSchema.anyOf).toEqual(
        expect.arrayContaining(
          ['create', 'update', 'delete'].map((action) =>
            expect.objectContaining({
              properties: expect.objectContaining({
                action: { type: 'string', const: action },
              }),
            }),
          ),
        ),
      );

      const me = toolEnvelope<{ email: string; displayName: string }>(
        await client.callTool({ name: 'get_current_user', arguments: {} }),
      );
      expect(me.body).toMatchObject({ email, displayName: 'MCP E2E Player' });

      const characterName = `SDK Hero ${suffix()}`;
      const created = toolEnvelope<{
        acknowledged: true;
        resourceId: string;
        revision: number;
      }>(
        await client.callTool({
          name: 'character',
          arguments: {
            action: 'create',
            body: { name: characterName },
            idempotencyKey: `e2e-create-${randomUUID()}`,
          },
        }),
      );
      expect(created.body).toMatchObject({ acknowledged: true });
      expect(created.body.revision).toBeGreaterThanOrEqual(0);
      expect(created.body.resourceId).toMatch(/^[0-9a-f-]{36}$/i);
      const characterId = created.body.resourceId;
      const createdDetail = toolEnvelope<{ name: string; st: number; dx: number }>(
        await client.callTool({
          name: 'get_character',
          arguments: { path: { id: characterId } },
        }),
      );
      expect(createdDetail.body).toMatchObject({ name: characterName, st: 10, dx: 10 });

      // The player sees the MCP create through the HTTP cursor while WebSocket
      // delivery is blocked for the entire browser session.
      await page.goto('/characters');
      const characterLink = page.getByRole('link', { name: new RegExp(characterName) });
      await expect(characterLink).toBeVisible({ timeout: 20_000 });
      expect(successfulCursorPulls).toBeGreaterThan(0);
      expect(blockedWebSockets).toBeGreaterThan(0);
      await characterLink.click();
      await expect(page).toHaveURL(new RegExp(`/characters/${characterId}$`));

      await selectCharacterSection(page, 'History');
      await expect(
        page.getByText(`Created character ${characterName}`, { exact: true }),
      ).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText(`MCP E2E Player via ${CLIENT_NAME}`, { exact: true }),
      ).toBeVisible();

      const agentHistory = toolEnvelope<
        Array<{ summary: string; agentClientName?: string | null }>
      >(
        await client.callTool({
          name: 'get_character_history',
          arguments: { path: { id: characterId } },
        }),
      );
      expect(agentHistory.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            summary: `Created character ${characterName}`,
            agentClientName: CLIENT_NAME,
          }),
        ]),
      );

      // Keep a browser edit pending offline while the agent changes another
      // field. On reconnect the stale-base retry must retain ST=11, then the
      // normal HTTP cursor must bring in the agent's DX=12 without a WS nudge.
      // Attributes live on Overview; History was the last section opened.
      await selectCharacterSection(page, 'Overview');
      const st = page.getByRole('textbox', { name: /st base/i });
      const dx = page.getByRole('textbox', { name: /dx base/i });
      await expect(st).toHaveValue('10');
      await expect(dx).toHaveValue('10');
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await st.fill('11');
      await st.blur();
      await expect(st).toHaveValue('11');
      await expect(page.getByLabel(/offline/i).filter({ visible: true })).toBeVisible();

      toolEnvelope(
        await client.callTool({
          name: 'character',
          arguments: {
            action: 'update',
            path: { id: characterId },
            body: { dx: 12 },
            idempotencyKey: `e2e-update-${randomUUID()}`,
          },
        }),
      );
      const beforeReconnect = toolEnvelope<{ st: number; dx: number }>(
        await client.callTool({
          name: 'get_character',
          arguments: { path: { id: characterId } },
        }),
      );
      expect(beforeReconnect.body).toMatchObject({ st: 10, dx: 12 });

      const cursorCountBeforeReconnect = successfulCursorPulls;
      const pushCountBeforeReconnect = successfulOperationPushes;
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect
        .poll(() => successfulOperationPushes, { timeout: 30_000 })
        .toBeGreaterThan(pushCountBeforeReconnect);
      await expect
        .poll(
          async () => {
            const current = toolEnvelope<{ st: number }>(
              await client.callTool({
                name: 'get_character',
                arguments: { path: { id: characterId } },
              }),
            );
            return current.body.st;
          },
          { timeout: 30_000 },
        )
        .toBe(11);
      await expect(page.getByLabel(/all changes saved/i).filter({ visible: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(st).toHaveValue('11', { timeout: 20_000 });
      await expect(dx).toHaveValue('12', { timeout: 20_000 });
      expect(successfulCursorPulls).toBeGreaterThan(cursorCountBeforeReconnect);

      const converged = toolEnvelope<{ st: number; dx: number }>(
        await client.callTool({
          name: 'get_character',
          arguments: { path: { id: characterId } },
        }),
      );
      expect(converged.body).toMatchObject({ st: 11, dx: 12 });

      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Connected apps' })).toBeVisible();
      const appName = page.getByText(CLIENT_NAME, { exact: true });
      await expect(appName).toBeVisible();
      const appCard = appName.locator('..').locator('..');
      await appCard.getByRole('button', { name: 'Revoke', exact: true }).click();
      const revokeDialog = page.getByRole('dialog', { name: 'Revoke connected app?' });
      await expect(revokeDialog).toBeVisible();
      await expect(revokeDialog).toContainText(CLIENT_NAME);
      await expect(revokeDialog).toContainText('invalidates all of its access and refresh tokens');
      const modalBox = revokeDialog.locator('.modal-box');
      await expect
        .poll(() => modalBox.evaluate((element) => getComputedStyle(element).opacity))
        .toBe('1');
      const dialogBox = await modalBox.boundingBox();
      const viewport = page.viewportSize();
      expect(dialogBox).not.toBeNull();
      expect(viewport).not.toBeNull();
      if (!dialogBox || !viewport) throw new Error('revoke dialog geometry unavailable');
      expect(dialogBox.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox.y).toBeGreaterThanOrEqual(0);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width);
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height);
      await expect
        .poll(() =>
          modalBox.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const topmost = document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            return topmost !== null && element.contains(topmost);
          }),
        )
        .toBe(true);
      await captureReviewScreenshot(page, {
        path: 'test-results/connected-app-revoke-confirmation-320.png',
        fullPage: false,
      });
      await revokeDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(revokeDialog).not.toBeVisible();
      await expect(appName).toBeVisible();
      await appCard.getByRole('button', { name: 'Revoke', exact: true }).click();
      await revokeDialog.getByRole('button', { name: 'Revoke', exact: true }).click();
      await expect(page.getByText('Connected app revoked', { exact: true })).toBeVisible();
      await expect(appName).toHaveCount(0);

      await expect(client.listTools()).rejects.toThrow();
      const rejected = await fetch(RESOURCE, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }),
      });
      expect(rejected.status).toBe(401);
      expect(rejected.headers.get('www-authenticate')).toContain('invalid_token');
    } finally {
      await client.close().catch(() => undefined);
      await page.context().setOffline(false);
    }
  });
});
