import { expect, test as unauthenticatedTest } from '@playwright/test';
import { test } from './authenticated-fixture';
import { expectCharacterNavigationReady, selectCharacterSection } from './character-navigation';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

unauthenticatedTest(
  'header tooltips and alerts stay within the viewport from mobile through desktop',
  async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/register');
    const displayName =
      'Responsive Header QA With A Deliberately Long Display Name For Narrow Menus';
    const email = `responsive-header-${suffix()}-${'long-account-'.repeat(3)}@example.com`;
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill(displayName);
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

    const expectInsideViewport = async (locator: import('@playwright/test').Locator) => {
      await expect(locator).toBeVisible();
      await expect
        .poll(async () => {
          const box = await locator.boundingBox();
          const currentViewport = page.viewportSize();
          return box && currentViewport
            ? box.x >= 8 && box.x + box.width <= currentViewport.width - 8
            : false;
        })
        .toBe(true);
    };

    // Reuse one account and page through phone landscape, the 640px header-label
    // boundary, tablet, and desktop widths with long account text in the header.
    const viewportCases = [
      { width: 320, height: 568 },
      { width: 667, height: 375 },
      { width: 768, height: 1024 },
      { width: 844, height: 390 },
      { width: 639, height: 700 },
      { width: 640, height: 700 },
      { width: 641, height: 700 },
      { width: 1023, height: 768 },
      { width: 1024, height: 768 },
      { width: 1025, height: 768 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ];
    let darkTheme = false;

    for (const viewport of viewportCases) {
      await page.setViewportSize(viewport);
      if (viewport.width >= 1024 && !darkTheme) {
        await page.getByRole('button', { name: 'Switch to Dark mode' }).click();
        darkTheme = true;
      }

      const sync = page.getByRole('button', { name: 'All changes saved' });
      await sync.hover();
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toContainText('All changes synced');
      await expectInsideViewport(tooltip);

      const notifications = page.getByLabel('Notifications', { exact: true });
      await notifications.click();
      const alerts = page
        .locator('details')
        .filter({ has: notifications })
        .locator('.dropdown-content');
      await expect(alerts).toContainText("You're all caught up.");
      await expectInsideViewport(alerts);
      await notifications.click();

      const userMenu = page.locator('details.dropdown > summary[aria-label="Open user menu"]');
      await userMenu.click();
      const accountMenu = page.locator(
        'details.dropdown[open]:has(> summary[aria-label="Open user menu"]) ul.dropdown-content',
      );
      await expect(accountMenu).toBeVisible();
      await expect(accountMenu).toContainText(email);
      await expect
        .poll(async () => {
          const box = await accountMenu.boundingBox();
          const size = page.viewportSize();
          return box && size
            ? box.x >= 8 &&
                box.x + box.width <= size.width - 8 &&
                box.y >= 8 &&
                box.y + box.height <= size.height - 8
            : false;
        })
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      if ([667, 768, 844].includes(viewport.width)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`long-account-menu-${viewport.width}.png`),
          animations: 'disabled',
        });
      }
      await userMenu.click();

      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    }

    const maxLengthDisplayName = 'W'.repeat(80);
    await page.route('**/api/v1/auth/me', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.displayName = maxLengthDisplayName;
      await route.fulfill({ response, body: JSON.stringify(body) });
    });
    await page.goto('/');
    const welcomeName = page.getByRole('heading', { name: maxLengthDisplayName, exact: true });
    await expect(welcomeName).toBeVisible();

    const maxNameViewportCases = [
      { width: 320, height: 568 },
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 639, height: 768 },
      { width: 640, height: 768 },
      { width: 641, height: 768 },
      { width: 667, height: 375 },
      { width: 844, height: 390 },
      { width: 1023, height: 768 },
      { width: 1024, height: 768 },
      { width: 1025, height: 768 },
      { width: 1280, height: 800 },
      { width: 1920, height: 1080 },
    ];
    for (const viewport of maxNameViewportCases) {
      await page.setViewportSize(viewport);
      await expect(welcomeName).toBeVisible();
      const headingGeometry = await welcomeName.evaluate((heading) => {
        const style = getComputedStyle(heading);
        return {
          clientWidth: heading.clientWidth,
          scrollWidth: heading.scrollWidth,
          height: heading.clientHeight,
          lineHeight: Number.parseFloat(style.lineHeight),
        };
      });
      expect(headingGeometry.scrollWidth).toBeLessThanOrEqual(headingGeometry.clientWidth);
      expect(headingGeometry.height).toBeGreaterThan(headingGeometry.lineHeight);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);

      const headerControls = [
        page.locator('header.app-header button').filter({ visible: true }).first(),
        page
          .locator('header.app-header summary[aria-label^="Notifications"]')
          .filter({ visible: true })
          .first(),
        page
          .locator('header.app-header button[aria-label^="Switch to "]')
          .filter({ visible: true }),
        page.locator('header.app-header summary[aria-label="Open user menu"]'),
      ];
      for (const control of headerControls) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
        expect(
          await control.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
            return hit === element || element.contains(hit);
          }),
        ).toBe(true);
        await control.click({ trial: true });
      }

      const userMenu = page.locator('header.app-header summary[aria-label="Open user menu"]');
      await userMenu.click();
      const accountMenu = page.locator(
        'details.dropdown[open]:has(> summary[aria-label="Open user menu"]) ul.dropdown-content',
      );
      await expect(accountMenu).toContainText(email);
      await expect
        .poll(async () => {
          const box = await accountMenu.boundingBox();
          return box
            ? box.x >= 8 &&
                box.y >= 8 &&
                box.x + box.width <= viewport.width - 8 &&
                box.y + box.height <= viewport.height - 8
            : false;
        })
        .toBe(true);
      for (const label of ['About', 'Settings']) {
        const link = accountMenu.getByRole('link', { name: label, exact: true });
        await link.click({ trial: true });
      }
      await accountMenu.getByRole('button', { name: 'Logout', exact: true }).click({ trial: true });
      if ([667, 1025, 1920].includes(viewport.width)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`max-name-user-menu-${viewport.width}.png`),
          animations: 'disabled',
        });
      }
      await userMenu.click();
    }
  },
);

