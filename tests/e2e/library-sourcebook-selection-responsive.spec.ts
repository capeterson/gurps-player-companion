import { readFile } from 'node:fs/promises';
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

test('long sourcebook names wrap and remain selectable for export', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const sourceName = 'A'.repeat(160);
  const sourceKey = 'qa-responsive-long-source';
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`library-source-selection-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Source Selection QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const campaignResponse = await page.request.post('/api/v1/campaigns', {
    data: { name: 'Source selection responsive QA' },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
  const { id: campaignId } = (await campaignResponse.json()) as { id: string };
  const yaml = JSON.stringify({
    version: 14,
    library: {
      sources: [{ name: sourceName, key: sourceKey, abbreviation: 'LONGBOOK', priority: 10 }],
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

  await page.goto(`/campaigns/${campaignId}/library-transfer`);
  const sourceChoice = page.getByRole('checkbox', {
    name: `LONGBOOK · ${sourceName}`,
    exact: true,
  });
  await expect(sourceChoice).toBeVisible({ timeout: 30_000 });
  const sourceLabel = sourceChoice.locator('xpath=..');
  const sourceText = sourceLabel.locator('span');

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(sourceChoice).toBeVisible();
    await expect(sourceChoice).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Export YAML' })).toBeVisible();
    const [labelBox, textWidth, pageWidth] = await Promise.all([
      sourceLabel.boundingBox(),
      sourceText.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      })),
      page.evaluate(() => document.documentElement.scrollWidth),
    ]);
    if (!labelBox) throw new Error('Sourcebook choice has no visible bounding box');
    expect(labelBox.x).toBeGreaterThanOrEqual(0);
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(viewport.width);
    expect(textWidth.scroll).toBeLessThanOrEqual(textWidth.client);
    expect(pageWidth).toBeLessThanOrEqual(viewport.width);
    if (viewport.width === 320) {
      expect(labelBox.height).toBeGreaterThan(20);
      await page.screenshot({
        path: testInfo.outputPath('sourcebook-selection-320x568.png'),
        animations: 'disabled',
        fullPage: true,
      });
    }
  }

  await sourceChoice.check();
  await expect(sourceChoice).toBeChecked();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export YAML' }).click();
  const download = await downloadPromise;
  const exportPath = testInfo.outputPath('sourcebook-package.yaml');
  await download.saveAs(exportPath);
  const exported = await readFile(exportPath, 'utf8');
  expect(exported).toContain(sourceName);
  expect(exported).toContain(sourceKey);
  expect(exported).toContain('kind: sources');
});
