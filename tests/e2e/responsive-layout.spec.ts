import { expect, test } from '@playwright/test';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

test('long campaign cards do not create page-level horizontal overflow at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const email = `responsive-campaign-card-${suffix()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

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
  const email = `responsive-library-trait-${suffix()}@example.com`;
  const traitName =
    'PneumonoultramicroscopicsilicovolcanoconiosisUnbreakableResponsiveLibraryTrait';

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

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
  const email = `responsive-skills-${suffix()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 15_000 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow Skill Sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 10_000 });
  await expect(page.locator('.panel-tabs')).toBeVisible({ timeout: 15_000 });

  await page
    .locator('.panel-tab')
    .filter({ hasText: /^Skills/ })
    .click();
  const skillName = 'Extremely Long Skill Name For Horizontal Testing';
  const skillForm = page.getByLabel(/^skill$/i).locator('xpath=ancestor::form');
  await page.getByLabel(/^skill$/i).fill(skillName);
  await skillForm.getByRole('button', { name: /^add$/i }).click();
  const skillNameInput = page.getByLabel(`${skillName} name`);
  await expect(skillNameInput).toBeVisible();

  const techniqueName = 'Retain Weapon After a Very Long Technique Name';
  const techniqueForm = page.getByLabel(/^technique$/i).locator('xpath=ancestor::form');
  await page.getByLabel(/^technique$/i).fill(techniqueName);
  await techniqueForm.getByLabel('Defaults from').fill(skillName);
  await techniqueForm.getByRole('button', { name: /^add$/i }).click();
  const techniqueNameInput = page.getByLabel(`${techniqueName} name`);
  await expect(techniqueNameInput).toBeVisible();

  const languageName = 'Pneumonoultramicroscopicsilicovolcanoconiosis Language';
  const languageForm = page.getByLabel(/^language$/i).locator('xpath=ancestor::form');
  await page.getByLabel(/^language$/i).fill(languageName);
  await languageForm.getByRole('button', { name: /^add$/i }).click();
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

test('spell rows stay readable at narrow mobile and tablet breakpoints', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 320, height: 568 });
  const email = `responsive-spells-${suffix()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 15_000 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow Spell Sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 10_000 });
  await page
    .locator('.panel-tab')
    .filter({ hasText: /^Magic/ })
    .click();
  const spellName = 'Extremely Long Spell Name For Horizontal Testing';
  const spellForm = page.getByLabel(/^spell$/i).locator('xpath=ancestor::form');
  await page.getByLabel(/^spell$/i).fill(spellName);
  await spellForm.getByRole('button', { name: /^add$/i }).click();
  const spellNameInput = page.getByLabel(`${spellName} name`);
  await expect(spellNameInput).toBeVisible();
  await expect
    .poll(() => spellNameInput.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(180);
  const spellSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Known spells' }) });
  await expect(spellSection.locator('.overflow-x-auto')).toHaveCount(0);

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);

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
  await page
    .locator('.panel-tab')
    .filter({ hasText: /^Identity/ })
    .click();
  await page
    .getByLabel('campaign', { exact: true })
    .selectOption({ label: 'Responsive spell library' });
  await page
    .locator('.panel-tab')
    .filter({ hasText: /^Magic/ })
    .click();
  await page.getByLabel(/^spell$/i).fill(maintainableSpellName);
  await page.getByRole('option', { name: new RegExp(maintainableSpellName) }).click();
  const maintainableForm = page.getByLabel(/^spell$/i).locator('xpath=ancestor::form');
  await maintainableForm.getByRole('button', { name: /^add$/i }).click();

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
  const email = `responsive-campaign-settings-${suffix()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

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
  const email = `responsive-item-dialog-${suffix()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow Item Sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.locator('.panel-tabs')).toBeVisible({ timeout: 15_000 });
  await page
    .locator('.panel-tab')
    .filter({ hasText: /^Inventory/ })
    .click();
  await page.getByLabel('Item name').fill('Reachable item');
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByText('Reachable item', { exact: true })).toBeVisible();
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

test('detailed NPC dialog keeps its actions reachable on a short mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const email = `responsive-npc-dialog-${suffix()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill('Responsive NPC encounter');
  await page.getByRole('button', { name: /^create$/i }).click();
  await page.getByRole('link', { name: 'Responsive NPC encounter' }).click();
  await page.getByRole('button', { name: /new encounter/i }).click();
  await page.getByRole('button', { name: 'Detailed NPC' }).click();

  const cancel = page.locator('dialog[open]').getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeVisible();
  await cancel.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const box = await cancel.boundingBox();
      return box ? box.y >= 0 && box.y + box.height <= 568 : false;
    })
    .toBe(true);
});

