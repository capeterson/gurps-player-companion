import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import type { Tokens } from '../../src/client/lib/tokenStore.ts';
import { captureReviewScreenshot } from './review-artifacts';

test('admin account controls confirm purge, expose nightly timing, cancel and unsuspend', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database',
  );
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  let syncRequests = 0;
  let syncSockets = 0;
  await page.route('**/api/v1/sync/**', async (route) => {
    syncRequests++;
    await route.abort();
  });
  await page.routeWebSocket('**/api/v1/sync/ws**', (socket) => {
    syncSockets++;
    socket.close();
  });
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const password = 'AdminBrowserFixture123!';
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const adminEmail = `admin-${suffix}@example.com`;
  const memberEmail = `purge-${suffix}-${'long-account-'.repeat(6)}@example.com`;
  async function register(email: string, displayName: string) {
    const response = await request.post('/api/v1/auth/register', {
      data: { email, displayName, password },
    });
    expect(response.status()).toBe(201);
    const result = await pool.query<{ id: string }>('select id from users where email=$1', [email]);
    const user = result.rows[0];
    if (!user) throw new Error('Registered fixture user not found');
    return { user, tokens: (await response.json()) as Tokens };
  }
  try {
    const admin = await register(adminEmail, 'Admin browser fixture');
    const member = await register(memberEmail, 'Purge browser fixture');
    await pool.query('update users set is_superuser=true where id=$1', [admin.user.id]);
    await page.addInitScript(
      ({ tokens, sessionId, refreshRequestId }) => {
        if (!sessionStorage.getItem('admin-e2e-session-ready')) {
          localStorage.setItem(
            'gpc.tokenPair.v1',
            JSON.stringify({
              ...tokens,
              sessionId,
              version: 0,
              refreshRequestId,
            }),
          );
          sessionStorage.setItem('admin-e2e-session-ready', '1');
        }
      },
      {
        tokens: admin.tokens,
        sessionId: randomUUID(),
        refreshRequestId: randomUUID(),
      },
    );
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await page.getByPlaceholder('Search by email or display name…').fill(memberEmail);
    await page.getByRole('link', { name: memberEmail, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Purge browser fixture' })).toBeVisible();
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 639, height: 900 },
      { width: 640, height: 900 },
      { width: 641, height: 900 },
      { width: 667, height: 375 },
      { width: 844, height: 390 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: 'Schedule purge (30 d)', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Schedule account purge?' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('open', '');
      await expect(dialog).toHaveCSS('opacity', '1');
      await expect(dialog).toContainText('After 30 days');
      await expect(dialog).toContainText(memberEmail);
      const modalBox = dialog.locator('.modal-box');
      const actions = [
        dialog.getByRole('button', { name: 'Cancel', exact: true }),
        dialog.getByRole('button', { name: 'Schedule purge', exact: true }),
      ];
      for (const action of actions) await action.scrollIntoViewIfNeeded();
      const modalBounds = await modalBox.boundingBox();
      expect(modalBounds).not.toBeNull();
      expect(modalBounds?.x).toBeGreaterThanOrEqual(0);
      expect(modalBounds?.y).toBeGreaterThanOrEqual(0);
      expect((modalBounds?.x ?? 0) + (modalBounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      expect((modalBounds?.y ?? 0) + (modalBounds?.height ?? 0)).toBeLessThanOrEqual(
        viewport.height,
      );
      for (const action of actions) {
        await expect(action).toBeVisible();
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.x).toBeGreaterThanOrEqual(modalBounds?.x ?? 0);
        expect(box?.y).toBeGreaterThanOrEqual(modalBounds?.y ?? 0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
          (modalBounds?.x ?? 0) + (modalBounds?.width ?? 0),
        );
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
          (modalBounds?.y ?? 0) + (modalBounds?.height ?? 0),
        );
        expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
        expect(box?.y ?? 0).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
        const hitTestable = await action.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit === element || element.contains(hit);
        });
        expect(hitTestable).toBe(true);
      }
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`admin-purge-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
      });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
    await page.getByRole('button', { name: 'Schedule purge (30 d)', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Schedule purge', exact: true })
      .click();
    await expect(page.getByText('purge pending', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unsuspend', exact: true })).toBeDisabled();
    await expect(page.getByText(/Deletion runs nightly at 03:00 UTC/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel purge', exact: true }).click();
    await expect(page.getByText('purge pending', { exact: true })).not.toBeVisible();
    await expect(page.getByText('suspended', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Unsuspend', exact: true }).click();
    await expect(page.getByText('active', { exact: true })).toBeVisible();
    await page.route(`**/api/v1/admin/users/${member.user.id}/suspend`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Injected admin failure' }),
      });
    });
    await page.getByRole('button', { name: 'Suspend', exact: true }).click();
    await expect(page.getByText('Injected admin failure', { exact: true })).toBeVisible();
    await expect(page.getByText('active', { exact: true })).toBeVisible();
    await page.unroute(`**/api/v1/admin/users/${member.user.id}/suspend`);
    let releaseSave = () => {};
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let markStarted = () => {};
    const saveStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    await page.route(`**/api/v1/admin/users/${member.user.id}/suspend`, async (route) => {
      markStarted();
      await saveGate;
      await route.continue();
    });
    await page.getByRole('button', { name: 'Suspend', exact: true }).click();
    await saveStarted;
    try {
      await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Schedule purge (30 d)', exact: true }),
      ).toBeDisabled();
    } finally {
      releaseSave();
    }
    await expect(page.getByText('suspended', { exact: true })).toBeVisible();
    await page.unroute(`**/api/v1/admin/users/${member.user.id}/suspend`);
    await page.goto(`/admin/users/${admin.user.id}`);
    await expect(page.getByText('You cannot suspend or purge your own account.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Schedule purge (30 d)', exact: true }),
    ).toBeDisabled();
    await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Images', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Uploaded images' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Forgot your password?', exact: true }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole('heading', { name: 'Forgot password', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await page.getByLabel(/email/i).fill(adminEmail);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/admin\/media$/);
    await expect(page.getByRole('heading', { name: 'Uploaded images' })).toBeVisible();
    expect(syncRequests).toBe(0);
    expect(syncSockets).toBe(0);
  } finally {
    try {
      await pool.query('delete from users where email=ANY($1::text[])', [
        [adminEmail, memberEmail],
      ]);
    } finally {
      await pool.end();
    }
  }
});
