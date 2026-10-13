/**
 * Read-only guest preview. Requires a server started with
 * PREVIEW_MODE_ENABLED=true and a provisioned preview (`bun run db:seed`
 * provisions it when the same variable is set; `test:e2e:built` sets both).
 */

import { type Page, expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

const PARTY = [
  'Kestrel Vale',
  'Mira Ashfall',
  'Bram Stonebridge',
  'Iona Reedwake',
  'Sable Fenwick',
  'Orin Bellstrand',
];

/** Every non-GET request a guest page sends must be a preview read. */
function recordWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' || !url.pathname.startsWith('/api/')) return;
    const allowed = ['/api/v1/sync/cursor', '/api/v1/auth/guest'].includes(url.pathname);
    if (!allowed) writes.push(`${request.method()} ${url.pathname}`);
  });
  return writes;
}

async function expectInsideViewport(page: Page, locator: ReturnType<Page['locator']>) {
  const viewport = page.viewportSize();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
}

async function startPreview(page: Page) {
  await page.goto('/');
  const tryIt = page.getByRole('link', { name: 'Try without an account' });
  await expect(tryIt).toBeVisible();
  await expect(page.getByRole('link', { name: 'Take a look' })).toHaveCount(0);
  await tryIt.click();
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'The Lantern Coast', level: 1 })).toBeVisible();
}

test('a guest reads the Lantern Coast party without any way to change it', async ({ page }) => {
  const writes = recordWrites(page);
  await startPreview(page);

  const banner = page.getByRole('complementary', { name: 'Preview' });
  await expect(banner).toContainText('Read-only preview.');
  for (const name of PARTY) await expect(page.getByRole('link', { name })).toBeVisible();

  // Guests have no notifications, settings or personal create actions.
  await expect(page.getByRole('button', { name: /notifications/i })).toHaveCount(0);
  await page.getByLabel('Open user menu').click();
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exit preview' }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Mira Ashfall' }).click();
  await expect(page.getByRole('heading', { name: 'Mira Ashfall', level: 1 }).first()).toBeVisible();
  await expect(page.getByText('read-only', { exact: true }).first()).toBeVisible();
  await expect(
    page.locator('main').locator('input:not([disabled]):not([readonly]), textarea:not([disabled])'),
  ).toHaveCount(0);

  await page.goto('/characters');
  await expect(page.getByRole('heading', { name: 'Characters', exact: true })).toBeVisible();
  await expect(page.getByLabel('New character name')).toHaveCount(0);
  await page.goto('/campaigns');
  await expect(page.getByRole('link', { name: 'The Lantern Coast' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New campaign' })).toHaveCount(0);
  await page.goto('/log');
  await expect(page.getByRole('button', { name: /Shared/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New entry' })).toHaveCount(0);

  // Settings and the personal dashboard lead back to the preview campaign.
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);

  expect(writes).toEqual([]);
});

test('the read-only banner fits and its actions leave the preview', async ({ page }) => {
  await startPreview(page);
  const banner = page.getByRole('complementary', { name: 'Preview' });
  for (const width of [390, 639, 640, 641, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(banner).toBeVisible();
    for (const name of ['Create your account', 'Exit preview']) {
      const button = banner.getByRole('button', { name });
      await expect(button).toBeVisible();
      await expectInsideViewport(page, button);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await captureReviewScreenshot(page, `guest-preview-banner-${width}.png`);
  }

  await banner.getByRole('button', { name: 'Exit preview' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Try without an account' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('gpc.tokenPair.v1'))).toBeNull();

  await page.getByRole('link', { name: 'Try without an account' }).click();
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/);
  await page
    .getByRole('complementary', { name: 'Preview' })
    .getByRole('button', { name: 'Create your account' })
    .click();
  await expect(page).toHaveURL('/register');
  expect(await page.evaluate(() => localStorage.getItem('gpc.tokenPair.v1'))).toBeNull();
});
