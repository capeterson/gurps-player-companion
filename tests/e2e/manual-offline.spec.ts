import { type Page, expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

async function readStore(page: Page, store: string) {
  return page.evaluate(async (storeName) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gurps-pc-local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = database.transaction(storeName).objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, store);
}

test('intentional offline mode stays quiet, preserves edits and resumes after Go online', async ({
  page, context,
}, testInfo) => {
  test.setTimeout(180_000);
  const existingEmail = process.env.OFFLINE_MODE_E2E_EMAIL;
  await page.goto(existingEmail ? '/login' : '/register');
  await page.getByLabel(/email/i).fill(existingEmail ?? `manual-offline-${Date.now()}@example.com`);
  if (!existingEmail) await page.getByLabel(/display name/i).fill('Offline mode QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: existingEmail ? /sign in/i : /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Offline mode preview hero');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 15_000 });
  const destination = new URL(page.url()).pathname;
  const saved = () => page.getByLabel(/^All changes saved/).filter({ visible: true });
  const offline = () => page.getByRole('button', { name: 'Offline mode — sync paused', exact: true });
  const dialog = () => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Sync log' }) });
  await expect(saved()).toBeVisible({ timeout: 15_000 });
  await saved().click();
  await dialog().getByRole('button', { name: 'Go offline', exact: true }).click();
  await expect(dialog().getByText('Offline mode', { exact: true })).toBeVisible();
  await expect(dialog().getByRole('button', { name: 'Sync now', exact: true })).toBeDisabled();
  await expect(dialog().getByRole('button', { name: /abandon local changes and re-sync/i })).toBeDisabled();
  await dialog().getByRole('button', { name: 'Close sync log' }).click();
  await expect(offline()).toBeVisible();

  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/')) apiRequests.push(request.url());
  });
  // A browser reconnect cannot undo the user's explicit offline choice.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const strength = page.getByRole('textbox', { name: 'ST base', exact: true });
  const dexterity = page.getByRole('textbox', { name: 'DX base', exact: true });
  await strength.fill('12');
  await strength.blur();
  await strength.fill('13');
  await strength.blur();
  await dexterity.fill('11');
  await dexterity.blur();
  await expect.poll(async () => (await readStore(page, 'outbox')).length).toBe(2);
  await page.reload();
  await expect(offline()).toBeVisible({ timeout: 15_000 });
  await expect(strength).toHaveValue('13');
  await expect(dexterity).toHaveValue('11');
  // Cover a full automatic poll interval, proving timers do not send API requests.
  await page.waitForTimeout(5_500);
  expect(apiRequests).toEqual([]);
  expect((await readStore(page, 'syncLog')).filter((entry) => entry.result === 'failed')).toEqual([]);

  const secondPage = await context.newPage();
  await secondPage.goto(destination);
  await expect(secondPage.getByRole('button', { name: 'Offline mode — sync paused', exact: true })).toBeVisible({ timeout: 15_000 });
  await secondPage.close();

  // One account/page covers both palettes and footer breakpoint boundaries.
  for (const mode of ['light', 'dark']) {
    const switchMode = page.getByRole('button', { name: `Switch to ${mode} mode`, exact: true }).filter({ visible: true });
    if (await switchMode.isVisible()) await switchMode.click();
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 575, height: 900 },
      { width: 639, height: 800 },
      { width: 640, height: 800 },
      { width: 641, height: 800 },
      { width: 1280, height: 900 },
      { width: 568, height: 320 },
    ]) {
      await page.setViewportSize(viewport);
      await offline().hover();
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toContainText('Choose Go online to resume sync');
      const tipBox = await tooltip.boundingBox();
      if (!tipBox) throw new Error('Expected the offline-mode tooltip');
      expect(tipBox.x).toBeGreaterThanOrEqual(0);
      expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(viewport.width);
      expect(tipBox.y).toBeGreaterThanOrEqual(0);
      expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(viewport.height);
      await captureReviewScreenshot(page, { path: testInfo.outputPath(`offline-icon-${mode}-${viewport.width}.png`), animations: 'disabled' });
      await offline().click();
      const goOnline = dialog().getByRole('button', { name: 'Go online', exact: true });
      await expect(goOnline).toBeVisible();
      await expect(dialog().getByRole('heading', { name: 'Repeatedly failing' })).toHaveCount(0);
      for (const target of [dialog().locator('.modal-box'), goOnline]) {
        const box = await target.boundingBox();
        if (!box) throw new Error('Expected the offline-mode dialog control');
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
      await captureReviewScreenshot(page, { path: testInfo.outputPath(`offline-dialog-${mode}-${viewport.width}.png`), animations: 'disabled' });
      await dialog().getByRole('button', { name: 'Close sync log' }).click();
    }
  }
  await offline().click();
  await dialog().getByRole('button', { name: 'Go online', exact: true }).click();
  await expect(dialog().getByRole('button', { name: 'Go offline', exact: true })).toBeVisible();
  await dialog().getByRole('button', { name: 'Close sync log' }).click();
  await expect.poll(async () => (await readStore(page, 'outbox')).length, { timeout: 15_000 }).toBe(0);
  await expect(saved()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(strength).toHaveValue('13');
  await expect(dexterity).toHaveValue('11');

  // Reachability can fail while navigator still says online. Treat this as
  // ordinary offline use rather than repeated alerts/journal failures.
  await page.route('**/api/v1/sync/cursor', (route) => route.abort('internetdisconnected'));
  const disconnected = page.getByRole('button', { name: 'Offline — changes saved on this device', exact: true });
  await expect(disconnected).toBeVisible({ timeout: 15_000 });
  await disconnected.click();
  await expect(dialog().getByText("Sync isn't currently working", { exact: true })).toHaveCount(0);
  await expect(dialog().getByText(/Failed to fetch|NetworkError|Load failed/)).toHaveCount(0);
  expect((await readStore(page, 'syncLog')).filter((entry) => entry.result === 'failed')).toEqual([]);
  await dialog().getByRole('button', { name: 'Close sync log' }).click();
  await page.unroute('**/api/v1/sync/cursor');
  await expect(saved()).toBeVisible({ timeout: 15_000 });
});
