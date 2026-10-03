import { type Locator, type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';
import { captureReviewScreenshot } from './review-artifacts';

const SHOTS = 'docs/screenshots/interaction-refresh';
const WIDTHS = [320, 375, 390, 575, 639, 640, 641, 767, 768, 769, 1023, 1024, 1025, 1280];
const LONG_NAME = 'Highland'.repeat(20); // Schema-supported 160-character unbroken name.

test.use({ serviceWorkers: 'block', colorScheme: 'dark', actionTimeout: 15_000 });

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  if (!result) throw new Error('Visible element has no bounding box');
  return result;
}
async function inside(page: Page, locator: Locator, vertical = false) {
  const rect = await box(locator);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport is unavailable');
  expect(rect.x).toBeGreaterThanOrEqual(-1);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
  if (vertical) {
    expect(rect.y).toBeGreaterThanOrEqual(-1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
  }
}
async function noHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
}
async function expectOptionHitTargets(page: Page, list: Locator) {
  const option = list.getByRole('option').first();
  const optionBox = await box(option);
  const listId = await list.getAttribute('id');
  const optionId = await option.getAttribute('id');
  expect(listId).toBeTruthy();
  expect(optionId).toBeTruthy();
  const points = [{ x: optionBox.x + optionBox.width / 2, y: optionBox.y + optionBox.height / 2 }];
  // Desktop uses a dock instead of this mobile toggle. Do not pay the action
  // timeout looking for an absent element on every autocomplete assertion.
  const navigationToggle = page.locator('.sheet-nav-toggle');
  const navigation = (await navigationToggle.isVisible())
    ? await navigationToggle.boundingBox()
    : null;
  if (navigation) {
    const left = Math.max(optionBox.x, navigation.x);
    const top = Math.max(optionBox.y, navigation.y);
    const right = Math.min(optionBox.x + optionBox.width, navigation.x + navigation.width);
    const bottom = Math.min(optionBox.y + optionBox.height, navigation.y + navigation.height);
    if (left < right && top < bottom) points.push({ x: (left + right) / 2, y: (top + bottom) / 2 });
  }
  for (const point of points) {
    const hit = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return {
        optionId: element?.closest('[role="option"]')?.id ?? null,
        listboxId: element?.closest('[role="listbox"]')?.id ?? null,
      };
    }, point);
    expect(hit.optionId, `pointer target at ${point.x},${point.y} is not the suggestion`).toBe(
      optionId,
    );
    expect(hit.listboxId).toBe(listId);
  }
}
async function suggestions(page: Page, input: Locator, query: string) {
  await input.fill(query);
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  const listId = await input.getAttribute('aria-controls');
  if (!listId) throw new Error('Open combobox has no listbox reference');
  const list = page.locator(`[id="${listId}"]`);
  await inside(page, list, true);
  await expect(list.getByRole('option').first()).toBeVisible();
  await expectOptionHitTargets(page, list);
  return list;
}
async function skillSuggestions(page: Page, input: Locator, query: string) {
  await input.fill(query);
  const list = page.getByRole('listbox');
  await inside(page, list, true);
  await expect(list.getByRole('option').first()).toBeVisible();
  await expectOptionHitTargets(page, list);
  return list;
}

async function expectSummary(table: Locator, name: string) {
  const summary = table.getByRole('rowgroup', { name, exact: true }).locator('tr').first();
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary.locator('td').first()).toContainText(name);
}
async function captureOverlay(page: Page, name: string, width: number) {
  if ([320, 375, 575, 639, 640, 641, 1023, 1024, 1025].includes(width)) {
    await captureReviewScreenshot(page, { path: `test-results/interaction-${name}-${width}.png` });
  }
}

