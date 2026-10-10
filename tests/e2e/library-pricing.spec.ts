import { expect, test } from '@playwright/test';
import { openAddItem, selectCharacterSection } from './character-navigation.ts';
import { captureReviewScreenshot } from './review-artifacts';

const itemRule = (unitCost: number) => ({
  version: 1,
  inputs: [
    {
      key: 'quantity',
      kind: 'number',
      label: 'Quantity',
      unit: 'count',
      min: 1,
      max: 20,
      step: 1,
      default: 2,
    },
  ],
  tables: [],
  nodes: [
    { id: 'unitCost', op: 'constant', value: unitCost },
    { id: 'quantity', op: 'input', key: 'quantity' },
    { id: 'cost', op: 'multiply', args: ['unitCost', 'quantity'] },
    { id: 'weightLbs', op: 'constant', value: 2.25 },
  ],
  outputs: [
    {
      key: 'cost',
      node: 'cost',
      unit: 'currency',
      min: 0,
      max: 10000,
      increment: 0.01,
      rounding: 'nearest',
    },
    {
      key: 'weightLbs',
      node: 'weightLbs',
      unit: 'pounds',
      min: 0,
      max: 10000,
      increment: 0.01,
      rounding: 'nearest',
    },
  ],
});
const traitRule = {
  version: 1,
  inputs: [],
  tables: [],
  nodes: [{ id: 'points', op: 'constant', value: 10 }],
  outputs: [
    {
      key: 'points',
      node: 'points',
      unit: 'points',
      min: 0,
      max: 1000,
      increment: 1,
      rounding: 'exact',
    },
  ],
};

const PASSWORD = 'CorrectHorseBatteryStaple1';

async function accessToken(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
}

async function api(
  page: import('@playwright/test').Page,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: object,
) {
  const response = await page.request.fetch(`/api/v1${path}`, {
    method,
    ...(body ? { data: body } : {}),
    headers: { Authorization: `Bearer ${await accessToken(page)}` },
  });
  if (!response.ok()) throw new Error(`${method} ${path} failed: ${await response.text()}`);
  return response.json();
}

