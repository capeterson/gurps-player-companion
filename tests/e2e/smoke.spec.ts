/**
 * Smoke test: the SPA boots, the login form renders, and a freshly
 * registered user can reach the authenticated home page.
 *
 * Requires the dev stack to be running (Postgres + the Bun server on
 * :3001).  Skipped automatically in CI until we wire docker-compose
 * into the workflow.
 */

import { expect, test } from '@playwright/test';

const TIMESTAMP_SUFFIX = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test('login page renders and links to register', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /create an account/i })).toBeVisible();
});

test('registers a new user and lands on the authenticated shell', async ({ page }) => {
  await page.goto('/register');
  const email = `e2e-${TIMESTAMP_SUFFIX()}@example.com`;
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Playwright User');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 10_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('roll history moves from Combat into the History tab and survives reload locally', async ({
  page,
}) => {
  const email = `e2e-roll-history-${TIMESTAMP_SUFFIX()}@example.com`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Roll History QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Local Roller');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 10_000 });

  await page.getByRole('button', { name: /^Dodge \d+$/ }).click();
  const rollDialog = page.getByRole('dialog', { name: 'Roll Dodge' });
  await rollDialog.getByRole('button', { name: 'Roll 3d6' }).click();
  await rollDialog.getByRole('button', { name: 'Close' }).last().click();

  const historyTab = page.locator('.panel-tab').filter({ hasText: /^History$/ });
  await historyTab.click();
  await expect(page.getByRole('tab', { name: 'Change history' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Roll history' }).click();
  await expect(page.getByRole('list', { name: 'Roll history entries' })).toContainText('Dodge');
  await expect(page.getByText(/saved on this device only and never synced/i)).toBeVisible();

  await page.reload();
  await historyTab.click();
  await page.getByRole('tab', { name: 'Roll history' }).click();
  await expect(page.getByRole('list', { name: 'Roll history entries' })).toContainText('Dodge');
});

test('campaign sub-menu stays inside a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/register');
  const email = `e2e-menu-${TIMESTAMP_SUFFIX()}@example.com`;
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Menu QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 10_000 });

  await page.getByLabel('Campaign sub-menu').click();
  const menu = page.getByRole('link', { name: 'Library', exact: true }).locator('..').locator('..');
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect(bounds ? bounds.x + bounds.width : 0).toBeLessThanOrEqual(320);
});
