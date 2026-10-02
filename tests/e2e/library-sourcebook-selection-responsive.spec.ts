import { readFile } from 'node:fs/promises';
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
    name: `LONGBOOK: ${sourceName}`,
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
      await captureReviewScreenshot(page, {
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
  expect(exported).toContain('sourceKeys:');
  expect(exported).toContain('key:');
  expect(exported).not.toContain('sourceId:');
  expect(exported).toContain('kind: sources');

  // A sourcebook's UUID stays stable when its descriptive metadata changes.
  await page.goto(`/campaigns/${campaignId}/library?section=sources`);
  await page.getByRole('button', { name: /\+ Add source/i }).click();
  await expect(page.getByLabel('Source key')).toHaveCount(0);
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('sourcebook-create-form-no-key.png'),
    fullPage: true,
  });
  await page.getByLabel('Publication title').fill('Mariner Techniques');
  await page.getByLabel('Abbreviation').fill('MT');
  await page.getByRole('button', { name: 'Save source' }).click();
  await expect(page.getByRole('button', { name: 'Edit Mariner Techniques' })).toBeVisible();

  let initialLibrary: {
    sources: { id: string; name: string; abbreviation: string }[];
  } = { sources: [] };
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/campaigns/${campaignId}/library`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok()) return '';
      initialLibrary = (await response.json()) as typeof initialLibrary;
      const created = initialLibrary.sources.some(
        (source) => source.name === 'Mariner Techniques' && source.abbreviation === 'MT',
      );
      const martialArts = initialLibrary.sources.some(
        (source) => source.name === 'GURPS Martial Arts' && source.abbreviation === 'MA',
      );
      return created && martialArts ? 'ready' : '';
    })
    .toBe('ready');
  const createdSource = initialLibrary.sources.find(
    (source) => source.name === 'Mariner Techniques' && source.abbreviation === 'MT',
  );
  const martialArts = initialLibrary.sources.find(
    (source) => source.name === 'GURPS Martial Arts' && source.abbreviation === 'MA',
  );
  expect(createdSource?.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(martialArts?.id).toMatch(/^[0-9a-f-]{36}$/i);
  if (!createdSource || !martialArts) throw new Error('Expected sourcebooks were not saved');

  const traitResponse = await page.request.post(`/api/v1/campaigns/${campaignId}/library/traits`, {
    data: {
      name: 'Sourcebook UUID link probe',
      key: 'sourcebook-uuid-link-probe',
      kind: 'advantage',
      basePoints: 1,
      sourceId: martialArts.id,
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(traitResponse.status(), await traitResponse.text()).toBe(201);

  await page.goto(`/campaigns/${campaignId}/library?section=traits`);
  await page.getByRole('button', { name: 'Edit Sourcebook UUID link probe' }).click();
  const initialSourcebookPicker = page.locator(
    `tr:has(button[aria-label="Edit Sourcebook UUID link probe"]) + tr select:has(option[value="${martialArts.id}"])`,
  );
  await expect(
    initialSourcebookPicker.getByRole('option', {
      name: 'MA: GURPS Martial Arts',
      exact: true,
    }),
  ).toHaveAttribute('value', martialArts.id);
  await expect(initialSourcebookPicker).toHaveValue(martialArts.id);
  const initialMetadataSummary = page
    .locator('tr:has(button[aria-label="Edit Sourcebook UUID link probe"]) + tr summary')
    .filter({ hasText: 'Source and completeness' });
  if (!(await initialMetadataSummary.locator('..').evaluate((details) => details.open))) {
    await initialMetadataSummary.click();
  }
  await expect(initialSourcebookPicker).toBeVisible();
  await expect(page.getByLabel('Page', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Canonical key', { exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      initialSourcebookPicker.evaluate((select) => select.selectedOptions[0]?.textContent),
    )
    .toBe('MA: GURPS Martial Arts');
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('sourcebook-picker-ma-uuid.png'),
    fullPage: false,
  });

  await page.goto(`/campaigns/${campaignId}/library?section=sources`);
  await page.getByRole('button', { name: 'Edit GURPS Martial Arts' }).click();
  await expect(page.getByLabel('Source key')).toHaveCount(0);
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('sourcebook-rename-form-no-key.png'),
    fullPage: true,
  });
  await page.getByLabel('Publication title').fill('GURPS Martial Arts Revised');
  await page.getByLabel('Abbreviation').fill('MA2');
  await page.getByRole('button', { name: 'Save source' }).click();
  await expect(page.getByRole('button', { name: 'Edit GURPS Martial Arts Revised' })).toBeVisible();

  let renamedLibrary: {
    sources: { id: string; name: string; abbreviation: string }[];
    traits: { name: string; sourceId: string | null }[];
  } = { sources: [], traits: [] };
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/campaigns/${campaignId}/library`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok()) return '';
      renamedLibrary = (await response.json()) as typeof renamedLibrary;
      return (
        renamedLibrary.sources.find((source) => source.name === 'GURPS Martial Arts Revised')?.id ??
        ''
      );
    })
    .toBe(martialArts.id);
  expect(
    renamedLibrary.sources.find((source) => source.name === 'GURPS Martial Arts Revised')?.id,
  ).toBe(martialArts.id);
  expect(
    renamedLibrary.traits.find((trait) => trait.name === 'Sourcebook UUID link probe')?.sourceId,
  ).toBe(martialArts.id);

  await page.goto(`/campaigns/${campaignId}/library?section=traits`);
  await page.getByRole('button', { name: 'Edit Sourcebook UUID link probe' }).click();
  const renamedSourcebookPicker = page.locator(
    `tr:has(button[aria-label="Edit Sourcebook UUID link probe"]) + tr select:has(option[value="${martialArts.id}"])`,
  );
  await expect(
    renamedSourcebookPicker.getByRole('option', {
      name: 'MA2: GURPS Martial Arts Revised',
      exact: true,
    }),
  ).toHaveAttribute('value', martialArts.id);
  await expect(renamedSourcebookPicker).toHaveValue(martialArts.id);
  const renamedMetadataSummary = page
    .locator('tr:has(button[aria-label="Edit Sourcebook UUID link probe"]) + tr summary')
    .filter({ hasText: 'Source and completeness' });
  if (!(await renamedMetadataSummary.locator('..').evaluate((details) => details.open))) {
    await renamedMetadataSummary.click();
  }
  const pageInput = page.getByLabel('Page', { exact: true });
  await expect(renamedSourcebookPicker).toBeVisible();
  await expect(pageInput).toBeVisible();
  await expect(page.getByLabel('Canonical key', { exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      renamedSourcebookPicker.evaluate((select) => select.selectedOptions[0]?.textContent),
    )
    .toBe('MA2: GURPS Martial Arts Revised');
  await pageInput.fill('42');
  await pageInput.evaluate((input) => input.blur());

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844, screenshot: 'mobile' },
    { width: 639, height: 800 },
    { width: 640, height: 800 },
    { width: 641, height: 800 },
    { width: 1280, height: 900, screenshot: 'desktop' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(renamedSourcebookPicker).toBeVisible();
    await expect(pageInput).toBeVisible();
    await expect(pageInput).toHaveValue('42');
    const [bookBox, pageBox] = await Promise.all([
      renamedSourcebookPicker.boundingBox(),
      pageInput.boundingBox(),
    ]);
    if (!bookBox || !pageBox) throw new Error('Sourcebook or Page control is not measurable');
    expect(Math.abs(bookBox.y - pageBox.y)).toBeLessThanOrEqual(2);
    expect(pageBox.x).toBeGreaterThan(bookBox.x);
    expect(pageBox.width).toBeLessThan(bookBox.width);
    expect(pageBox.x + pageBox.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.screenshot) {
      await pageInput.scrollIntoViewIfNeeded();
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`sourcebook-picker-pages-${viewport.screenshot}.png`),
        fullPage: false,
      });
    }
  }
});