test('long campaign cards do not create page-level horizontal overflow at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });

  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page
    .getByLabel(/campaign name/i)
    .fill('A campaign title long enough to stress narrow navigation');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(
    page.getByRole('link', { name: 'A campaign title long enough to stress narrow navigation' }),
  ).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
});

test('long campaign-library trait names do not create page-level horizontal overflow at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const traitName =
    'PneumonoultramicroscopicsilicovolcanoconiosisUnbreakableResponsiveLibraryTrait';

  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill('Responsive library trait');
  await page.getByRole('button', { name: /^create$/i }).click();
  await page.getByRole('link', { name: 'Responsive library trait' }).click();
  await page.getByRole('link', { name: /^library$/i }).click();
  await page.getByRole('button', { name: /add trait/i }).click();
  await page.getByLabel(/name \*/i).fill(traitName);
  await page.getByRole('button', { name: /^add trait$/i }).click();
  await expect(page.getByText(traitName, { exact: true })).toHaveCount(1);

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
});

test('skill, technique, and language rows reflow into readable mobile cards at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow Skill Sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 10_000 });
  await expectCharacterNavigationReady(page);
  await selectCharacterSection(page, 'Skills');
  const skillName = 'Extremely Long Skill Name For Horizontal Testing';
  await page.getByRole('button', { name: '+ Add skill' }).click();
  const skillForm = page.getByLabel(/^skill$/i).locator('xpath=ancestor::form');
  await page.getByLabel(/^skill$/i).fill(skillName);
  await skillForm.getByRole('button', { name: /^add$/i }).click();
  await page.getByRole('button', { name: `Edit ${skillName}` }).click();
  const skillNameInput = page.getByLabel(`${skillName} name`);
  await expect(skillNameInput).toBeVisible();

  const techniqueName = 'Retain Weapon After a Very Long Technique Name';
  await page.getByRole('button', { name: '+ Add technique' }).click();
  await page.getByLabel(/^technique$/i).fill(techniqueName);
  await page.getByLabel('Defaults from', { exact: true }).fill(skillName);
  await page.getByRole('option', { name: skillName }).click();
  await page.getByRole('button', { name: 'Add technique', exact: true }).click();
  await page.getByRole('button', { name: `Edit ${techniqueName}` }).click();
  const techniqueNameInput = page.getByLabel(`${techniqueName} name`);
  await expect(techniqueNameInput).toBeVisible();

  const languageName = 'Pneumonoultramicroscopicsilicovolcanoconiosis Language';
  await page.getByRole('button', { name: '+ Add language' }).click();
  await page.getByLabel(/^language$/i).fill(languageName);
  await page.getByRole('button', { name: 'Add language', exact: true }).click();
  await page.getByRole('button', { name: `Edit ${languageName}` }).click();
  const languageNameInput = page.getByLabel(`${languageName} name`);
  await expect(languageNameInput).toBeVisible();

  for (const input of [skillNameInput, techniqueNameInput, languageNameInput]) {
    await expect
      .poll(() => input.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(180);
  }

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
});

