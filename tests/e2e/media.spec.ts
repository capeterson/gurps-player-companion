import { type Locator, type Page, expect, test } from '@playwright/test';
import sharp from 'sharp';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

async function register(page: Page, email: string) {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Media Upload QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
}

async function photo(color: { r: number; g: number; b: number }) {
  return sharp({ create: { width: 180, height: 120, channels: 3, background: color } })
    .png()
    .toBuffer();
}

async function upload(locator: Locator, name: string, bytes: Buffer) {
  await locator.setInputFiles({ name, mimeType: 'image/png', buffer: bytes });
}

async function expectInsideViewport(page: Page, image: Locator, width: number) {
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  if (await image.evaluate((element) => element.tagName === 'IMG')) {
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
  }
  const box = await image.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.height ?? 900,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
}

async function expectRuntimeCached(page: Page, source: string, cacheName: string) {
  await expect
    .poll(() =>
      page.evaluate(
        async ({ source, cacheName }) => {
          const cache = await caches.open(cacheName);
          const response = await cache.match(new URL(source, location.href));
          return response
            ? {
                type: response.headers.get('content-type'),
                policy: response.headers.get('cache-control'),
              }
            : null;
        },
        { source, cacheName },
      ),
    )
    .toMatchObject({ type: 'image/webp' });
}

