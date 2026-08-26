import { expect, test } from '@playwright/test';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

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
