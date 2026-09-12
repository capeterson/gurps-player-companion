import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type Page, expect, test } from '@playwright/test';

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
  if (process.env.MCP_E2E_BUILT_SERVER !== '1') return;
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

    // Exercise the actual browser login return path instead of carrying the
    // registration session directly into consent.
    await page.evaluate(() => {
      localStorage.removeItem('gpc.tokenPair.v1');
      localStorage.removeItem('gpc.access');
      localStorage.removeItem('gpc.refresh');
    });

    const denied = pkceAttempt();
    await page.goto(denied.url);
    await expect(page).toHaveURL(/\/login$/);
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
          'gpc_get_current_user',
          'gpc_create_character',
          'gpc_update_character',
          'gpc_get_character_history',
        ]),
      );

      const me = toolEnvelope<{ email: string; displayName: string }>(
        await client.callTool({ name: 'gpc_get_current_user', arguments: {} }),
      );
      expect(me.body).toMatchObject({ email, displayName: 'MCP E2E Player' });

      const characterName = `SDK Hero ${suffix()}`;
      const created = toolEnvelope<{ id: string; name: string; st: number; dx: number }>(
        await client.callTool({
          name: 'gpc_create_character',
          arguments: {
            body: { name: characterName },
            idempotencyKey: `e2e-create-${randomUUID()}`,
          },
        }),
      );
      expect(created.body).toMatchObject({ name: characterName, st: 10, dx: 10 });
      expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/i);

      // The player sees the MCP create through the HTTP cursor while WebSocket
      // delivery is blocked for the entire browser session.
      await page.goto('/characters');
      const characterLink = page.getByRole('link', { name: new RegExp(characterName) });
      await expect(characterLink).toBeVisible({ timeout: 20_000 });
      expect(successfulCursorPulls).toBeGreaterThan(0);
      expect(blockedWebSockets).toBeGreaterThan(0);
      await characterLink.click();
      await expect(page).toHaveURL(new RegExp(`/characters/${created.body.id}$`));

      await page
        .locator('.panel-tab')
        .filter({ hasText: /^History/ })
        .click();
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
          name: 'gpc_get_character_history',
          arguments: { path: { id: created.body.id } },
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
      const st = page.getByRole('textbox', { name: /st base/i });
      const dx = page.getByRole('textbox', { name: /dx base/i });
      await expect(st).toHaveValue('10');
      await expect(dx).toHaveValue('10');
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await st.fill('11');
      await st.blur();
      await expect(st).toHaveValue('11');
      await expect(page.getByLabel(/offline/i)).toBeVisible();

      toolEnvelope(
        await client.callTool({
          name: 'gpc_update_character',
          arguments: {
            path: { id: created.body.id },
            body: { dx: 12 },
            idempotencyKey: `e2e-update-${randomUUID()}`,
          },
        }),
      );
      const beforeReconnect = toolEnvelope<{ st: number; dx: number }>(
        await client.callTool({
          name: 'gpc_get_character',
          arguments: { path: { id: created.body.id } },
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
                name: 'gpc_get_character',
                arguments: { path: { id: created.body.id } },
              }),
            );
            return current.body.st;
          },
          { timeout: 30_000 },
        )
        .toBe(11);
      await expect(page.getByLabel(/all changes saved/i)).toBeVisible({ timeout: 30_000 });
      await expect(st).toHaveValue('11', { timeout: 20_000 });
      await expect(dx).toHaveValue('12', { timeout: 20_000 });
      expect(successfulCursorPulls).toBeGreaterThan(cursorCountBeforeReconnect);

      const converged = toolEnvelope<{ st: number; dx: number }>(
        await client.callTool({
          name: 'gpc_get_character',
          arguments: { path: { id: created.body.id } },
        }),
      );
      expect(converged.body).toMatchObject({ st: 11, dx: 12 });

      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Connected apps' })).toBeVisible();
      const appName = page.getByText(CLIENT_NAME, { exact: true });
      await expect(appName).toBeVisible();
      const appCard = appName.locator('..').locator('..');
      await appCard.getByRole('button', { name: 'Revoke', exact: true }).click();
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
