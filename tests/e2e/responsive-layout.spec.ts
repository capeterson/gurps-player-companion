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
  const traitName = 'PneumonoultramicroscopicsilicovolcanoconiosisUnbreakableResponsiveLibraryTrait';

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

test('skill rows do not create page-level horizontal overflow on a 320px viewport', async ({
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
  await page.getByLabel(/^skill$/i).fill('Extremely Long Skill Name For Horizontal Testing');
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(
    page.getByLabel(/Extremely Long Skill Name For Horizontal Testing name/i),
  ).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
});

test('spell rows do not create page-level horizontal overflow on a 320px viewport', async ({
  page,
}) => {
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
  await page.locator('.panel-tab').filter({ hasText: /^Magic/ }).click();
  await page.getByLabel(/^spell$/i).fill('Extremely Long Spell Name For Horizontal Testing');
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(
    page.getByLabel(/Extremely Long Spell Name For Horizontal Testing name/i),
  ).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
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

  const close = page.getByRole('dialog', { name: 'Responsive campaign settings' }).getByLabel('Close');
  await expect(close).toBeVisible();
  await expect
    .poll(async () => {
      const box = await close.boundingBox();
      return box ? box.y >= 0 && box.y + box.height <= 568 : false;
    })
    .toBe(true);
});

test('item edit dialog keeps its cancel control reachable on a short mobile viewport', async ({
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
  await page.locator('.panel-tab').filter({ hasText: /^Inventory/ }).click();
  await page.getByLabel('Item name').fill('Reachable item');
  await page.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByText('Reachable item', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Reachable item' }).click();

  const itemDialog = page.locator('dialog[open]').filter({ hasText: 'Edit item' });
  const cancel = itemDialog.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeVisible();
  await expect
    .poll(async () => {
      const box = await cancel.boundingBox();
      return box ? box.y >= 0 && box.y + box.height <= 568 : false;
    })
    .toBe(true);
});

test('detailed NPC dialog keeps its actions reachable on a short mobile viewport', async ({ page }) => {
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

test('long powerstone rows do not create page-level horizontal overflow on a 320px viewport', async ({
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
  await page.locator('.panel-tab').filter({ hasText: /^Inventory/ }).click();
  await page
    .getByLabel('Item name')
    .fill('Extremely Long Powerstone Name For Horizontal Overflow Testing');
  await page.getByRole('button', { name: /^add$/i }).click();
  await page.getByRole('button', { name: /edit extremely long powerstone/i }).click();
  await page.getByRole('button', { name: '+ Powerstone' }).click();
  await page.getByRole('button', { name: /^save$/i }).click();
  await page.locator('.panel-tab').filter({ hasText: /^Magic/ }).click();
  await expect(page.getByText('Stored energy')).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
});

test('long recent-character cards do not create page-level horizontal overflow at 320px', async ({
  page,
}) => {
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
});