test('portrait and campaign images stay responsive, public, cached, and available offline', async ({
  page,
  context,
}) => {
  test.skip(
    process.env.MEDIA_E2E_STORAGE !== '1',
    'Requires configured local or S3-compatible storage; set MEDIA_E2E_STORAGE=1 to run',
  );
  test.setTimeout(180_000);
  const viewportWidths = [320, 639, 640, 641, 767, 768, 769, 1280];
  const userEmail = `e2e-media-${suffix()}@example.com`;
  const characterName = `Media Hero ${suffix()} of the Forgotten Coast and the Northern Expedition`;
  const campaignName = `Media Campaign ${suffix()} — Expedition through the Forgotten Coast`;

  await page.setViewportSize({ width: 1280, height: 900 });
  await register(page, userEmail);
  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill(characterName);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+$/, { timeout: 15_000 });

  const portraitTrigger = page.getByRole('button', { name: `Edit portrait for ${characterName}` });
  await expect(portraitTrigger).toBeVisible();
  await expect(page.getByLabel('Upload portrait')).toHaveCount(0);
  await expect(page.getByText(/JPEG, PNG or WebP/)).toHaveCount(0);
  await portraitTrigger.click();
  const portraitEditor = page.getByRole('dialog', { name: 'Character portrait' });
  const portraitInput = portraitEditor.getByLabel('Upload portrait');
  await expect(portraitInput).toBeVisible({ timeout: 15_000 });
  await portraitInput.setInputFiles({
    name: 'unsupported.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('invalid'),
  });
  const portraitError = portraitEditor.getByRole('alert');
  await expect(
    portraitEditor.getByText("Couldn't save Portrait — Choose a JPEG, PNG, or WebP image", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(portraitTrigger.locator('..')).toHaveAttribute('data-flashing', 'true');
  await portraitEditor.getByLabel('Dismiss notification').click();
  await expect(portraitError).toHaveCount(0);
  await upload(portraitInput, 'portrait.png', await photo({ r: 130, g: 80, b: 140 }));
  const portrait = portraitTrigger.locator('img');
  await expect(portrait).toHaveAttribute('src', /^\/media\/[a-f0-9]{64}\/display\.webp$/, {
    timeout: 30_000,
  });
  const portraitUrl = await portrait.getAttribute('src');
  if (!portraitUrl) throw new Error('uploaded portrait has no public URL');
  await expectRuntimeCached(page, portraitUrl, 'gpc-public-image-displays-v1');

  const anonymousPortrait = await page.request.get(new URL(portraitUrl, page.url()).toString());
  expect(anonymousPortrait.status()).toBe(200);
  expect(anonymousPortrait.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(anonymousPortrait.headers()['content-type']).toBe('image/webp');

  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    await expectInsideViewport(page, portraitEditor.locator('.modal-box'), width);
    await expectInsideViewport(page, portraitInput, width);
    await expect(portraitEditor.getByText(/JPEG, PNG or WebP/)).toBeVisible();
    await captureReviewScreenshot(page, {
      path: `test-results/media-portrait-${width}.png`,
      fullPage: true,
    });
  }

  // The app shell and immutable image are now under service-worker control.
  // Replace the image offline, reload to prove the pending Blob survives, then
  // reconnect and wait for the queued attachment to publish its new URL.
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByLabel('Upload portrait').setInputFiles({
    name: 'replacement.png',
    mimeType: 'image/png',
    buffer: await photo({ r: 50, g: 160, b: 90 }),
  });
  await expect(portrait).toHaveAttribute('src', /^blob:/);
  await expect(
    page.getByRole('status').filter({ hasText: /image queued|uploading|saving image/i }),
  ).toBeVisible();
  await portraitEditor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(portraitTrigger).toBeFocused();
  await page.reload();
  await expect(portraitTrigger).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Upload portrait')).toHaveCount(0);
  await expect(portrait).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => portrait.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  await captureReviewScreenshot(page, {
    path: 'test-results/media-portrait-offline.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 320, height: 900 });
  const mobileNavigation = page.getByRole('navigation', { name: 'Character and app navigation' });
  await mobileNavigation.locator('summary').click();
  const logoutDialog = page.waitForEvent('dialog', { timeout: 15_000 });
  const cancelSignOut = mobileNavigation.getByRole('button', { name: 'Logout' }).click();
  const dialog = await logoutDialog;
  expect(dialog.message()).toContain('discards unsaved image files');
  await dialog.dismiss();
  await cancelSignOut;
  await expect(portraitTrigger).toBeVisible();
  await expect(portrait).toHaveAttribute('src', /^blob:/);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(portrait).toHaveAttribute('src', /^\/media\/[a-f0-9]{64}\/display\.webp$/, {
    timeout: 45_000,
  });
  const replacementUrl = await portrait.getAttribute('src');
  expect(replacementUrl).not.toBe(portraitUrl);
  if (!replacementUrl) throw new Error('replacement portrait has no public URL');
  await expectRuntimeCached(page, replacementUrl, 'gpc-public-image-displays-v1');

  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel('Campaign name').fill(campaignName);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.getByRole('link', { name: campaignName })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: campaignName }).click();
  await expect(page.getByRole('heading', { name: campaignName })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Upload campaign cover')).toHaveCount(0);
  await expect(page.getByText(/JPEG, PNG or WebP/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: campaignName });
  const coverInput = settings.getByLabel('Upload campaign cover');
  await expect(coverInput).toBeVisible({ timeout: 15_000 });
  await upload(coverInput, 'campaign-cover.png', await photo({ r: 175, g: 110, b: 55 }));
  const cover = settings.getByRole('img', { name: `${campaignName} cover` });
  await expect(cover).toHaveAttribute('src', /^\/media\/[a-f0-9]{64}\/display\.webp$/, {
    timeout: 30_000,
  });
  const coverUrl = await cover.getAttribute('src');
  if (!coverUrl) throw new Error('uploaded cover has no public URL');
  await expectRuntimeCached(page, coverUrl, 'gpc-public-image-displays-v1');
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    await expectInsideViewport(page, settings.locator('.modal-box'), width);
    await expectInsideViewport(page, coverInput, width);
    await expect(settings.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await captureReviewScreenshot(page, {
      path: `test-results/media-cover-${width}.png`,
      fullPage: true,
    });
  }

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await coverInput.setInputFiles({
    name: 'pending-cover.png',
    mimeType: 'image/png',
    buffer: await photo({ r: 45, g: 95, b: 170 }),
  });
  await expect(cover).toHaveAttribute('src', /^blob:/);
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Upload campaign cover')).toHaveCount(0);
  await page.getByLabel('Open user menu').click();
  const confirmDialog = page.waitForEvent('dialog', { timeout: 15_000 });
  const confirmSignOut = page.getByRole('button', { name: 'Logout' }).click();
  const confirm = await confirmDialog;
  expect(confirm.message()).toContain('discards unsaved image files');
  await confirm.accept();
  await confirmSignOut;
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/, { timeout: 20_000 });
  const pendingCount = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('gurps-pc-local');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('mediaUploads')) {
            db.close();
            resolve(0);
            return;
          }
          const tx = db.transaction('mediaUploads', 'readonly');
          const count = tx.objectStore('mediaUploads').count();
          count.onsuccess = () => resolve(count.result);
          tx.oncomplete = () => db.close();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  expect(pendingCount).toBe(0);
});
