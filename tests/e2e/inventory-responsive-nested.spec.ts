import { type Locator, expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

const PASSWORD = 'CorrectHorseBatteryStaple1';
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
const PACK_NAME = 'UnbrokenTrailPackName'.repeat(4);
const POUCH_NAME = 'UnbrokenInnerPouchName'.repeat(3);
const CASE_NAME = 'UnbrokenSmallCaseName'.repeat(3);
const ITEM_NAME = 'UnbrokenInventoryItemName'.repeat(4);
const LANGUAGE_ITEM = 'Long name inventory editor test item '.repeat(3).trim();
const ENCHANTMENT_NAME = 'LongNameCampaignEnchantmentForReadableOption '.repeat(3).trim();

async function geometry(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      height: rect.height,
    };
  });
}

test('nested inventory names and expanded item controls stay in view at supported widths', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `inventory-responsive-${runId}@example.com`;
  const campaignName = `Inventory responsive ${runId}`;
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL ?? '',
    connectionTimeoutMillis: 5_000,
  });
  let campaignId: string | undefined;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Inventory Layout QA');
    await page.getByLabel(/^password\b/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    async function create<T>(path: string, data: object): Promise<T> {
      const response = await page.request.post(`/api/v1${path}`, {
        data,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
      return response.json() as Promise<T>;
    }

    const campaign = await create<{ id: string }>('/campaigns', { name: campaignName });
    campaignId = campaign.id;
    const character = await create<{ id: string }>('/characters', {
      name: 'Responsive inventory character',
      campaignId: campaign.id,
    });
    const characterPath = `/characters/${character.id}`;
    const pack = await create<{ item: { id: string } }>(`${characterPath}/inventory`, {
      name: PACK_NAME,
      worn: true,
      isContainer: true,
      weightLbs: 1,
      cost: 10,
    });
    const pouch = await create<{ item: { id: string } }>(`${characterPath}/inventory`, {
      name: POUCH_NAME,
      parentId: pack.item.id,
      isContainer: true,
      weightLbs: 0.5,
      cost: 5,
    });
    const caseItem = await create<{ item: { id: string } }>(`${characterPath}/inventory`, {
      name: CASE_NAME,
      parentId: pouch.item.id,
      isContainer: true,
      weightLbs: 0.2,
      cost: 2,
    });
    const item = await create<{ item: { id: string } }>(`${characterPath}/inventory`, {
      name: ITEM_NAME,
      parentId: caseItem.item.id,
      weightLbs: 0.1,
      cost: 1,
      notes: 'A nested item with a visible details editor.',
    });

    await page.goto(characterPath);
    await selectCharacterSection(page, 'Inventory');
    const inventory = page.getByRole('table', { name: 'Carried inventory', exact: true });
    await expect(page.getByText('Worn', { exact: true })).toHaveCount(0);
    const location = page.getByLabel('Location');
    await expect(location).toHaveValue('');
    await expect(location.locator('option', { hasText: 'On the player' })).toHaveAttribute(
      'value',
      '',
    );
    await expect(location.locator('option', { hasText: 'Stashed' })).toHaveAttribute(
      'value',
      'stashed',
    );
    const rows = [pack, pouch, caseItem, item].map(({ item: row }) =>
      page.locator(`#inventory-${row.id}`),
    );
    for (const index of [0, 1, 2]) {
      await rows[index].getByRole('button', { name: 'Expand contents' }).click();
    }
    const titles = rows.map((row) => row.locator('.inventory-item-title'));
    const containerSettings = [PACK_NAME, POUCH_NAME, CASE_NAME].map((name, index) =>
      rows[index].getByRole('button', { name: `Container settings for ${name}`, exact: true }),
    );
    for (let index = 0; index < titles.length; index += 1) {
      await expect(titles[index]).toHaveText([PACK_NAME, POUCH_NAME, CASE_NAME, ITEM_NAME][index]);
    }
    for (const settingsButton of containerSettings) await expect(settingsButton).toBeVisible();
    await rows[3].getByRole('button', { name: `Edit ${ITEM_NAME}` }).click();
    const editor = page.getByRole('region', { name: `${ITEM_NAME}: Item details`, exact: true });
    const nameInput = editor.getByLabel('Name', { exact: true });
    const doneButton = editor.getByRole('button', { name: 'Done', exact: true });
    await expect(editor).toBeVisible();
    await expect(nameInput).toHaveValue(ITEM_NAME);
    await expect(doneButton).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await inventory.scrollIntoViewIfNeeded();
        await expect(editor).toBeVisible();
        await expect(nameInput).toBeVisible();
        await expect(doneButton).toBeVisible();
        const visibleRows = [rows[0], rows[1], rows[2], rows[3], editor, nameInput, doneButton];
        for (let index = 0; index < visibleRows.length; index += 1) {
          const box = await geometry(visibleRows[index]);
          expect(
            box.x,
            `content ${index} begins inside viewport at ${viewport.width}`,
          ).toBeGreaterThanOrEqual(-1);
          expect(
            box.right,
            `content ${index} ends inside viewport at ${viewport.width}`,
          ).toBeLessThanOrEqual(viewport.width + 1);
          if (index >= 4) expect(box.width).toBeGreaterThan(0);
        }
        for (const title of titles) {
          const metrics = await geometry(title);
          expect(metrics.scrollWidth, `item name wraps at ${viewport.width}`).toBeLessThanOrEqual(
            metrics.clientWidth + 1,
          );
        }
        for (const settingsButton of containerSettings) {
          const chipBox = await geometry(settingsButton);
          expect(chipBox.x).toBeGreaterThanOrEqual(-1);
          expect(chipBox.right).toBeLessThanOrEqual(viewport.width + 1);
          expect(
            chipBox.height,
            `container label stays legible at ${viewport.width}`,
          ).toBeLessThanOrEqual(48);
          await expect(settingsButton).toContainText('Container');
        }
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(viewport.width);
        if ([320, 568, 640, 768, 1024, 1440].includes(viewport.width)) {
          await attachReviewScreenshot(
            page,
            testInfo,
            `inventory-nested-${viewport.width}x${viewport.height}`,
            { fullPage: true, animations: 'disabled' },
          );
        }
      });
    }

    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const stashedName = `Stashed item ${runId}`;
    await page.getByLabel('Item name').fill(stashedName);
    await location.selectOption('stashed');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const stashedInventory = page.getByRole('table', { name: 'Stashed inventory', exact: true });
    await expect(stashedInventory).toContainText(stashedName, { timeout: 15_000 });
    await expect(inventory).not.toContainText(stashedName);

    const createdName = `Carried and equipped ${runId}`;
    const addForm = location.locator('xpath=ancestor::form');
    await addForm.getByLabel('Item name').fill(createdName);
    await expect(location).toHaveValue('');
    await addForm.getByRole('button', { name: 'More options' }).click();
    const equipped = addForm.getByLabel('Equipped', { exact: true });
    await equipped.check();
    await addForm.getByRole('button', { name: 'Add', exact: true }).click();
    const createdRow = inventory.getByRole('row').filter({ hasText: createdName });
    await expect(createdRow).toBeVisible({ timeout: 15_000 });
    await expect(inventory).toContainText(createdName);
    await expect(stashedInventory).not.toContainText(createdName);
    await expect(page.getByText('Worn', { exact: true })).toHaveCount(0);
    await createdRow.locator('.inventory-item-title').click();
    await expect(page.getByText('1 selected')).toBeVisible();

    const moveDropdown = page.getByRole('button', { name: 'Move to ▾' }).locator('xpath=..');
    const moveMenu = moveDropdown.locator('ul.dropdown-content');
    for (const viewport of VIEWPORTS) {
      await test.step(`Move menu at ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await moveDropdown.getByRole('button', { name: 'Move to ▾' }).click();
        await expect(moveMenu).toBeVisible();
        await moveMenu.evaluate((element) => {
          element.scrollTop = 0;
        });
        await expect(moveMenu.getByRole('button', { name: 'On the player' })).toBeVisible();
        const longContainerOption = moveMenu.getByRole('button', {
          name: PACK_NAME,
          exact: true,
        });
        await longContainerOption.scrollIntoViewIfNeeded();
        await expect(longContainerOption).toBeVisible();
        const box = await geometry(moveMenu);
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.height).toBeGreaterThan(0);
        const optionBox = await geometry(longContainerOption);
        expect(optionBox.x).toBeGreaterThanOrEqual(-1);
        expect(optionBox.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(optionBox.scrollWidth).toBeLessThanOrEqual(optionBox.clientWidth + 1);
        const vertical = await moveMenu.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        });
        const banner = await page.getByRole('banner').boundingBox();
        expect(banner).not.toBeNull();
        expect(vertical.top).toBeGreaterThanOrEqual((banner?.y ?? 0) + (banner?.height ?? 0) - 1);
        expect(vertical.bottom).toBeLessThanOrEqual(viewport.height + 1);
        if ([320, 568, 639, 640, 641, 768, 1440].includes(viewport.width)) {
          await attachReviewScreenshot(
            page,
            testInfo,
            `inventory-move-menu-${viewport.width}x${viewport.height}`,
            { fullPage: true, animations: 'disabled' },
          );
        }
        await page.mouse.click(2, viewport.height / 2);
        await expect(moveMenu).not.toBeVisible();
      });
    }

    const enchantment = await create<{ id: string; revision: number }>(
      `/campaigns/${campaignId}/library/enchantments`,
      {
        name: ENCHANTMENT_NAME,
        source: 'M66',
        tags: ['weapon'],
        applicability: 'weapon',
        effects: [{ target: 'weapon_attack', value: 1 }],
        levels: [],
        stackingPolicy: { kind: 'stack' },
      },
    );
    const multiCategoryItem = await create<{ item: { id: string } }>(
      `/characters/${character.id}/inventory`,
      {
        name: LANGUAGE_ITEM,
        worn: true,
        equipped: true,
        isContainer: true,
        hideawayCapacityLbs: 2,
        weightReductionPercent: 5,
        isArmor: true,
        armor: { dr: 2, locations: ['torso'] },
        weaponData: {
          damage: 'sw cut',
          modes: [
            { key: 'primary-stable-id', name: 'Swing', sourceRow: 'B404', damage: 'sw cut' },
            {
              key: 'alternate-stable-id',
              name: 'Thrust',
              sourceRow: 'B405',
              damage: 'thr imp',
            },
          ],
        },
        powerstoneData: { currentEnergy: 3, maxEnergy: 10 },
        magicItemData: {
          spellName: 'Light',
          spellSkillLevel: 12,
          mode: 'continuous',
        },
        enchantments: [
          {
            spellName: ENCHANTMENT_NAME,
            level: 2,
            definitionId: enchantment.id,
            definitionRevision: enchantment.revision,
            definitionSource: 'M66',
            mechanics: {
              applicability: 'weapon',
              effects: [{ target: 'weapon_attack', value: 1 }],
              levels: [],
              stackingPolicy: { kind: 'stack' },
            },
          },
        ],
      },
    );
    await page.goto(`/characters/${character.id}`);
    await selectCharacterSection(page, 'Inventory');
    const multiCategoryRow = page.locator(`#inventory-${multiCategoryItem.item.id}`);
    await expect(multiCategoryRow).toBeVisible();

    const armorIcon = multiCategoryRow.getByRole('button', {
      name: `Armor settings for ${LANGUAGE_ITEM}`,
    });
    const equippedIcon = multiCategoryRow.getByRole('button', {
      name: `Equipped: ${LANGUAGE_ITEM}`,
    });
    await expect(armorIcon.locator('svg')).toBeVisible();
    await expect(equippedIcon.locator('svg')).toBeVisible();
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 375, height: 812 },
      { width: 639, height: 800 },
      { width: 640, height: 800 },
      { width: 641, height: 800 },
    ]) {
      await test.step(`inventory icon tooltips at ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await armorIcon.scrollIntoViewIfNeeded();
        await armorIcon.hover();
        let tooltip = page.getByRole('tooltip');
        await expect(tooltip).toContainText('Armor');
        let tooltipBox = await geometry(tooltip);
        const banner = await page.getByRole('banner').boundingBox();
        expect(banner).not.toBeNull();
        expect(tooltipBox.x).toBeGreaterThanOrEqual(-1);
        expect(tooltipBox.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(tooltipBox.y).toBeGreaterThanOrEqual((banner?.y ?? 0) + (banner?.height ?? 0) - 1);
        expect(tooltipBox.bottom).toBeLessThanOrEqual(viewport.height + 1);
        await page.mouse.move(2, viewport.height / 2);

        await equippedIcon.scrollIntoViewIfNeeded();
        await equippedIcon.hover();
        tooltip = page.getByRole('tooltip');
        await expect(tooltip).toContainText('Equipped');
        tooltipBox = await geometry(tooltip);
        expect(tooltipBox.x).toBeGreaterThanOrEqual(-1);
        expect(tooltipBox.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(tooltipBox.y).toBeGreaterThanOrEqual((banner?.y ?? 0) + (banner?.height ?? 0) - 1);
        expect(tooltipBox.bottom).toBeLessThanOrEqual(viewport.height + 1);
        await page.mouse.move(2, viewport.height / 2);
      });
    }

    await multiCategoryRow
      .getByRole('button', { name: `Armor settings for ${LANGUAGE_ITEM}` })
      .click();
    const armor = page.getByRole('region', { name: `${LANGUAGE_ITEM}: Armor` });
    await expect(armor.getByRole('textbox', { name: 'DR' })).toHaveValue('2');
    await multiCategoryRow
      .getByRole('button', { name: `Armor settings for ${LANGUAGE_ITEM}` })
      .click();

    await multiCategoryRow
      .getByRole('button', { name: `Weapon settings for ${LANGUAGE_ITEM}` })
      .click();
    const weapon = page.getByRole('region', { name: `${LANGUAGE_ITEM}: Weapon` });
    await expect(weapon.getByRole('textbox', { name: 'Attack name' }).first()).toHaveValue('Swing');
    await expect(weapon.getByRole('textbox', { name: 'Source reference' }).first()).toHaveValue(
      'B404',
    );
    await expect(weapon.getByRole('group', { name: 'Alternate attack 1' })).toBeVisible();
    await expect(weapon.getByLabel(/(mode|attack).*key/i)).toHaveCount(0);
    const editorScroller = weapon.locator(
      'xpath=ancestor::div[contains(@class, "overflow-x-auto")][1]',
    );
    const primaryName = weapon.getByRole('textbox', { name: 'Attack name' }).first();
    const primarySource = weapon.getByRole('textbox', { name: 'Source reference' }).first();
    const alternateAttack = weapon.getByRole('group', { name: 'Alternate attack 1' });
    for (const viewport of [
      { width: 320, height: 800 },
      { width: 639, height: 800 },
      { width: 640, height: 800 },
      { width: 641, height: 800 },
      { width: 1280, height: 800 },
    ]) {
      await test.step(`weapon editor at ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await weapon.scrollIntoViewIfNeeded();
        const editorBox = await geometry(weapon);
        const scrollerBox = await geometry(editorScroller);
        expect(editorBox.x).toBeGreaterThanOrEqual(scrollerBox.x);
        expect(editorBox.right).toBeLessThanOrEqual(scrollerBox.right);
        for (const control of [primaryName, primarySource, alternateAttack]) {
          await expect(control).toBeVisible();
          const controlBox = await geometry(control);
          expect(controlBox.x).toBeGreaterThanOrEqual(editorBox.x);
          expect(controlBox.right).toBeLessThanOrEqual(editorBox.right);
        }
        if ([320, 640, 1280].includes(viewport.width)) {
          await attachReviewScreenshot(
            weapon,
            testInfo,
            `inventory-weapon-editor-${viewport.width}`,
            {
              path: testInfo.outputPath(`inventory-weapon-editor-${viewport.width}.png`),
              animations: 'disabled',
            },
          );
        }
      });
    }
    await multiCategoryRow
      .getByRole('button', { name: `Weapon settings for ${LANGUAGE_ITEM}` })
      .click();

    await multiCategoryRow
      .getByRole('button', { name: `Container settings for ${LANGUAGE_ITEM}` })
      .click();
    await expect(
      page
        .getByRole('region', { name: `${LANGUAGE_ITEM}: Container` })
        .getByLabel('Weight reduction (%)'),
    ).toHaveValue('5');
    await multiCategoryRow
      .getByRole('button', { name: `Container settings for ${LANGUAGE_ITEM}` })
      .click();

    await multiCategoryRow
      .getByRole('button', { name: `Powerstone settings for ${LANGUAGE_ITEM}` })
      .click();
    await expect(
      page
        .getByRole('region', { name: `${LANGUAGE_ITEM}: Powerstone` })
        .getByLabel('Current energy'),
    ).toHaveValue('3');
    await multiCategoryRow
      .getByRole('button', { name: `Powerstone settings for ${LANGUAGE_ITEM}` })
      .click();

    await multiCategoryRow
      .getByRole('button', { name: `Magic item settings for ${LANGUAGE_ITEM}` })
      .click();
    const magicItem = page.getByRole('region', { name: `${LANGUAGE_ITEM}: Magic item` });
    await expect(magicItem.getByLabel('Activation').locator('option')).toHaveText([
      'Uses charges',
      'Uses energy',
      'Always on',
    ]);
    await expect(magicItem.getByRole('combobox', { name: 'Activation' })).toHaveValue('continuous');
    await multiCategoryRow
      .getByRole('button', { name: `Magic item settings for ${LANGUAGE_ITEM}` })
      .click();

    await multiCategoryRow
      .getByRole('button', { name: `Enchantments settings for ${LANGUAGE_ITEM}` })
      .click();
    const enchantments = page.getByRole('region', { name: `${LANGUAGE_ITEM}: Enchantments` });
    await expect(enchantments.getByLabel('Enchantment level')).toHaveValue('2');
    await expect(enchantments.getByText('Source: M66')).toBeVisible();
    await expect(enchantments).not.toContainText(/revision|snapshot|follows library|retained/i);
    await enchantments.getByText('Source: M66').scrollIntoViewIfNeeded();
    const newEnchantment = enchantments.getByLabel('New enchantment name');
    await newEnchantment.fill(ENCHANTMENT_NAME.slice(0, 28));
    const optionList = page.getByRole('listbox');
    await expect(optionList).toBeVisible({ timeout: 20_000 });
    for (const viewport of [
      { width: 320, height: 800 },
      { width: 639, height: 800 },
      { width: 640, height: 800 },
      { width: 641, height: 800 },
      { width: 1280, height: 800 },
    ]) {
      await test.step(`enchantment option at ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        const box = await geometry(optionList);
        expect(box.x, `option starts onscreen at ${viewport.width}`).toBeGreaterThanOrEqual(0);
        expect(box.right, `option ends onscreen at ${viewport.width}`).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(box.y, `option starts onscreen at ${viewport.height}`).toBeGreaterThanOrEqual(0);
        expect(box.bottom, `option ends onscreen at ${viewport.height}`).toBeLessThanOrEqual(
          viewport.height,
        );
        expect(box.width).toBeGreaterThan(0);
        await expect(optionList).toContainText('Weapons');
        if ([320, 640, 1280].includes(viewport.width)) {
          await attachReviewScreenshot(
            page,
            testInfo,
            `inventory-enchantment-options-${viewport.width}`,
            {
              path: testInfo.outputPath(`inventory-enchantment-options-${viewport.width}.png`),
              fullPage: false,
              animations: 'disabled',
            },
          );
        }
      });
    }
  } finally {
    try {
      if (campaignId) {
        const token = await page
          .evaluate(
            () =>
              JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
          )
          .catch(() => undefined);
        if (token) {
          await page.request.delete(`/api/v1/campaigns/${campaignId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      await pool.query(
        'delete from campaigns where name=$1 and owner_id=(select id from users where email=$2)',
        [campaignName, email],
      );
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