test('effect dialog keeps its actions reachable on a short mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const email = `responsive-effect-dialog-${suffix()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill('Responsive effect dialog');
  await page.getByRole('button', { name: /^create$/i }).click();
  await page.getByRole('link', { name: 'Responsive effect dialog' }).click();
  await page.getByRole('button', { name: /new encounter/i }).click();
  await page.getByRole('button', { name: 'Detailed NPC' }).click();

  const npcDialog = page.locator('dialog[open]');
  await npcDialog.getByLabel('NPC name').fill('Effect target');
  await npcDialog.getByRole('button', { name: 'Add NPC' }).click();
  await page.getByRole('button', { name: 'Add effect' }).click();

  const effectDialog = page.locator('dialog[open]');
  const effectCancel = effectDialog.getByRole('button', { name: 'Cancel' });
  await expect(effectCancel).toBeVisible();
  await effectCancel.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const box = await effectCancel.boundingBox();
      return box ? box.y >= 0 && box.y + box.height <= 568 : false;
    })
    .toBe(true);
});

test('cast spell dialog keeps its actions reachable on a short mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const email = `responsive-cast-dialog-${suffix()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow Caster Sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.locator('.panel-tabs')).toBeVisible({ timeout: 15_000 });

  await page
    .locator('.panel-tab')
    .filter({ hasText: /^Traits/ })
    .click();
  await page.getByLabel('Trait name').fill('Magery');
  await page.getByRole('button', { name: /^add$/i }).click();

  await page
    .locator('.panel-tab')
    .filter({ hasText: /^Magic/ })
    .click();
  await page.getByLabel(/^spell$/i).fill('Reachable spell');
  await page.getByRole('button', { name: /^add$/i }).click();
  await page.getByRole('button', { name: 'Cast Reachable spell' }).click();

  const castDialog = page.locator('dialog[open]').filter({ hasText: 'Reachable spell' });
  const cancel = castDialog.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeVisible();
  await expect
    .poll(async () => {
      const box = await cancel.boundingBox();
      return box ? box.y >= 0 && box.y + box.height <= 568 : false;
    })
    .toBe(true);
});

test('long powerstone and magic-item rows stack their controls on a 320px viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const email = `responsive-powerstone-${suffix()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow Powerstone Sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.locator('.panel-tabs')).toBeVisible({ timeout: 15_000 });
  await page
    .locator('.panel-tab')
    .filter({ hasText: /^Inventory/ })
    .click();
  const powerstoneName = 'PneumonoultramicroscopicsilicovolcanoconiosisUnbreakablePowerstone';
  await page.getByLabel('Item name').fill(powerstoneName);
  await page.getByRole('button', { name: /^add$/i }).click();
  await page.getByRole('button', { name: `Add category to ${powerstoneName}` }).click();
  await page.getByRole('button', { name: '+ Powerstone', exact: true }).click();

  const magicItemName = 'ThaumatologicallyOverengineeredUnbreakableResponsiveWand';
  await page.getByLabel('Item name').fill(magicItemName);
  await page.getByRole('button', { name: /^add$/i }).click();
  await page.getByRole('button', { name: `Add category to ${magicItemName}` }).click();
  await page.getByRole('button', { name: '+ Magic item', exact: true }).click();
  await page.getByLabel('Magic item spell name').fill('Light');
  await page.getByRole('button', { name: 'Add magic item', exact: true }).click();
  await page
    .locator('.panel-tab')
    .filter({ hasText: /^Magic/ })
    .click();
  await expect(page.getByText('Stored energy')).toBeVisible();
  const powerstoneLabel = page.getByText(powerstoneName, { exact: true });
  const magicItemLabel = page.getByText(magicItemName, { exact: true });
  await expect(powerstoneLabel).toBeVisible();
  await expect(magicItemLabel).toBeVisible();
  for (const label of [powerstoneLabel, magicItemLabel]) {
    await expect
      .poll(() =>
        label.locator('xpath=..').evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBeGreaterThan(180);
  }

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
});

test('long recent-character and API-key names stay contained at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const email = `responsive-recent-character-${suffix()}@example.com`;
  const name = 'Sir Responsiveness Longname the Unbreakably Extensive Tester';

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

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
  const email = `responsive-modifier-popover-${suffix()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Narrow modifier sheet');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.locator('.panel-tabs')).toBeVisible({ timeout: 15_000 });
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
