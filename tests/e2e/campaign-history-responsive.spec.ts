import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

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

test('campaign history wraps long unbroken event summaries', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const sourceName = 'A'.repeat(160);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`campaign-history-responsive-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Campaign History QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const campaignResponse = await page.request.post('/api/v1/campaigns', {
    data: { name: 'Campaign history responsive QA' },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
  const { id: campaignId } = (await campaignResponse.json()) as { id: string };
  const yaml = JSON.stringify({
    version: 14,
    library: {
      sources: [
        { name: sourceName, key: 'qa-history-long-source', abbreviation: 'HISTORY', priority: 10 },
      ],
      traits: [],
      skills: [],
      items: [],
    },
  });
  const importResponse = await page.request.post(`/api/v1/campaigns/${campaignId}/library/import`, {
    data: { yaml, mode: 'merge' },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(importResponse.ok(), await importResponse.text()).toBeTruthy();

  await page.goto(`/campaigns/${campaignId}/history`);
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Campaign changes' })).toBeVisible();
  const summary = page.getByText(`Added library source ${sourceName}`, { exact: true });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  const summaryRow = summary.locator('xpath=ancestor::summary[1]');
  const summaryContent = summary.locator('xpath=..');

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(summary).toBeVisible();
    const [rowBox, contentWidth, pageWidth] = await Promise.all([
      summaryRow.boundingBox(),
      summaryContent.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      })),
      page.evaluate(() => document.documentElement.scrollWidth),
    ]);
    if (!rowBox) throw new Error('History summary row has no visible bounding box');
    expect(rowBox.x).toBeGreaterThanOrEqual(0);
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(viewport.width);
    expect(contentWidth.scroll).toBeLessThanOrEqual(contentWidth.client);
    expect(pageWidth).toBeLessThanOrEqual(viewport.width);
    if (viewport.width === 320) {
      await summary.scrollIntoViewIfNeeded();
      const summaryBox = await summary.boundingBox();
      if (!summaryBox) throw new Error('History summary text has no visible bounding box');
      expect(summaryBox.height).toBeGreaterThan(20);
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath('campaign-history-long-summary-320x568.png'),
        animations: 'disabled',
      });
    }
  }
});
