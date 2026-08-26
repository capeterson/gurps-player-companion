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
