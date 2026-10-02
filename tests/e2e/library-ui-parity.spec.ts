import { expect, test } from '@playwright/test';
import { parse, stringify } from 'yaml';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function create<T>(page: import('@playwright/test').Page, path: string, body: object) {
  const accessToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.post(`/api/v1${path}`, {
    data: body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

async function expectInsideViewport(
  locator: import('@playwright/test').Locator,
  width: number,
  height: number,
) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('visible control should have a box');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
}

test('library visual and raw editing plus package review stay usable at responsive widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`library-ui-parity-${suffix()}@example.com`);
  await page.getByLabel(/display name/i).fill('Library UI Parity QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const campaign = await create<{ id: string; experimentalActiveEffects?: boolean }>(
    page,
    '/campaigns',
    { name: 'Library UI parity QA', experimentalActiveEffects: false },
  );
  expect(campaign.experimentalActiveEffects ?? false).toBe(false);
  const source = await create<{ id: string }>(page, `/campaigns/${campaign.id}/library/sources`, {
    name: 'Synthetic Visual Rules',
    abbreviation: 'SVR',
    edition: 'Synthetic edition',
    priority: 1,
  });
  await create<{ id: string }>(page, `/campaigns/${campaign.id}/library/traits`, {
    name: 'Night Vision',
    kind: 'advantage',
    basePoints: 2,
    sourceId: source.id,
    tags: ['night vision'],
  });

  await page.goto(`/campaigns/${campaign.id}/library?section=traits`);
  await expect(page.getByRole('button', { name: /^Active Effects/ })).toBeVisible();
  const row = page.getByRole('button', { name: 'Night Vision', exact: true });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Edit Night Vision' }).click();
  await page.locator('summary').filter({ hasText: 'Raw YAML' }).first().click();
  const raw = page.getByLabel('Raw YAML');
  const rawOriginal = parse(await raw.inputValue()) as Record<string, unknown>;
  expect(rawOriginal).toMatchObject({ name: 'Night Vision', tags: ['night vision'] });
  for (const transportField of ['id', 'campaignId', 'revision', 'createdAt', 'updatedAt']) {
    expect(rawOriginal).not.toHaveProperty(transportField);
  }
  rawOriginal.name = 'Night Vision: Deep Sight';
  rawOriginal.tags = ['night vision, low light', 'observation'];
  await raw.fill(stringify(rawOriginal));
  const name = page.locator('[data-field-path="name"]');
  await expect(name).toHaveValue('Night Vision: Deep Sight');
  await name.fill('Night Vision: Deep Sight (revised)');
  const rawRoundTrip = parse(await raw.inputValue()) as Record<string, unknown>;
  expect(rawRoundTrip).toMatchObject({
    name: 'Night Vision: Deep Sight (revised)',
    tags: ['night vision, low light', 'observation'],
  });

  for (const width of [390, 639, 640, 641, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(name).toHaveValue('Night Vision: Deep Sight (revised)');
    await name.scrollIntoViewIfNeeded();
    await expectInsideViewport(name, width, 1000);
    await raw.scrollIntoViewIfNeeded();
    await expectInsideViewport(raw, width, 1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    if (width === 390 || width === 640 || width === 1440) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`library-editor-${width}.png`),
        animations: 'disabled',
      });
    }
  }
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('button', { name: 'Night Vision: Deep Sight (revised)', exact: true }),
  ).toBeVisible();

  await page.goto(`/campaigns/${campaign.id}/library-transfer`);
  await page.getByRole('button', { name: 'Edit package' }).click();
  await page.locator('summary').filter({ hasText: 'Raw YAML' }).last().click();
  const rawPackage = page.getByLabel('Package YAML');
  await expect(rawPackage).toContainText('Night Vision: Deep Sight (revised)');
  await page.getByRole('button', { name: 'Review package' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Library package?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Import preview' })).toContainText(
    'Traits: 1 in file',
  );

  for (const width of [390, 639, 640, 641, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectInsideViewport(dialog, width, 1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    if (width === 390 || width === 640 || width === 1440) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`library-package-review-${width}.png`),
        animations: 'disabled',
      });
    }
  }
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(`/campaigns/${campaign.id}/library?section=items`);
  await page.getByRole('button', { name: '+ Add item', exact: true }).click();
  await page.locator('[data-field-path="name"]').fill('Responsive weapon and calculation probe');
  await page.getByLabel('Weight (lb) setting').selectOption('value');
  const weight = page.getByLabel('Weight (lb)', { exact: true });
  await weight.fill('');
  await weight.pressSequentially('1.5');
  await expect(weight).toHaveValue('1.5');
  await page.locator('summary').filter({ hasText: 'Pricing and trait options' }).click();
  await page.locator('summary').filter({ hasText: 'Calculated pricing (optional)' }).click();
  const amount = page.getByLabel('Amount');
  await amount.fill('-');
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue('-');
  await page.getByRole('button', { name: 'Use pattern' }).click();
  await expect(amount).toHaveValue('-');
  await amount.fill('12');
  await page.getByRole('button', { name: 'Use pattern' }).click();
  await expect(page.getByText(/0 inputs · 0 tables · Outputs: cost \(currency\)/)).toBeVisible();
  await expect(page.locator('[data-field-path="calculation.nodes.0.value"]')).toHaveValue('12');
  await expect(page.locator('[data-field-path="calculation.outputs.0.min"]')).toHaveValue('0');

  await page.locator('summary').filter({ hasText: 'Equipment facets' }).click();
  await page.getByRole('checkbox', { name: 'Weapon or shield' }).check();
  await page.getByLabel('Held side').selectOption('left');
  await page.getByRole('checkbox', { name: 'Ranged statistics' }).check();
  const visualBulk = page.getByRole('textbox', { name: 'bulk', exact: true });
  await visualBulk.fill('-');
  await expect(visualBulk).toBeFocused();
  await expect(visualBulk).toHaveValue('-');
  await page
    .locator('[data-field-path="name"]')
    .fill('Responsive weapon and calculation probe renamed');
  await expect(visualBulk).toHaveValue('-');
  await visualBulk.fill('-6');
  await page.getByRole('button', { name: 'All weapon fields' }).click();
  const primaryMode = page.getByRole('group', { name: 'Modes 1' });
  const stRequiredSetting = primaryMode.getByLabel('St Required setting');
  await stRequiredSetting.selectOption('value');
  const stRequired = page.locator('[data-field-path="weaponData.modes.0.stRequired"]');
  await stRequired.fill('-');
  await expect(stRequired).toBeFocused();
  await expect(stRequired).toHaveValue('-');
  await expect(page.locator('[data-field-path="weaponData.wieldedSide"]')).toHaveValue('left');
  await page.setViewportSize({ width: 390, height: 1000 });
  await expectInsideViewport(stRequired, 390, 1000);
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('library-weapon-negative-numeric-390.png'),
    animations: 'disabled',
  });
  await stRequired.fill('11');
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(
    page.getByRole('button', {
      name: 'Responsive weapon and calculation probe renamed',
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const library = await page.evaluate(async (campaignId) => {
        const token = JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken;
        const response = await fetch(`/api/v1/campaigns/${campaignId}/library`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return response.json();
      }, campaign.id);
      return library.items.find(
        (item: { name: string }) => item.name === 'Responsive weapon and calculation probe renamed',
      )?.weightLbs;
    })
    .toBe(1.5);
});
