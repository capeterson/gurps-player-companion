import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

for (const rejectFirst of [false, true]) {
  test(`queued account toggle stays with its session when first response ${rejectFirst ? 'is rejected' : 'succeeds'}`, async ({
    page,
    context,
  }) => {
    const password = 'CorrectHorseBatteryStaple1';
    async function register() {
      const response = await page.request.post('/api/v1/auth/register', {
        data: { email: `toggle-${randomUUID()}@example.com`, password, displayName: 'Toggle test' },
      });
      expect(response.status()).toBe(201);
      return response.json() as Promise<{
        accessToken: string;
        refreshToken: string;
        accessTokenExpiresIn: number;
      }>;
    }
    const a = await register();
    const b = await register();
    async function setPreference(token: string, value: boolean) {
      const response = await page.request.patch('/api/v1/auth/notification-preferences', {
        headers: { authorization: `Bearer ${token}` },
        data: { emailInvitations: value },
      });
      expect(response.ok()).toBeTruthy();
    }
    await setPreference(a.accessToken, false);
    await setPreference(b.accessToken, true);
    const snapshot = (tokens: typeof a) => ({
      ...tokens,
      sessionId: randomUUID(),
      version: 0,
      refreshRequestId: randomUUID(),
    });
    const aSnapshot = snapshot(a);
    const bSnapshot = snapshot(b);
    await page.goto('/');
    await page.evaluate(
      (pair) => localStorage.setItem('gpc.tokenPair.v1', JSON.stringify(pair)),
      aSnapshot,
    );
    await page.goto('/settings');
    const toggle = page.getByRole('checkbox', { name: 'Campaign invitations' });
    await expect(toggle).not.toBeChecked();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finished!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const requests: { authorization: string; body: string | null }[] = [];
    await context.route('**/api/v1/auth/notification-preferences', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      requests.push({
        authorization: route.request().headers().authorization ?? '',
        body: route.request().postData(),
      });
      if (requests.length === 1) {
        const response = rejectFirst ? null : await route.fetch();
        started();
        await gate;
        if (response) await route.fulfill({ response });
        else
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'rejected' }),
          });
        finished();
      } else await route.continue();
    });
    await toggle.click();
    await dispatched;
    await toggle.click();
    const other = await context.newPage();
    await other.goto('/');
    await other.evaluate(
      (pair) => localStorage.setItem('gpc.tokenPair.v1', JSON.stringify(pair)),
      bSnapshot,
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stored = localStorage.getItem('gpc.tokenPair.v1');
          return stored ? JSON.parse(stored).sessionId : null;
        }),
      )
      .toBe(bSnapshot.sessionId);
    const settled = page.waitForResponse(
      (r) => r.url().endsWith('/auth/notification-preferences') && r.request().method() === 'PATCH',
    );
    release();
    await firstFinished;
    await settled;
    await other.goto('/settings');
    const bControl = other.getByRole('checkbox', { name: 'Membership and access' });
    await expect(bControl).toBeVisible();
    const bSaved = other.waitForResponse(
      (r) => r.url().endsWith('/auth/notification-preferences') && r.request().method() === 'PATCH',
    );
    await bControl.click();
    expect((await bSaved).ok()).toBeTruthy();
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual({
      authorization: `Bearer ${a.accessToken}`,
      body: JSON.stringify({ emailInvitations: true }),
    });
    expect(requests[1]?.authorization).toBe(`Bearer ${b.accessToken}`);
    expect(JSON.parse(requests[1]?.body ?? '{}')).toHaveProperty('membership');
    const fresh = await page.request.get('/api/v1/auth/notification-preferences', {
      headers: { authorization: `Bearer ${b.accessToken}` },
    });
    expect(fresh.ok()).toBeTruthy();
    expect((await fresh.json()).emailInvitations).toBe(true);
  });
}

test('notification topics and experimental toggles save under the current session', async ({
  page,
}) => {
  const response = await page.request.post('/api/v1/auth/register', {
    data: {
      email: `toggle-controls-${randomUUID()}@example.com`,
      password: 'CorrectHorseBatteryStaple1',
      displayName: 'Toggle controls',
    },
  });
  expect(response.status()).toBe(201);
  const tokens = await response.json();
  const session = {
    ...tokens,
    sessionId: randomUUID(),
    version: 0,
    refreshRequestId: randomUUID(),
  };
  await page.goto('/');
  await page.evaluate(
    (pair) => localStorage.setItem('gpc.tokenPair.v1', JSON.stringify(pair)),
    session,
  );
  await page.goto('/settings');
  for (const control of [
    { label: 'Membership and access', path: 'notification-preferences', key: 'membership' },
    { label: 'MCP UI', path: 'experimental-features', key: 'mcpUi' },
  ]) {
    const toggle = page.getByRole('checkbox', { name: control.label });
    await expect(toggle).toBeVisible();
    const initial = await toggle.isChecked();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith(`/auth/${control.path}`) && r.request().method() === 'PATCH',
    );
    await toggle.click();
    const result = await saved;
    expect(result.ok()).toBeTruthy();
    expect(result.request().headers().authorization).toBe(`Bearer ${tokens.accessToken}`);
    const fresh = await page.request.get(`/api/v1/auth/${control.path}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect((await fresh.json())[control.key]).toBe(!initial);
  }
});