test('resolves and reopens an item price without clipping the modal at supported widths', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`library-price-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Pricing player');
  await page.getByLabel(/^password\b/i).fill(PASSWORD);
  const registrationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/register') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  const registration = await registrationResponse;
  expect(registration.status(), await registration.text()).toBe(201);
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const campaign = (await api(page, 'POST', '/campaigns', { name: 'Pricing campaign' })) as {
    id: string;
  };
  await page.goto(`/campaigns/${campaign.id}/library?section=sources`);
  await expect(page.getByRole('button', { name: /Sources/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /\+ Add source/i }).click();
  await page.getByLabel('Publication title').fill('Pricing Rules');
  await expect(page.getByLabel('Source key')).toHaveCount(0);
  await page.getByLabel('Abbreviation').fill('PR');
  await page.getByLabel('Edition setting').selectOption('value');
  await page.getByLabel('Edition', { exact: true }).fill('First edition');
  await page.getByLabel('Notes setting').selectOption('value');
  await page
    .getByLabel('Notes', { exact: true })
    .fill(
      'Long source note retained verbatim: a campaign-authored publication record with provenance, errata context, and editorial details for this complete pricing rule.',
    );
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Add sourcebook' }).click();
  await expect(page.getByText('Pricing Rules', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  let pricingSourceId = '';
  await expect
    .poll(async () => {
      const library = (await api(page, 'GET', `/campaigns/${campaign.id}/library`)) as {
        sources: { id: string; name: string }[];
      };
      pricingSourceId = library.sources.find((source) => source.name === 'Pricing Rules')?.id ?? '';
      return pricingSourceId;
    })
    .toMatch(/^[0-9a-f-]{36}$/i);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: /Modifiers/ }).click();
  await page.getByRole('button', { name: /\+ Add modifier/i }).click();
  const modifierName = 'Flexible grip across extended operating range';
  await page.getByRole('textbox', { name: 'Name' }).fill(modifierName);
  await page
    .locator('summary')
    .filter({ hasText: /^Source and completeness/ })
    .click();
  await page.getByLabel('Sourcebook').selectOption(pricingSourceId);
  await page.getByLabel('Source setting').selectOption('value');
  await page.getByLabel('Source', { exact: true }).fill('PR, p. 99');
  await page
    .locator('summary')
    .filter({ hasText: /^Groups and tags/ })
    .click();
  await page.getByRole('button', { name: 'Add tags', exact: true }).click();
  await page.locator('[data-field-path="tags.0"]').fill('grip');
  await page.getByRole('button', { name: 'Add tags', exact: true }).click();
  await page.locator('[data-field-path="tags.1"]').fill('long-form');
  await page.getByLabel('Group setting').selectOption('value');
  await page.getByLabel('Group', { exact: true }).fill('handling');
  await page.getByLabel('Description setting').selectOption('value');
  await page
    .locator('[contenteditable="true"]')
    .fill(
      'A long descriptive note for this modifier explains its fictional handling tradeoff and reminds campaign authors to keep the rule connected to its source edition.',
    );
  await page
    .locator('summary')
    .filter({ hasText: /^Pricing and trait options/ })
    .click();
  await page
    .locator('summary')
    .filter({ hasText: /^Effects and capabilities/ })
    .click();
  await page.getByLabel('All traits', { exact: true }).check();
  const calculationRule = page.getByRole('group', { name: 'Calculation rule' });
  await page
    .locator('summary')
    .filter({ hasText: /^Calculated pricing/ })
    .click();
  await page.getByLabel('Pattern').selectOption('per-unit');
  await page.getByLabel('Amount').fill('10');
  await page.getByLabel('Minimum').fill('1');
  await page.getByLabel('Maximum').fill('10');
  await page.getByLabel('Step').fill('1');
  await page.getByRole('button', { name: 'Use pattern' }).click();
  await expect(page.getByText(/1 inputs · 0 tables · Outputs:/)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  const editorBox = await calculationRule.boundingBox();
  if (!editorBox) throw new Error('calculation editor is not visible at 320px');
  expect(editorBox.x).toBeGreaterThanOrEqual(0);
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(320);
  await calculationRule.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('calculation-editor-320.png'),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Add modifier' }).click();
  const savedModifier = page.getByRole('button', { name: modifierName, exact: true });
  await expect(savedModifier).toBeVisible();
  await expect(savedModifier.locator('.badge')).toHaveCount(0);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(async () => {
      const library = (await api(page, 'GET', `/campaigns/${campaign.id}/library`)) as {
        modifiers: { name: string; tags: string[]; group: string | null; source: string | null }[];
      };
      const modifier = library.modifiers.find((entry) => entry.name === modifierName);
      return modifier
        ? { tags: modifier.tags, group: modifier.group, source: modifier.source }
        : null;
    })
    .toMatchObject({ tags: ['grip', 'long-form'], group: 'handling', source: 'PR, p. 99' });
  await api(page, 'POST', `/campaigns/${campaign.id}/library/sources`, {
    name: 'Pricing Rules',
    abbreviation: 'PR2',
    edition: 'Second edition',
    priority: 2,
  });
  const sources = (await api(page, 'GET', `/campaigns/${campaign.id}/library`)) as {
    sources: { id: string; name: string; abbreviation: string }[];
  };
  const secondPricingSourceId = sources.sources.find(
    (source) => source.name === 'Pricing Rules' && source.abbreviation === 'PR2',
  )?.id;
  if (!secondPricingSourceId) throw new Error('Second pricing source was not created');
  await api(page, 'POST', '/characters', {
    name: 'Pricing character',
    campaignId: campaign.id,
  });
  const pricedItem = (await api(page, 'POST', `/campaigns/${campaign.id}/library/items`, {
    name: 'Priced spear',
    key: 'priced-spear',
    sourceId: pricingSourceId,
    sourceLocator: 'p. 42',
    status: 'complete',
    role: 'template',
    calculation: itemRule(6),
    cost: 12,
    weightLbs: 2.25,
    isArmor: true,
    armor: { locations: ['torso'], dr: 2 },
    weaponData: {
      skill: 'Spear',
      damage: 'thr+2 imp',
      modes: [
        {
          key: 'thrust',
          name: 'Thrust',
          skill: 'Spear',
          damage: 'thr+2 imp',
          reach: '1',
          parry: '0',
          stRequired: 9,
        },
        {
          key: 'bow-shot',
          name: 'Bow shot',
          skill: 'Bow',
          damage: '1d+2 imp',
          ranged: {
            acc: 3,
            range: { kind: 'fixed', halfDamageYards: 100, maxYards: 150 },
            rof: '1',
            shots: '1(2)',
            bulk: -5,
          },
        },
      ],
    },
  })) as { id: string };
  await api(page, 'POST', `/campaigns/${campaign.id}/library/items`, {
    name: 'Priced spear',
    key: 'priced-spear',
    sourceId: secondPricingSourceId,
    status: 'complete',
    role: 'template',
    calculation: itemRule(11),
    cost: 22,
    weightLbs: 2.25,
    weaponData: {
      modes: [
        { key: 'thrust', name: 'Thrust' },
        { key: 'swing', name: 'Swing', damage: 'thr+3 cut' },
      ],
    },
  });
  await api(page, 'POST', `/campaigns/${campaign.id}/library/items`, {
    name: 'Unreviewed spear',
    key: 'unreviewed-spear',
    sourceId: pricingSourceId,
    status: 'needs_review',
    role: 'definition',
    cost: 1,
    weightLbs: 1,
  });
  await api(page, 'POST', `/campaigns/${campaign.id}/library/traits`, {
    name: 'Variable Focus',
    key: 'variable-focus',
    sourceId: pricingSourceId,
    kind: 'advantage',
    status: 'complete',
    role: 'definition',
    basePoints: 10,
    calculation: traitRule,
  });

  await page.goto(`/campaigns/${campaign.id}/library?section=items`);
  await expect(page.getByRole('button', { name: /Items\s+3/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('searchbox', { name: 'Search library' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('searchbox', { name: 'Search library' }).fill('Unreviewed spear');
  const unreviewed = page.getByRole('button', { name: 'Unreviewed spear', exact: true });
  await expect(unreviewed).toBeVisible();
  await expect(unreviewed.locator('.badge')).toHaveCount(0);

  await page.goto('/characters');
  await expect(page.getByRole('link', { name: 'Pricing character' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('link', { name: 'Pricing character' }).click();
  await expect(page).toHaveURL(/\/characters\//);
  await selectCharacterSection(page, 'Traits');
  await page.getByRole('button', { name: '+ Add trait' }).click();
  const traitName = page.getByRole('textbox', { name: 'Trait name' });
  await traitName.fill('Variable Focus');
  await page.getByRole('option', { name: /Variable Focus/ }).click();
  const traitDialog = page.getByRole('dialog', { name: 'Point cost for Variable Focus' });
  await expect(traitDialog).toBeVisible();
  await traitDialog.getByRole('checkbox', { name: modifierName, exact: true }).check();
  await expect(traitDialog).not.toContainText('pricing-rules');
  await traitDialog.getByLabel('level').fill('3');
  await expect(traitDialog.getByText(`${modifierName}: 30%`)).toBeVisible();
  await expect(traitDialog.getByText('Total: 13 points')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(async () => {
      const box = await traitDialog.locator('.modal-box').boundingBox();
      return Boolean(
        box && box.x >= 0 && box.x + box.width <= 320 && box.y >= 0 && box.y + box.height <= 800,
      );
    })
    .toBe(true);
  const traitDialogBox = await traitDialog.locator('.modal-box').boundingBox();
  if (!traitDialogBox) throw new Error('trait resolver is not visible at 320px');
  expect(traitDialogBox.x).toBeGreaterThanOrEqual(0);
  expect(traitDialogBox.x + traitDialogBox.width).toBeLessThanOrEqual(320);
  expect(traitDialogBox.y).toBeGreaterThanOrEqual(0);
  expect(traitDialogBox.y + traitDialogBox.height).toBeLessThanOrEqual(800);
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('trait-resolver-selected-modifier-320.png'),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await traitDialog.getByRole('button', { name: 'Use these values' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Variable Focus', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Variable Focus' }).click();
  await expect(page.getByText('Saved point cost')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recalculate points' })).toBeVisible();
  await selectCharacterSection(page, 'Inventory');
  const itemName = page.getByLabel('Item name');
  await openAddItem(page);
  await itemName.fill('Priced spear');
  await expect(page.getByRole('option', { name: /Priced spear/ })).toHaveCount(1);
  await itemName.fill('Unreviewed spear');
  await expect(page.getByRole('option', { name: /Unreviewed spear/ })).toHaveCount(0);
  await itemName.fill('Priced spear');
  await expect(page.getByRole('option', { name: /Priced spear/ })).toHaveCount(1);
  await itemName.press('Escape');
  await page.getByRole('button', { name: 'Other sources' }).click();
  const editionOptions = page.getByRole('option', { name: /Priced spear/ });
  await expect(editionOptions).toHaveCount(2);
  await expect(editionOptions.nth(0)).not.toContainText('pricing-rules');
  await expect(editionOptions.nth(1)).not.toContainText('pricing-rules-2');
  for (const width of [320, 639, 640, 641, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const list = page.getByRole('listbox');
    await expect(list).toBeVisible();
    await expect(async () => {
      const box = await list.boundingBox();
      if (!box) throw new Error('library choices are not visible');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
    }).toPass({ timeout: 5_000 });
    if (width === 320 || width === 640) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`library-choices-${width}.png`),
        fullPage: false,
      });
    }
  }
  await editionOptions.nth(0).click();

  const dialog = page.getByRole('dialog', { name: 'Price for Priced spear' });
  await expect(dialog).toBeVisible();
  for (const width of [320, 639, 640, 641, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(async () => {
      const box = await dialog.locator('.modal-box').boundingBox();
      if (!box) throw new Error('pricing dialog box is not visible');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
    }).toPass({ timeout: 5_000 });
    await expect(dialog.getByRole('button', { name: 'Use these values' })).toBeVisible();
    if (width === 320 || width === 640) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`pricing-resolver-${width}.png`),
        fullPage: true,
      });
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  }

  await expect(dialog.getByText('Cost: $12', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Weight: 2.25 lb', { exact: true })).toBeVisible();
  await dialog.getByLabel('Quantity').fill('3');
  await expect(dialog.getByText('Cost: $18', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Use these values' }).click();
  await page.getByRole('button', { name: 'Change pricing choices' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Previously saved: Cost: $18 · Weight: 2.25 lb')).toBeVisible();
  await dialog.getByRole('button', { name: 'Use these values' }).click();
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByText('Priced spear', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Priced spear' }).click();
  await expect(page.getByText('Saved price and weight')).toBeVisible({ timeout: 20_000 });
  const itemRow = page.locator('.inventory-item-row').filter({ hasText: 'Priced spear' });
  await expect(itemRow).toContainText('18');
  await expect(page.getByRole('button', { name: 'Armor settings for Priced spear' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Weapon settings for Priced spear/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Weapon settings for Priced spear/ }).click();
  const weaponEditor = page.getByRole('region', { name: 'Priced spear: Weapon' });
  const rangedMode = weaponEditor.getByRole('group', { name: 'Alternate attack 1' });
  await expect(rangedMode.getByLabel('Attack name')).toHaveValue('Bow shot');
  await expect(rangedMode.getByRole('combobox', { name: 'Range', exact: true })).toHaveValue(
    'fixed',
  );
  await expect(rangedMode.getByRole('spinbutton', { name: '1/2D (yd)', exact: true })).toHaveValue(
    '100',
  );
  await expect(rangedMode.getByRole('spinbutton', { name: 'Max (yd)', exact: true })).toHaveValue(
    '150',
  );
  await page.getByRole('button', { name: 'Edit Priced spear' }).click();
  await api(page, 'PATCH', `/campaigns/${campaign.id}/library/items/${pricedItem.id}`, {
    calculation: itemRule(9),
  });
  await expect(
    page.getByText('Library price changed — using your saved price and weight'),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(itemRow).toContainText('18');
  await page.getByRole('button', { name: 'Recalculate price' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Previously saved: Cost: $18 · Weight: 2.25 lb')).toBeVisible();
  await expect(dialog.getByText('Cost: $27', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Use these values' }).click();
  await expect(page.getByText('Saved price and weight')).toBeVisible();
  await expect(itemRow).toContainText('27');
});