test('spell list and reference dialog stay contained across mobile, tablet, and desktop breakpoints', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 700 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Spell Reference Layout');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expectCharacterNavigationReady(page);
  await selectCharacterSection(page, 'Traits');
  await page.getByRole('button', { name: '+ Add trait' }).click();
  await page.getByLabel('Trait name').fill('Magery');
  await page.getByRole('button', { name: /^add$/i }).click();

  await selectCharacterSection(page, 'Magic');
  await page.getByRole('button', { name: '+ Add spell' }).click();
  const spellName =
    'Aegis of the Seven Wandering Stars That Protects Travelers Across the Azure Meridian';
  const addForm = page.getByLabel(/^spell$/i).locator('xpath=ancestor::form');
  await page.getByLabel(/^spell$/i).fill(spellName);
  await page.getByLabel('College').fill('Protection & Warning');
  await addForm.getByRole('button', { name: /^add$/i }).click();
  const spellRow = page.getByRole('rowgroup', { name: spellName });
  await expect(spellRow).toBeVisible();

  const spellSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Known spells' }) });
  await expect(spellSection.locator('.overflow-x-auto')).toHaveCount(0);

  for (const width of [320, 390, 639, 640, 641, 1023, 1024, 1025, 1279, 1280, 1281]) {
    const height = width === 320 ? 568 : 700;
    await page.setViewportSize({ width, height });
    const table = page.getByRole('table', { name: 'Spells' });
    const tableBox = await table.boundingBox();
    if (!tableBox) throw new Error(`Spell table has no bounding box at ${width}px`);
    expect(tableBox.x).toBeGreaterThanOrEqual(0);
    expect(tableBox.x + tableBox.width).toBeLessThanOrEqual(width + 1);
    const summaryRow = spellRow.getByRole('row').first();
    const firstCell = summaryRow.locator('td').first();
    const levelCell = summaryRow.locator('td').nth(2);
    const firstCellBox = await firstCell.boundingBox();
    const levelCellBox = await levelCell.boundingBox();
    if (!firstCellBox || !levelCellBox) throw new Error(`Spell columns are missing at ${width}px`);
    if (width < 640) {
      expect(firstCellBox.width).toBeGreaterThanOrEqual(tableBox.width * 0.6);
      expect(
        Math.abs(levelCellBox.x + levelCellBox.width - (tableBox.x + tableBox.width)),
      ).toBeLessThanOrEqual(5);
    }
    const lastHeaderRight = await table.locator('thead th').evaluateAll((headers) => {
      const visible = headers.filter((header) => getComputedStyle(header).display !== 'none');
      const last = visible.at(-1);
      return last?.getBoundingClientRect().right ?? null;
    });
    if (lastHeaderRight === null)
      throw new Error(`Visible spell headers are missing at ${width}px`);
    expect(Math.abs(lastHeaderRight - (tableBox.x + tableBox.width))).toBeLessThanOrEqual(5);
    await expect(page.getByRole('button', { name: `Read ${spellName}` })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);

    await page.getByRole('button', { name: `Read ${spellName}` }).click();
    const dialog = page.getByRole('dialog', { name: `Spell reference: ${spellName}` });
    await expect(dialog).toBeVisible();
    const modalBox = dialog.locator('.modal-box');
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running')
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    const dialogBox = await modalBox.boundingBox();
    if (!dialogBox) throw new Error(`Spell reference dialog has no box at ${width}px`);
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width + 1);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(height + 1);
    const close = dialog.getByRole('button', { name: 'Close spell reference' });
    const closeBox = await close.boundingBox();
    if (!closeBox) throw new Error(`Spell reference close control has no box at ${width}px`);
    expect(closeBox.x).toBeGreaterThanOrEqual(0);
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(width + 1);
    expect(closeBox.y).toBeGreaterThanOrEqual(0);
    expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(height + 1);
    await close.click();
    await expect(dialog).not.toBeVisible();

    if (width === 320) {
      await spellRow.getByRole('button', { name: `Edit ${spellName}` }).click();
      await expect(page.getByRole('heading', { name: `Edit ${spellName}` })).toBeVisible();
      const nameInput = page.getByLabel(`${spellName} name`);
      const nameBox = await nameInput.boundingBox();
      if (!nameBox) throw new Error('Spell editor name input has no bounds at 320px');
      expect(nameBox.width).toBeGreaterThan(180);
      expect(nameBox.x).toBeGreaterThanOrEqual(0);
      expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(width + 1);
      const deleteButton = page.getByRole('button', { name: `Delete spell ${spellName}` });
      const deleteBox = await deleteButton.boundingBox();
      if (!deleteBox) throw new Error('Spell delete action has no bounds at 320px');
      expect(deleteBox.x).toBeGreaterThanOrEqual(0);
      expect(deleteBox.x + deleteBox.width).toBeLessThanOrEqual(width + 1);
      await spellRow.getByRole('button', { name: `Done editing ${spellName}` }).click();
    }
  }

  // A maintainable spell has one more action than a custom spell. At the
  // 640px breakpoint that used to squeeze the editable name down to only a
  // few characters, even though the page itself did not overflow.
  const characterUrl = page.url();
  await page.setViewportSize({ width: 640, height: 800 });
  const maintainableSpellName = 'Maintainable Spell With a Readable Name at 640px';
  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill('Responsive spell library');
  await page.getByRole('button', { name: /^create$/i }).click();
  await page.getByRole('link', { name: 'Responsive spell library' }).click();
  await page.getByRole('link', { name: /^library$/i }).click();
  await page.getByRole('button', { name: /^spells 0$/i }).click();
  await page.getByRole('button', { name: /add spell/i }).click();
  await page.getByLabel(/name \*/i).fill(maintainableSpellName);
  await page.getByLabel('Upkeep').fill('1');
  await page.getByRole('button', { name: /^add spell$/i }).click();
  await expect(page.getByText(maintainableSpellName, { exact: true })).toBeVisible();

  await page.goto(characterUrl);
  await selectCharacterSection(page, 'Overview');
  await page
    .getByLabel('campaign', { exact: true })
    .selectOption({ label: 'Responsive spell library' });
  await selectCharacterSection(page, 'Magic');
  await page.getByRole('button', { name: '+ Add spell' }).click();
  await page.getByLabel(/^spell$/i).fill(maintainableSpellName);
  await page.getByRole('option', { name: new RegExp(maintainableSpellName) }).click();
  const maintainableForm = page.getByLabel(/^spell$/i).locator('xpath=ancestor::form');
  await maintainableForm.getByRole('button', { name: /^add$/i }).click();

  const maintainableRow = page.getByRole('rowgroup', { name: maintainableSpellName });
  await expect(maintainableRow).toBeVisible();
  await maintainableRow.getByRole('button', { name: `Edit ${maintainableSpellName}` }).click();
  const maintainableNameInput = page.getByLabel(`${maintainableSpellName} name`);
  await expect(maintainableNameInput).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Maintain ${maintainableSpellName}` }),
  ).toBeVisible();
  await expect
    .poll(() => maintainableNameInput.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(180);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(640);
});

test('campaign settings dialog keeps its close control reachable on a short mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });

  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill('Responsive campaign settings');
  await page.getByRole('button', { name: /^create$/i }).click();
  await page.getByLabel('Settings for Responsive campaign settings').click();

  const close = page
    .getByRole('dialog', { name: 'Responsive campaign settings' })
    .getByLabel('Close');
  await expect(close).toBeVisible();
  await expect
    .poll(async () => {
      const box = await close.boundingBox();
      return box ? box.y >= 0 && box.y + box.height <= 568 : false;
    })
    .toBe(true);
});

test('inline inventory categories toggle and retain populated advanced fields on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow Item Sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expectCharacterNavigationReady(page);
  await selectCharacterSection(page, 'Inventory');
  await page.getByLabel('Item name').fill('Reachable item');
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByText('Reachable item', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Reachable item' }).click();
  await page.getByRole('button', { name: 'Add category to Reachable item' }).click();
  await page.getByRole('button', { name: '+ Armor', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Reachable item: Armor' });
  const chip = page.getByRole('button', { name: 'Armor settings for Reachable item' });
  await expect(editor).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await editor.getByRole('button', { name: 'More options' }).click();
  await editor.getByLabel('Crushing DR', { exact: true }).fill('0');
  await editor.getByRole('button', { name: 'Fewer options' }).click();
  await expect(editor.getByLabel('Crushing DR', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('Cutting DR', { exact: true })).toBeHidden();
  await chip.click();
  await expect(editor).toBeHidden();
  await chip.click();
  await expect(editor.getByLabel('Crushing DR', { exact: true })).toHaveValue('0');
  await editor.getByLabel('Crushing DR', { exact: true }).fill('');
  await editor.getByRole('heading', { name: 'Armor', exact: true }).click();
  await expect(editor.getByLabel('Crushing DR', { exact: true })).toBeHidden();
  await expect
    .poll(() => editor.evaluate((element) => element.getBoundingClientRect().right <= innerWidth))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test('inventory filters keep matching item ancestry without showing unrelated contents', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Filtered Inventory');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expectCharacterNavigationReady(page);
  await selectCharacterSection(page, 'Inventory');

  const addForm = page.getByLabel('Item name').locator('xpath=ancestor::form');
  await page.getByLabel('Item name').fill('Backpack');
  await addForm.getByRole('button', { name: 'More options' }).click();
  await addForm.getByRole('button', { name: '+ Container', exact: true }).click();
  await addForm.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByText('Backpack', { exact: true })).toBeVisible();

  await page.getByLabel('Item name').fill('Apple');
  await addForm.getByLabel('Parent container').selectOption({ label: 'in Backpack' });
  await addForm.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByText('Apple', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('1 contained item')).toBeVisible();

  await page.getByLabel('Item name').fill('Broadsword');
  await addForm.getByLabel('Parent container').selectOption({ label: 'in Backpack' });
  await addForm.getByRole('button', { name: 'More options' }).click();
  await addForm.getByRole('button', { name: '+ Weapon', exact: true }).click();
  await addForm.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByText('Broadsword', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('2 contained items')).toBeVisible();

  await page.getByRole('button', { name: 'Expand contents' }).click();
  await expect(page.getByText('Apple', { exact: true })).toBeVisible();
  await expect(page.getByText('Broadsword', { exact: true })).toBeVisible();

  await page.reload();
  await expectCharacterNavigationReady(page);
  await selectCharacterSection(page, 'Inventory');
  await expect(page.getByText('Apple', { exact: true })).toBeVisible();
  await expect(page.getByText('Broadsword', { exact: true })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Filter inventory' });
  await search.fill('sword');
  await expect(page.getByText('Backpack', { exact: true })).toBeVisible();
  await expect(page.getByText('Broadsword', { exact: true })).toBeVisible();
  await expect(page.getByText('Apple', { exact: true })).toHaveCount(0);
  await expect(page.getByText('1 of 3', { exact: true })).toBeVisible();

  await search.fill('');
  await page.getByLabel('Filter inventory by tag').selectOption('weapon');
  await expect(page.getByText('Backpack', { exact: true })).toBeVisible();
  await expect(page.getByText('Broadsword', { exact: true })).toBeVisible();
  await expect(page.getByText('Apple', { exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test('maintain-payment dialog keeps long resource labels and free-maintenance actions contained', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });

  const campaignName = 'Responsive maintenance library';
  const spellName = 'A Long Maintenance Spell for Responsive Dialog Testing';
  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill(campaignName);
  await page.getByRole('button', { name: /^create$/i }).click();
  await page.getByRole('link', { name: campaignName }).click();
  await page.getByRole('link', { name: /^library$/i }).click();
  await page.getByRole('button', { name: /^spells 0$/i }).click();
  await page.getByRole('button', { name: /add spell/i }).click();
  await page.getByLabel(/name \*/i).fill(spellName);
  const longCollege = 'Pneumonoultramicroscopicsilicovolcanoconiosis-responsive spell college';
  const longCastingTime = 'Pneumonoultramicroscopically40Second';
  await page.getByLabel('College').fill(longCollege);
  await page.getByLabel('Upkeep').fill('1');
  await page.getByLabel('Casting time').fill(longCastingTime);
  await page.getByLabel('Duration').fill(longCastingTime);
  await page.getByRole('button', { name: /^add spell$/i }).click();
  await expect(page.getByText(spellName, { exact: true })).toBeVisible();

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow Caster Sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expectCharacterNavigationReady(page);

  await selectCharacterSection(page, 'Overview');
  await page.getByLabel('campaign', { exact: true }).selectOption({ label: campaignName });
  await selectCharacterSection(page, 'Traits');
  await page.getByRole('button', { name: '+ Add trait' }).click();
  await page.getByLabel('Trait name').fill('Magery');
  await page.getByRole('button', { name: /^add$/i }).click();

  await selectCharacterSection(page, 'Inventory');
  const powerstoneName = 'The Ancient Granite Tower Powerstone of the Northern Highlands';
  await page.getByLabel('Item name').fill(powerstoneName);
  await page.getByRole('button', { name: /^add$/i }).click();
  await page.getByRole('button', { name: `Edit ${powerstoneName}` }).click();
  await page.getByRole('button', { name: `Add category to ${powerstoneName}` }).click();
  await page.getByRole('button', { name: '+ Powerstone', exact: true }).click();
  await page.getByLabel('Current energy').fill('1');
  await page.getByLabel('Maximum energy').fill('1');

  await selectCharacterSection(page, 'Magic');
  await page.getByRole('button', { name: '+ Add spell' }).click();
  await page.getByLabel(/^spell$/i).fill(spellName);
  await page.getByRole('option', { name: new RegExp(spellName) }).click();
  const spellForm = page.getByLabel(/^spell$/i).locator('xpath=ancestor::form');
  await spellForm.getByRole('button', { name: /^add$/i }).click();
  const spellRow = page.getByRole('rowgroup', { name: spellName });
  await expect(spellRow).toBeVisible();
  await spellRow.getByRole('button', { name: `Read ${spellName}` }).click();
  const referenceDialog = page.getByRole('dialog', { name: `Spell reference: ${spellName}` });
  const referenceBox = referenceDialog.locator('.modal-box');
  await expect(referenceBox).toContainText(longCollege);
  await expect(referenceBox).toContainText(longCastingTime);
  await referenceDialog.getByRole('button', { name: 'Close spell reference' }).click();

  for (const width of [320, 390, 639, 640, 641, 1023, 1024, 1025, 1279, 1280, 1281]) {
    await page.setViewportSize({ width, height: 568 });
    await spellRow.getByRole('button', { name: `Maintain ${spellName}` }).click();
    const dialog = page.getByRole('dialog', { name: `Maintain ${spellName}` });
    const modalBox = dialog.locator('.modal-box');
    await expect(modalBox).toBeVisible();
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running')
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    if (width === 320) {
      await captureReviewScreenshot(page, {
        path: '/tmp/gpc-spell-visual/payment-dialog-320x568-top.png',
      });
    }
    const bounds = await modalBox.boundingBox();
    if (!bounds) throw new Error(`Maintain dialog has no box at ${width}px`);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(569);
    await expect(modalBox).toContainText(longCollege);
    await expect(modalBox).toContainText(longCastingTime);
    for (const content of [longCollege, longCastingTime]) {
      const contentBox = await modalBox.getByText(content).first().boundingBox();
      if (!contentBox) throw new Error(`Dialog content has no box at ${width}px: ${content}`);
      expect(contentBox.x).toBeGreaterThanOrEqual(bounds.x);
      expect(contentBox.x + contentBox.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    }

    const stoneSpend = dialog.getByRole('spinbutton', {
      name: `${powerstoneName} (powerstone)`,
    });
    const allocationTable = dialog.getByRole('table', { name: 'Energy allocation' });
    const sourceCell = stoneSpend.locator('xpath=ancestor::tr').locator('td').first();
    await stoneSpend.scrollIntoViewIfNeeded();
    await expect(stoneSpend).toBeVisible();
    const stoneBounds = await stoneSpend.boundingBox();
    const sourceCellBox = await sourceCell.boundingBox();
    const allocationTableBox = await allocationTable.boundingBox();
    if (!stoneBounds) throw new Error(`Powerstone allocation has no box at ${width}px`);
    if (!sourceCellBox || !allocationTableBox)
      throw new Error(`Powerstone source cell has no box at ${width}px`);
    expect(stoneBounds.x).toBeGreaterThanOrEqual(0);
    expect(stoneBounds.x + stoneBounds.width).toBeLessThanOrEqual(width + 1);
    expect(sourceCell).toContainText(powerstoneName);
    if (width < 640) {
      expect(sourceCellBox.width).toBeGreaterThanOrEqual(allocationTableBox.width * 0.5);
    }

    await dialog.getByLabel('Energy to spend').fill('0');
    const freeMaintenance = dialog.getByRole('button', { name: 'Record free maintenance' });
    await freeMaintenance.scrollIntoViewIfNeeded();
    if (width === 320) {
      await captureReviewScreenshot(page, {
        path: '/tmp/gpc-spell-visual/payment-dialog-320x568.png',
      });
    }
    const actionBounds = await freeMaintenance.boundingBox();
    if (!actionBounds) throw new Error(`Free maintenance action has no box at ${width}px`);
    expect(actionBounds.x).toBeGreaterThanOrEqual(0);
    expect(actionBounds.x + actionBounds.width).toBeLessThanOrEqual(width + 1);
    expect(actionBounds.y).toBeGreaterThanOrEqual(0);
    expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(569);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
  }
});

test('long powerstone and magic-item rows stack their controls on a 320px viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow Powerstone Sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expectCharacterNavigationReady(page);
  await selectCharacterSection(page, 'Inventory');
  const powerstoneName = 'PneumonoultramicroscopicsilicovolcanoconiosisUnbreakablePowerstone';
  await page.getByLabel('Item name').fill(powerstoneName);
  await page.getByRole('button', { name: /^add$/i }).click();
  await page.getByRole('button', { name: `Edit ${powerstoneName}` }).click();
  await page.getByRole('button', { name: `Add category to ${powerstoneName}` }).click();
  await page.getByRole('button', { name: '+ Powerstone', exact: true }).click();

  const magicItemName = 'ThaumatologicallyOverengineeredUnbreakableResponsiveWand';
  await page.getByLabel('Item name').fill(magicItemName);
  await page.getByRole('button', { name: /^add$/i }).click();
  await page.getByRole('button', { name: `Edit ${magicItemName}` }).click();
  await page.getByRole('button', { name: `Add category to ${magicItemName}` }).click();
  await page.getByRole('button', { name: '+ Magic item', exact: true }).click();
  await page.getByLabel('Magic item spell name').fill('Light');
  await page.getByRole('button', { name: 'Add magic item', exact: true }).click();
  await selectCharacterSection(page, 'Magic');
  await expect(page.getByText('Stored energy')).toBeVisible();
  const powerstoneLabel = page.getByText(powerstoneName, { exact: true });
  const magicItemLabel = page.getByText(magicItemName, { exact: true });
  await expect(powerstoneLabel).toBeVisible();
  await expect(magicItemLabel).toBeVisible();
  for (const width of [320, 639, 640, 641]) {
    await page.setViewportSize({ width, height: 568 });
    for (const label of [powerstoneLabel, magicItemLabel]) {
      const table = label.locator('xpath=ancestor::table[1]');
      const labelCell = label.locator('xpath=ancestor::td[1]');
      await expect
        .poll(async () => {
          const [tableBox, cellBox] = await Promise.all([
            table.boundingBox(),
            labelCell.boundingBox(),
          ]);
          return tableBox && cellBox ? cellBox.width / tableBox.width : 0;
        })
        .toBeGreaterThanOrEqual(0.6);
    }
    if (width === 320 || width === 640) {
      await captureReviewScreenshot(page, {
        path: `/tmp/gpc-spell-visual/powerstone-items-${width}.png`,
      });
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  }
});

test('long recent-character and API-key names stay contained at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const name = 'Sir Responsiveness Longname the Unbreakably Extensive Tester';

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill(name);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 10_000 });
  await page.goto('/');
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);

  await page.goto('/settings');
  const apiKeyName = 'MobileApiKeyWithAnIntentionallyLongUnbrokenNameThatMustRemainContained';
  await page.getByLabel('Name', { exact: true }).fill(apiKeyName);
  await page.getByRole('button', { name: 'Mint key' }).click();
  await page.getByRole('button', { name: "I've saved it" }).click();
  const apiKeyLabel = page.getByText(apiKeyName, { exact: true });
  const revokeApiKey = page.getByRole('button', { name: `Revoke ${apiKeyName}` });
  await expect(apiKeyLabel).toBeVisible();
  await expect(revokeApiKey).toBeVisible();
  await expect
    .poll(async () => {
      const [labelBox, buttonBox] = await Promise.all([
        apiKeyLabel.boundingBox(),
        revokeApiKey.boundingBox(),
      ]);
      return labelBox && buttonBox ? labelBox.y + labelBox.height <= buttonBox.y : false;
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
});

test('attribute modifier popovers keep their actions reachable on a short mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow modifier sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expectCharacterNavigationReady(page);
  await selectCharacterSection(page, 'Overview');
  const overview = page.getByRole('button', { name: /Sheet overview/ });
  if ((await overview.getAttribute('aria-expanded')) === 'false') await overview.click();
  await page.getByRole('button', { name: 'Edit IQ modifiers' }).click();

  const apply = page.getByRole('dialog', { name: 'Modifiers for IQ' }).getByRole('button', {
    name: 'Apply',
  });
  await expect(apply).toBeVisible();
  await expect
    .poll(async () => {
      const box = await apply.boundingBox();
      return box ? box.y >= 0 && box.y + box.height <= 568 : false;
    })
    .toBe(true);
});
