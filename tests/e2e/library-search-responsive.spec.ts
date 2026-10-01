import { type Page, expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function register(page: Page) {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`library-search-responsive-${suffix()}@example.com`);
  await page.getByLabel(/display name/i).fill('Library Search Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
}

async function create<T>(page: Page, path: string, body: object): Promise<T> {
  const accessToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.fetch(`/api/v1${path}`, {
    method: 'POST',
    data: body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 455, height: 800 },
  { width: 456, height: 800 },
  { width: 457, height: 800 },
  { width: 458, height: 800 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 767, height: 900 },
  { width: 768, height: 1024 },
  { width: 769, height: 900 },
  { width: 1023, height: 768 },
  { width: 1024, height: 768 },
  { width: 1025, height: 768 },
  { width: 1279, height: 900 },
  { width: 1280, height: 800 },
];

test('campaign library search and Clear search stay usable across form factors', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await register(page);
  const campaign = await create<{ id: string }>(page, '/campaigns', {
    name: 'Responsive library search',
  });
  await create(page, `/campaigns/${campaign.id}/library/sources`, {
    name: 'Synthetic responsive source',
    key: 'responsive-source',
    abbreviation: 'RS',
    edition: 'Synthetic edition',
    priority: 1,
  });
  await create<{ id: string }>(page, `/campaigns/${campaign.id}/library/traits`, {
    name: 'NarrowSearchLayoutProbe',
    kind: 'advantage',
    basePoints: 1,
    sourceKey: 'responsive-source',
  });
  await create<{ id: string }>(page, `/campaigns/${campaign.id}/library/traits`, {
    name: 'NoSourceFilterProbe',
    kind: 'advantage',
    basePoints: 1,
  });

  await page.goto(`/campaigns/${campaign.id}/library?section=traits`);
  const row = page.getByRole('button', { name: /NarrowSearchLayoutProbe responsive-source/ });
  await expect(row).toBeVisible({ timeout: 20_000 });
  const unfilteredRow = page.getByRole('button', {
    name: 'NoSourceFilterProbe',
    exact: true,
  });
  await expect(unfilteredRow).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search library' });
  const source = page.locator('.library-toolbar select');
  await expect(source).toBeVisible();
  await expect(source.locator('option[value="responsive-source"]')).toHaveCount(1);
  await source.selectOption('responsive-source');
  await expect(row).toBeVisible();
  await expect(unfilteredRow).toBeHidden();
  await source.selectOption('');
  await expect(unfilteredRow).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await test.step(`${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await search.fill('NarrowSearchLayout');
      await expect(search).toHaveValue('NarrowSearchLayout');
      await expect(source).toBeVisible();
      const clear = page.getByRole('button', { name: 'Clear search' });
      await expect(clear).toBeVisible();
      await expect(row).toBeVisible();
      await search.scrollIntoViewIfNeeded();

      const [searchBox, clearBox, sourceBox, searchGroupBox] = await Promise.all([
        search.boundingBox(),
        clear.boundingBox(),
        source.boundingBox(),
        search.locator('xpath=../..').boundingBox(),
      ]);
      expect(searchBox).not.toBeNull();
      expect(clearBox).not.toBeNull();
      expect(sourceBox).not.toBeNull();
      expect(searchGroupBox).not.toBeNull();
      if (!searchBox || !clearBox || !sourceBox || !searchGroupBox) return;
      const controlsShareRow =
        sourceBox.y < searchBox.y + searchBox.height &&
        sourceBox.y + sourceBox.height > searchBox.y;
      if (viewport.width === 456) expect(controlsShareRow).toBe(false);
      if ([457, 458].includes(viewport.width)) expect(controlsShareRow).toBe(true);
      expect(searchBox.width).toBeGreaterThanOrEqual(144);
      expect(clearBox.x).toBeGreaterThanOrEqual(searchBox.x + searchBox.width);
      expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(viewport.width - 8);
      expect(searchBox.x).toBeGreaterThanOrEqual(8);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);

      if (
        [320, 375, 390, 455, 456, 457, 568, 639, 640, 641, 768, 1024, 1280].includes(viewport.width)
      ) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`library-search-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }

      await clear.click();
      await expect(search).toHaveValue('');
    });
  }
});