async function setup(page: Page) {
  await page.goto('/register');
  await page
    .getByLabel(/email/i)
    .fill(`interaction-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByLabel(/display name/i).fill('Interaction player');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  async function create(path: string, data: object) {
    const response = await page.request.post(`/api/v1${path}`, {
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  async function remove(path: string) {
    const response = await page.request.delete(`/api/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const campaign = await create('/campaigns', { name: 'Coastal expedition' });
  await create(`/campaigns/${campaign.id}/library/languages`, { name: 'Coast Common' });
  await create(`/campaigns/${campaign.id}/library/languages`, { name: LONG_NAME });
  await create(`/campaigns/${campaign.id}/library/techniques`, {
    name: 'Feint',
    defaultSkillName: 'Broadsword',
    difficulty: 'A',
    defaultModifier: -2,
    maxLevel: 2,
  });
  const character = await create('/characters', {
    name: 'Mara of the Coast',
    campaignId: campaign.id,
  });
  const path = `/characters/${character.id}`;
  await create(`${path}/skills`, {
    name: 'Broadsword',
    attribute: 'DX',
    difficulty: 'A',
    points: 4,
  });
  await create(`${path}/skills`, { name: LONG_NAME, attribute: 'DX', difficulty: 'A', points: 4 });
  const pack = (
    await create(`${path}/inventory`, {
      name: 'Travel pack',
      worn: true,
      isContainer: true,
      weightLbs: 2,
      cost: 60,
    })
  ).item;
  const pouch = (
    await create(`${path}/inventory`, {
      name: 'Map case',
      parentId: pack.id,
      isContainer: true,
      weightLbs: 0.5,
      cost: 20,
    })
  ).item;
  const nested = (
    await create(`${path}/inventory`, {
      name: 'Coastal charts',
      parentId: pouch.id,
      quantity: 3,
      weightLbs: 0.1,
      cost: 15,
    })
  ).item;
  const rations = (
    await create(`${path}/inventory`, {
      name: 'Trail rations',
      parentId: pack.id,
      quantity: 3,
      weightLbs: 0.5,
      cost: 12,
    })
  ).item;
  const lastKit = (
    await create(`${path}/inventory`, {
      name: 'Weatherproof kit',
      parentId: pack.id,
      isContainer: true,
      weightLbs: 1,
      cost: 25,
    })
  ).item;
  const nestedBlade = (
    await create(`${path}/inventory`, {
      name: 'Signal blade',
      parentId: lastKit.id,
      weightLbs: 1,
      cost: 40,
      weaponData: { damage: 'sw cut', skill: 'Knife' },
    })
  ).item;
  const sword = (
    await create(`${path}/inventory`, {
      name: 'Broadsword',
      worn: true,
      weightLbs: 3,
      cost: 500,
      weaponData: { damage: 'sw+1 cut', skill: 'Broadsword' },
    })
  ).item;
  const longItem = (
    await create(`${path}/inventory`, { name: LONG_NAME, worn: true, weightLbs: 1, cost: 10 })
  ).item;
  await page.goto(path);
  await selectCharacterSection(page, 'Skills');
  return {
    path,
    create,
    remove,
    pack,
    pouch,
    nested,
    rations,
    lastKit,
    nestedBlade,
    sword,
    longItem,
  };
}

test('languages, techniques and inventory retain edits and fit their responsive layouts', async ({
  page,
}) => {
  test.setTimeout(540_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await setup(page);
  const languageFold = page
    .locator('.fold-section > h2 > button.fold-heading')
    .filter({ hasText: /^Languages$/ });
  const techniqueFold = page
    .locator('.fold-section > h2 > button.fold-heading')
    .filter({ hasText: /^Techniques$/ });
  const languages = languageFold.locator('xpath=ancestor::section[1]');
  const techniques = techniqueFold.locator('xpath=ancestor::section[1]');
  await expect(languages.getByRole('button', { name: '+ Add language' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(techniques.getByRole('button', { name: '+ Add technique' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(languages.getByText('No languages yet.')).toBeVisible();
  await languages.getByRole('button', { name: '+ Add language' }).click();
  const languageForm = languages.locator('form.field-rollback-flash');
  const languageName = languageForm.getByLabel('Language', { exact: true });
  await languageName.fill('Draft language');
  await languages.getByRole('button', { name: 'Close add form' }).click();
  await expect(languageForm).toBeHidden();
  await languages.getByRole('button', { name: '+ Add language' }).click();
  await expect(languageName).toHaveValue('Draft language');
  await suggestions(page, languageName, 'Coast');
  await languageFold.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
  await languageFold.press('Enter');
  await expect(languageName).toHaveValue('Coast');
  const coastOptions = await suggestions(page, languageName, 'Coast');
  await coastOptions.getByRole('option', { name: 'Coast Common' }).click();
  await languageForm.getByRole('button', { name: 'Add language', exact: true }).click();
  const languageTable = languages.getByRole('table', { name: 'Languages', exact: true });
  await expectSummary(languageTable, 'Coast Common');
  await expect(languageForm).toBeVisible();
  await languages.getByRole('button', { name: 'Close add form' }).click();

  await techniques.getByRole('button', { name: '+ Add technique' }).click();
  const techniqueForm = techniques.locator('form.field-rollback-flash');
  const techniqueName = techniqueForm.getByLabel('Technique', { exact: true });
  const feintOptions = await suggestions(page, techniqueName, 'Feint');
  await feintOptions.getByRole('option', { name: /Feint/ }).click();
  await techniqueForm.getByRole('button', { name: 'Add technique', exact: true }).click();
  const techniqueTable = techniques.getByRole('table', { name: 'Techniques', exact: true });
  await expect(
    techniqueTable.getByRole('button', { name: 'Roll Feint', exact: true }),
  ).toBeVisible();
  await expect(techniqueForm).toBeVisible();
  await techniques.getByRole('button', { name: 'Close add form' }).click();
  await techniqueTable.getByRole('button', { name: 'Roll Feint', exact: true }).click();
  const roll = page.getByRole('dialog', { name: 'Roll Feint', exact: true });
  await inside(page, roll, true);
  await roll.getByRole('button', { name: 'Close', exact: true }).last().click();

  await languageTable.getByRole('button', { name: 'Edit Coast Common', exact: true }).click();
  const nameInput = languages.locator('input[aria-label$=" name"]');
  await nameInput.fill('Coastal Common');
  await nameInput.blur();
  await expectSummary(languageTable, 'Coastal Common');
  await languageTable.getByRole('button', { name: 'Close Coastal Common', exact: true }).click();
  await expect(nameInput).toBeHidden();
  await languageTable.getByRole('button', { name: 'Edit Coastal Common', exact: true }).click();
  await expect(nameInput).toHaveValue('Coastal Common');
  await languages
    .getByRole('button', { name: 'Delete language Coastal Common', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectSummary(languageTable, 'Coastal Common');
  await languages
    .getByRole('button', { name: 'Delete language Coastal Common', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(languages.getByText('No languages yet.')).toBeVisible();
  await languages.getByRole('button', { name: '+ Add language' }).click();
  await languageName.fill('Coast Common');
  await languageForm.getByRole('button', { name: 'Add language', exact: true }).click();
  await expectSummary(languageTable, 'Coast Common');
  await languages.getByRole('button', { name: 'Close add form' }).click();

  // Use the schema boundary alongside normal entries, so wrapping is real and captures remain legible.
  const stressLanguage = await fixture.create(`${fixture.path}/languages`, {
    name: LONG_NAME,
    spokenFluency: 'accented',
    writtenFluency: 'broken',
    points: 3,
  });
  const stressTechnique = await fixture.create(`${fixture.path}/techniques`, {
    name: 'Highland defense',
    defaultSkillName: LONG_NAME,
    difficulty: 'H',
    defaultModifier: -4,
    points: 3,
  });
  await page.reload();
  await selectCharacterSection(page, 'Skills');
  const longLanguage = languageTable.getByRole('rowgroup', { name: LONG_NAME, exact: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await inside(page, languageTable);
    await inside(page, techniqueTable);
    await inside(page, longLanguage.locator('tr').first().locator('td').first());
    await expectSummary(languageTable, LONG_NAME);
    const highland = techniqueTable.getByRole('rowgroup', {
      name: 'Highland defense',
      exact: true,
    });
    await expect(highland).toContainText(LONG_NAME);
    await inside(page, highland.locator('tr').first());
    await noHorizontalOverflow(page);
    await languageTable.getByRole('button', { name: 'Language', exact: true }).click();
    const filter = page.getByRole('dialog', { name: 'Filter Language', exact: true });
    await inside(page, filter, true);
    await expect(filter.getByText(LONG_NAME, { exact: true })).toBeVisible();
    await captureOverlay(page, 'filter', width);
    await page.keyboard.press('Escape');
    await expect(filter).toBeHidden();
    await languages.getByRole('button', { name: '+ Add language' }).click();
    await suggestions(page, languageName, 'Highland');
    await captureOverlay(page, 'library', width);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
    await languages.getByRole('button', { name: 'Close add form' }).click();
    await techniques.getByRole('button', { name: '+ Add technique' }).click();
    const defaults = techniqueForm.locator('input[aria-label="Defaults from"]');
    await skillSuggestions(page, defaults, 'Highland');
    await captureOverlay(page, 'skill', width);
    await techniqueFold.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeHidden();
    await techniqueFold.press('Enter');
    await expect(defaults).toHaveValue('Highland');
    await techniques.getByRole('button', { name: 'Close add form' }).click();
    if (width === 375) {
      await techniques.scrollIntoViewIfNeeded();
      await captureReviewScreenshot(page, {
        path: 'test-results/languages-techniques-stress-mobile.png',
      });
    }
  }

  await selectCharacterSection(page, 'Inventory');
  const inventory = page.getByRole('table', { name: 'Carried inventory', exact: true });
  const pack = page.locator(`#inventory-${fixture.pack.id}`);
  const pouch = page.locator(`#inventory-${fixture.pouch.id}`);
  const nested = page.locator(`#inventory-${fixture.nested.id}`);
  const rations = page.locator(`#inventory-${fixture.rations.id}`);
  const lastKit = page.locator(`#inventory-${fixture.lastKit.id}`);
  const nestedBlade = page.locator(`#inventory-${fixture.nestedBlade.id}`);
  const sword = page.locator(`#inventory-${fixture.sword.id}`);
  await page.setViewportSize({ width: 375, height: 900 });
  await pack.getByRole('button', { name: 'Expand contents' }).click();
  await pouch.getByRole('button', { name: 'Expand contents' }).click();
  await lastKit.getByRole('button', { name: 'Expand contents' }).click();
  await expect(nested.getByText('Coastal charts', { exact: true })).toBeVisible();
  await expect(rations.getByText('Trail rations', { exact: true })).toBeVisible();
  await expect(nestedBlade.getByText('Signal blade', { exact: true })).toBeVisible();
  await captureReviewScreenshot(page, {
    path: 'test-results/inventory-tree-before-checks-mobile.png',
  });

  // Selection and an unblurred editor draft must survive collapsing the root
  // container. These are visible interactions, not a direct state assertion.
  const unselectedColor = await nestedBlade.evaluate(
    (row) => getComputedStyle(row).backgroundColor,
  );
  await nestedBlade.getByText('Signal blade', { exact: true }).click();
  await expect(nestedBlade).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() => nestedBlade.evaluate((row) => getComputedStyle(row).backgroundColor))
    .not.toBe(unselectedColor);
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await nestedBlade.getByRole('button', { name: 'Weapon settings for Signal blade' }).click();
  const nestedEditor = page.getByRole('region', { name: 'Signal blade: Weapon', exact: true });
  const nestedDamage = nestedEditor.getByLabel('Damage', { exact: true });
  await expect(nestedDamage).toHaveValue('sw cut');
  await nestedDamage.fill('sw+2 cut');
  await expect(nestedDamage).toHaveValue('sw+2 cut');
  await pack.getByRole('button', { name: 'Collapse contents' }).dispatchEvent('click');
  await expect(nestedBlade).toBeHidden();
  await expect(nestedEditor).toBeHidden();
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await pack.getByRole('button', { name: 'Expand contents' }).dispatchEvent('click');
  await expect(nestedBlade).toBeVisible();
  await expect(nestedBlade).toHaveAttribute('aria-selected', 'true');
  await expect(nestedEditor).toBeVisible();
  await expect(nestedDamage).toHaveValue('sw+2 cut');

  // Search reveals a matching last sibling and only the ancestors needed to reach it.
  const inventorySearch = page.getByRole('searchbox', { name: 'Filter inventory' });
  await inventorySearch.fill('Trail rations');
  await expect(pack.getByText('Travel pack', { exact: true })).toBeVisible();
  await expect(rations.getByText('Trail rations', { exact: true })).toBeVisible();
  await expect(pouch).toBeHidden();
  await expect(nested).toBeHidden();
  await expect(lastKit).toBeHidden();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  // A table-column filter uses the same matching descendants.
  await page.setViewportSize({ width: 1280, height: 900 });
  await inventory.getByRole('button', { name: 'Item', exact: true }).click();
  const itemFilter = page.getByRole('dialog', { name: 'Filter Item', exact: true });
  await itemFilter.getByRole('checkbox', { name: 'Trail rations', exact: true }).check();
  await itemFilter.getByRole('button', { name: 'Close filter', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(rations).toBeVisible();
  await expect(pouch).toBeHidden();
  await expect(nested).toBeHidden();
  await expect(lastKit).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await inventory.getByRole('button', { name: 'Item', exact: true }).click();
  const clearItemFilter = page.getByRole('dialog', { name: 'Filter Item', exact: true });
  await clearItemFilter.getByRole('button', { name: 'Clear column filter', exact: true }).click();
  await clearItemFilter.getByRole('button', { name: 'Close filter', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });

  await sword.getByRole('button', { name: 'Edit Broadsword', exact: true }).click();
  const itemEditor = page.getByRole('region', { name: 'Broadsword: Item details', exact: true });
  await itemEditor.getByLabel('Equipped', { exact: true }).check();
  await itemEditor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    sword.getByRole('button', { name: 'Equipped: Broadsword', exact: true }).locator('svg'),
  ).toBeVisible();
  await sword.getByRole('button', { name: 'Weapon settings for Broadsword', exact: true }).click();
  const weaponEditor = page.getByRole('region', { name: 'Broadsword: Weapon', exact: true });
  await expect(weaponEditor.getByLabel('Damage', { exact: true })).toHaveValue('sw+1 cut');
  await weaponEditor.getByRole('button', { name: 'Done', exact: true }).click();
  const tip = page.getByText('tip: shift-click to select a range; ⌘/ctrl-click to toggle', {
    exact: true,
  });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await inside(page, inventory);
    await expect(sword.getByText('Broadsword', { exact: true })).toBeVisible();
    await expect(sword.locator('[data-label="Qty"]')).toHaveText('1');
    await expect(sword.locator('[data-label="Weight (lb)"]')).toHaveText('3');
    await expect(sword.locator('[data-label="Cost"]')).toHaveText('500');
    await inside(
      page,
      page.locator(`#inventory-${fixture.longItem.id}`).locator('.inventory-item-name'),
    );
    await noHorizontalOverflow(page);
    const rootName = await box(pack.locator('.inventory-item-name'));
    const childName = await box(nested.locator('.inventory-item-name'));
    expect(childName.x).toBeGreaterThan(rootName.x);
    for (const row of [pack, pouch, nested, rations, lastKit, nestedBlade]) {
      await inside(page, row.locator('.inventory-item-name'));
    }
    if (width < 640) {
      await expect(tip).toBeHidden();
      // Two-line rows: name and chips on the left; weight above quantity and
      // cost on the right. Quantity 1 is implied rather than repeated.
      await expect(sword.locator('[data-label="Qty"]')).toBeHidden();
      const heading = await box(rations.locator('.inventory-item-heading'));
      const qty = await box(rations.locator('[data-label="Qty"]'));
      const weight = await box(rations.locator('[data-label="Weight (lb)"]'));
      const cost = await box(rations.locator('[data-label="Cost"]'));
      await expect(rations.locator('[data-label="Qty"]')).toHaveText('3');
      expect(heading.x + heading.width).toBeLessThanOrEqual(Math.min(weight.x, qty.x) + 1);
      expect(weight.y).toBeLessThan(heading.y + heading.height);
      expect(qty.y).toBeGreaterThanOrEqual(weight.y + weight.height - 1);
      expect(Math.abs(qty.y - cost.y)).toBeLessThanOrEqual(1);
      expect(qty.x + qty.width).toBeLessThanOrEqual(cost.x + 1);
      expect(Math.abs(weight.x + weight.width - (cost.x + cost.width))).toBeLessThanOrEqual(1);
      expect((await box(rations)).height).toBeLessThanOrEqual(56);

      // Each nesting level indents the name, and the chevron's touch target
      // extends beyond its 20px glyph slot.
      const names = [];
      for (const row of [pack, pouch, nested])
        names.push(await box(row.locator('.inventory-item-title')));
      expect(names[1].x).toBeGreaterThan(names[0].x + 8);
      expect(names[2].x).toBeGreaterThan(names[1].x + 8);
      const chevron = pack.getByRole('button', { name: 'Collapse contents' });
      const chevronBox = await box(chevron);
      for (const [dx, dy] of [
        [0, -16],
        [0, 16],
        [-16, 0],
      ]) {
        const hit = await page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null,
          {
            x: chevronBox.x + chevronBox.width / 2 + dx,
            y: chevronBox.y + chevronBox.height / 2 + dy,
          },
        );
        expect(hit).toBe('Collapse contents');
      }
    } else {
      await expect(tip).toBeVisible();
      await expect(inventory.getByRole('columnheader', { name: 'Qty', exact: true })).toBeVisible();
    }
    if (width === 375 || width === 1280) {
      await inventory.scrollIntoViewIfNeeded();
      await captureReviewScreenshot(page, {
        path: `test-results/inventory-stress-${width === 375 ? 'mobile' : 'desktop'}.png`,
      });
    }
  }
  await fixture.remove(`${fixture.path}/languages/${stressLanguage.language.id}`);
  await fixture.remove(`${fixture.path}/techniques/${stressTechnique.technique.id}`);
  await fixture.remove(`${fixture.path}/inventory/${fixture.longItem.id}`);
  await fixture.remove(`${fixture.path}/inventory/${fixture.nestedBlade.id}`);
  await fixture.remove(`${fixture.path}/inventory/${fixture.lastKit.id}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await selectCharacterSection(page, 'Skills');
  await expect(languageTable.getByRole('rowgroup', { name: LONG_NAME, exact: true })).toHaveCount(
    0,
  );
  await expect(
    techniqueTable.getByRole('rowgroup', { name: 'Highland defense', exact: true }),
  ).toHaveCount(0);
  await page.locator('.fold-section').getByRole('button', { name: 'Skills', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  await techniqueFold.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, { path: `${SHOTS}/languages-techniques-mobile.png` });
  await selectCharacterSection(page, 'Inventory');
  await expect(page.locator(`#inventory-${fixture.longItem.id}`)).toHaveCount(0);
  await pack.scrollIntoViewIfNeeded();
  await pack.getByRole('button', { name: 'Collapse contents' }).click();
  await expect(pack.getByLabel(/^\d+ contained items?$/)).toBeVisible();
  await captureReviewScreenshot(page, { path: `${SHOTS}/inventory-mobile-collapsed.png` });
  await pack.getByRole('button', { name: 'Expand contents' }).click();
  await expect(nested).toBeVisible();
  await captureReviewScreenshot(page, { path: `${SHOTS}/inventory-mobile.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await pack.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, { path: `${SHOTS}/inventory-desktop.png` });
});
