/** Real built-worker acceptance. Run with PWA_E2E=1 against the built Bun server. */
import { expect, test } from '@playwright/test';

test.skip(
  process.env.PWA_E2E !== '1',
  'Requires the production client build and real service worker',
);

async function waitForWorker(page: import('@playwright/test').Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}

test('installable package, mobile launch, screenshots and real offline cold navigation', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your next adventure. All on one sheet.' }),
  ).toBeVisible();
  await waitForWorker(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  const session = await context.newCDPSession(page);
  const appManifest = await session.send('Page.getAppManifest');
  expect(appManifest.errors).toEqual([]);
  const manifest = JSON.parse(appManifest.data ?? '{}');
  expect(manifest).toMatchObject({ id: '/', scope: '/', start_url: '/', display: 'standalone' });
  const installability = await session.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);
  for (const icon of manifest.icons) {
    const image = await page.evaluate(async (url: string) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    }, icon.src);
    expect(`${image.width}x${image.height}`).toBe(icon.sizes);
  }
  for (const shot of manifest.screenshots) {
    const response = await page.request.get(shot.src);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
  }
  await page.screenshot({ path: 'test-results/pwa-launch-mobile.png', fullPage: false });
  for (const width of [320, 393, 639, 640, 641, 767, 768, 769]) {
    await page.setViewportSize({ width, height: 851 });
    await expect(page.getByRole('link', { name: 'Create your account' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your next adventure. All on one sheet.' }),
  ).toBeVisible();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('worker keeps protocol, admin documents and missing assets out of the player shell', async ({
  page,
}) => {
  await page.goto('/');
  await waitForWorker(page);
  for (const path of [
    '/api',
    '/api?package-audit=1',
    '/api/not-a-route',
    '/mcp/not-a-route',
    '/.well-known/not-a-route',
    '/oauth/not-a-route',
    '/assets/missing.png',
    '/screenshots/missing.png',
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    expect(await page.locator('body').innerText(), path).not.toContain('Your next adventure');
  }
  // The admin router intentionally redirects a direct /admin.html visit to /.
  // Disable only page scripts while inspecting the real controlled document;
  // the worker stays active, so this still exercises its navigation boundary.
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setScriptExecutionDisabled', { value: true });
  await page.goto('/admin.html?package-audit=1');
  await expect(page).toHaveTitle('GURPS Player Companion · Admin');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  await session.send('Emulation.setScriptExecutionDisabled', { value: false });
  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});

test('offline precached shell retains queued character edits across reload and syncs on reconnect', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto('/register');
  await page
    .getByLabel('Email')
    .fill(`pwa-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`);
  await page.getByLabel('Display name').fill('PWA Tester');
  await page.getByLabel(/^Password/).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('link', { name: 'Create your first character' })).toBeVisible();
  await waitForWorker(page);
  await page.goto('/characters');
  await page.getByLabel('New character name').fill('PWA Offline Hero');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+$/);
  await expect(page.getByLabel(/all changes saved/i).filter({ visible: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  const name = page.getByRole('textbox', { name: 'character name', exact: true }).first();
  await expect(name).toBeVisible();
  await name.fill('PWA Offline Renamed');
  await name.press('Tab');
  // The separate Identity editor reads the committed local mirror. Its visible
  // update proves blur saved to IndexedDB; the generic Offline indicator was
  // already showing before this edit and cannot establish that a save finished.
  await expect(
    page.getByRole('textbox', { name: 'character name', exact: true }).last(),
  ).toHaveValue('PWA Offline Renamed');
  await expect(
    page
      .getByLabel(/offline/i)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue('PWA Offline Renamed');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByLabel(/all changes saved/i).filter({ visible: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.reload();
  await expect(name).toHaveValue('PWA Offline Renamed');
});
