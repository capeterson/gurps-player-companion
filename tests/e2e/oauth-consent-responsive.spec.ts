import { createHash, randomBytes } from 'node:crypto';
import { type Page, expect, test } from '@playwright/test';
import { Pool } from 'pg';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
const PASSWORD = 'CorrectHorseBatteryStaple1';
const LONG_CLIENT_NAME =
  'Long Label Campaign Assistant Client for Reviewing Characters and Managing Shared Content';
const LONG_SCOPE_DESCRIPTION =
  'Read your characters, campaigns, shared content, encounters, history, detailed equipment, and all available campaign library entries.';

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('OAuth Responsive Player');
  await page.getByLabel(/^password\b/i).fill(PASSWORD);
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
}

function pkceChallenge(): string {
  const verifier = randomBytes(32).toString('base64url');
  return createHash('sha256').update(verifier).digest('base64url');
}

test('OAuth consent stays usable across narrow, short, and breakpoint viewports', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated OAuth fixtures can be removed',
  );
  test.setTimeout(120_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const email = `oauth-responsive-${Date.now()}@example.com`;
  let clientId: string | undefined;

  try {
    await register(page, email);

    const redirectUri = new URL('/oauth/callback', BASE_URL).toString();
    const registration = await request.post(new URL('/oauth/register', BASE_URL).toString(), {
      data: {
        client_name: LONG_CLIENT_NAME,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'gpc:read gpc:write gpc:manage',
      },
    });
    expect(registration.status()).toBe(201);
    const registrationBody = (await registration.json()) as { client_id: string };
    clientId = registrationBody.client_id;

    const state = randomBytes(18).toString('base64url');
    const authorization = new URL('/oauth/authorize', BASE_URL);
    authorization.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: pkceChallenge(),
      code_challenge_method: 'S256',
      scope: 'gpc:read gpc:write gpc:manage',
      state,
      resource: new URL('/mcp', BASE_URL).toString(),
    }).toString();
    let reauthenticationRequired = true;
    await page.route('**/api/v1/oauth/authorization?*', async (route) => {
      if (reauthenticationRequired) {
        reauthenticationRequired = false;
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'recent authentication required' }),
        });
        return;
      }
      const response = await route.fetch();
      if (!response.ok()) {
        await route.fulfill({ response });
        return;
      }
      const body = (await response.json()) as {
        clientName: string;
        scopeDescriptions: Record<string, string>;
      };
      body.clientName = LONG_CLIENT_NAME;
      body.scopeDescriptions['gpc:read'] = LONG_SCOPE_DESCRIPTION;
      await route.fulfill({ response, json: body });
    });

    // The existing MCP OAuth acceptance test covers the server's stale-session
    // redirect. Simulate its reauthentication response here and follow the
    // application's real redirect, sign-in, consent, and approval flow.
    await page.goto(authorization.toString());
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByText('Sign in again before reviewing and authorizing this connected app.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Authorize', exact: true })).toHaveCount(0);

    const viewports = [
      { width: 320, height: 720 },
      { width: 375, height: 812 },
      { width: 568, height: 320 },
      { width: 639, height: 800 },
      { width: 640, height: 800 },
      { width: 641, height: 800 },
      { width: 768, height: 900 },
      { width: 1024, height: 768 },
      { width: 1280, height: 900 },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(
        width,
        `login horizontal overflow at ${viewport.width}x${viewport.height}`,
      ).toBeLessThanOrEqual(viewport.width);
      if (viewport.width === 568 && viewport.height === 320) {
        await page.screenshot({
          path: testInfo.outputPath('oauth-login-568x320.png'),
          fullPage: true,
        });
      }
    }

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Authorize ${LONG_CLIENT_NAME}` })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(LONG_SCOPE_DESCRIPTION)).toBeVisible();

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const main = page.locator('main');
      const deny = page.getByRole('button', { name: 'Deny', exact: true });
      const authorize = page.getByRole('button', { name: 'Authorize', exact: true });
      await expect(main).toBeVisible();
      await expect(deny).toBeVisible();
      await expect(authorize).toBeVisible();
      const geometry = await page.evaluate(() => {
        const cardRect = document.querySelector('main section.card')?.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          cardLeft: cardRect?.left ?? -1,
          cardRight: cardRect?.right ?? -1,
        };
      });
      expect(
        geometry.documentWidth,
        `horizontal overflow at ${viewport.width}x${viewport.height}`,
      ).toBeLessThanOrEqual(viewport.width);
      expect(
        geometry.cardLeft,
        `card left edge at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        geometry.cardRight,
        `card right edge at ${viewport.width}x${viewport.height}`,
      ).toBeLessThanOrEqual(viewport.width);

      if (viewport.width === 320 || (viewport.width === 568 && viewport.height === 320)) {
        await page.screenshot({
          path: testInfo.outputPath(`oauth-consent-${viewport.width}x${viewport.height}.png`),
          fullPage: true,
        });
      }
      if (viewport.width === 568 && viewport.height === 320) {
        await authorize.scrollIntoViewIfNeeded();
        const [denyBox, authorizeBox, bounds] = await Promise.all([
          deny.boundingBox(),
          authorize.boundingBox(),
          page.evaluate(() => {
            const visual = window.visualViewport;
            const left = visual?.offsetLeft ?? 0;
            const top = visual?.offsetTop ?? 0;
            const width = visual?.width ?? window.innerWidth;
            const height = visual?.height ?? window.innerHeight;
            return { left, top, right: left + width, bottom: top + height };
          }),
        ]);
        expect(denyBox, 'Deny has a measurable box').not.toBeNull();
        expect(authorizeBox, 'Authorize has a measurable box').not.toBeNull();
        if (!denyBox || !authorizeBox) continue;
        for (const [label, box] of [
          ['Deny', denyBox],
          ['Authorize', authorizeBox],
        ] as const) {
          expect(box.x, `${label} left edge inside the short viewport`).toBeGreaterThanOrEqual(
            bounds.left - 1,
          );
          expect(box.y, `${label} top edge inside the short viewport`).toBeGreaterThanOrEqual(
            bounds.top - 1,
          );
          expect(
            box.x + box.width,
            `${label} right edge inside the short viewport`,
          ).toBeLessThanOrEqual(bounds.right + 1);
          expect(
            box.y + box.height,
            `${label} bottom edge inside the short viewport`,
          ).toBeLessThanOrEqual(bounds.bottom + 1);
        }
        const overlapX =
          Math.min(denyBox.x + denyBox.width, authorizeBox.x + authorizeBox.width) -
          Math.max(denyBox.x, authorizeBox.x);
        const overlapY =
          Math.min(denyBox.y + denyBox.height, authorizeBox.y + authorizeBox.height) -
          Math.max(denyBox.y, authorizeBox.y);
        expect(overlapX > 0 && overlapY > 0, 'decision buttons do not overlap').toBe(false);
      }
    }

    await page.getByRole('button', { name: 'Authorize', exact: true }).click();
    await expect(page).toHaveURL(/\/oauth\/callback\?/);
    expect(new URL(page.url()).searchParams.get('state')).toBe(state);
  } finally {
    try {
      if (clientId) {
        await pool.query('delete from oauth_clients where client_id=$1', [clientId]);
      }
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
