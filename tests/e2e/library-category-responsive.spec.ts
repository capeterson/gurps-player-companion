import { expect, test } from '@playwright/test';

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test('long item categories wrap in the group heading and mobile row summary', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const category = 'Q'.repeat(40);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`library-category-responsive-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Library Category QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const campaignResponse = await page.request.post('/api/v1/campaigns', {
    data: { name: 'Library category responsive QA' },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
  const { id: campaignId } = (await campaignResponse.json()) as { id: string };
  const yaml = JSON.stringify({
    version: 14,
    library: {
      traits: [],
      skills: [],
      items: [{ name: 'Long category item', key: 'qa-long-category-item', category }],
    },
  });
  const importResponse = await page.request.post(`/api/v1/campaigns/${campaignId}/library/import`, {
    data: { yaml, mode: 'merge' },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(importResponse.ok(), await importResponse.text()).toBeTruthy();

  await page.goto(`/campaigns/${campaignId}/library?section=items`);
  const item = page.getByRole('button', { name: /^Long category item/ });
  await expect(item).toBeVisible({ timeout: 30_000 });
  const groupHeading = page.locator('.library-group-heading').filter({ hasText: category });
  const groupLabel = groupHeading.locator('.label-eyebrow');
  await expect(groupLabel).toHaveText(category);
  const itemRow = item.locator('xpath=ancestor::tr[1]');
  const mobileMeta = itemRow.locator('td:first-child > span').first();

  await page.setViewportSize({ width: 320, height: 568 });
  const groupToggle = groupHeading.getByRole('button');
  await expect(groupToggle).toHaveAttribute('aria-expanded', 'true');
  await groupToggle.click();
  await expect(groupToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(item).toBeHidden();
  await groupToggle.click();
  await expect(groupToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(item).toBeVisible();

  async function checkWidths(mode: 'all' | 'search') {
    for (const viewport of viewports) {
      await test.step(`${mode} category label at ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await expect(groupLabel).toHaveText(category);
        await expect(item).toBeVisible();
        await groupHeading.scrollIntoViewIfNeeded();
        await expect(groupLabel).toBeVisible();
        const [labelBox, labelWidth, pageWidth] = await Promise.all([
          groupLabel.boundingBox(),
          groupLabel.evaluate((element) => ({
            scroll: element.scrollWidth,
            client: element.clientWidth,
          })),
          page.evaluate(() => document.documentElement.scrollWidth),
        ]);
        if (!labelBox) throw new Error('Category group label has no visible bounding box');
        expect(labelBox.x).toBeGreaterThanOrEqual(0);
        expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(viewport.width);
        expect(labelWidth.scroll).toBeLessThanOrEqual(labelWidth.client);
        expect(pageWidth).toBeLessThanOrEqual(viewport.width);

        if (viewport.width < 640) {
          await expect(mobileMeta).toBeVisible();
          await expect(mobileMeta).toHaveText(`${category} · 0 lb · 0`);
          const metaWidth = await mobileMeta.evaluate((element) => ({
            scroll: element.scrollWidth,
            client: element.clientWidth,
          }));
          expect(metaWidth.scroll).toBeLessThanOrEqual(metaWidth.client);
        }
        if (mode === 'all' && (viewport.width === 320 || viewport.width === 568)) {
          await groupLabel.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: testInfo.outputPath(
              `long-item-category-${viewport.width}x${viewport.height}.png`,
            ),
            animations: 'disabled',
          });
        }
      });
    }
  }

  await checkWidths('all');
  await page.getByRole('searchbox', { name: 'Search library' }).fill('Long category item');
  await expect(groupHeading.locator('.label-eyebrow')).toHaveText(category);
  await checkWidths('search');
});
