/**
 * Smoke test: the SPA boots, the login form renders, and a freshly
 * registered user can reach the authenticated home page.
 *
 * Requires the dev stack to be running (Postgres + the Bun server on
 * :3001).  Skipped automatically in CI until we wire docker-compose
 * into the workflow.
 */

import { expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';

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
  await rollDialog.getByRole('button', { name: /Roll vs \d+/ }).click();
  await rollDialog.getByRole('button', { name: 'Close' }).last().click();

  await selectCharacterSection(page, 'History');
  await expect(page.getByRole('tab', { name: 'Change history' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Roll history' }).click();
  await expect(page.getByRole('list', { name: 'Roll history entries' })).toContainText('Dodge');
  await expect(page.getByText(/saved on this device only and never synced/i)).toBeVisible();

  await page.reload();
  await selectCharacterSection(page, 'History');
  await page.getByRole('tab', { name: 'Roll history' }).click();
  await expect(page.getByRole('list', { name: 'Roll history entries' })).toContainText('Dodge');
});

test('campaign workspace navigation and breadcrumbs stay usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/register');
  const email = `e2e-menu-${TIMESTAMP_SUFFIX()}@example.com`;
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Menu QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 10_000 });

  await page.goto('/campaigns');
  const campaignName = `Breadcrumb navigation for new players ${TIMESTAMP_SUFFIX()}`;
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill(campaignName);
  await page.getByRole('button', { name: /^create$/i }).click();
  await page.getByRole('link', { name: new RegExp(campaignName) }).click();
  const campaignId = page.url().split('/').at(-1);
  const primary = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(primary.getByRole('link', { name: campaignName })).toBeVisible({ timeout: 15_000 });
  await expect(primary.locator('span[aria-current="page"]')).toHaveText('Overview');

  const workspace = page.getByRole('navigation', { name: 'Campaign sections' });
  await expect(workspace.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(workspace.getByRole('link', { name: 'Adventure log' })).toBeVisible();
  await expect(workspace.getByRole('link', { name: 'Library' })).toBeAttached();
  await expect(workspace.getByRole('link', { name: 'History' })).toBeAttached();
  await expect(workspace.getByRole('link', { name: 'GM dashboard' })).toBeAttached();
  const workspaceBounds = await workspace.boundingBox();
  expect(workspaceBounds).not.toBeNull();
  expect(workspaceBounds?.x).toBeGreaterThanOrEqual(0);
  expect(workspaceBounds ? workspaceBounds.x + workspaceBounds.width : 0).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await workspace.getByRole('link', { name: 'Adventure log' }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/log$`));
  await expect(primary.getByRole('link', { name: campaignName })).toBeVisible({ timeout: 15_000 });
  await expect(primary.locator('span[aria-current="page"]')).toHaveText('Adventure log');
  await expect(page.getByRole('heading', { name: 'Adventure Log' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}$`));
  await expect(primary.locator('span[aria-current="page"]')).toHaveText('Overview');

  await workspace.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/library$`));
  await expect(primary.locator('span[aria-current="page"]')).toHaveText('Library');

  await page
    .getByRole('navigation', { name: 'Campaign sections' })
    .getByRole('link', {
      name: 'History',
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/history$`));
  await expect(primary.locator('span[aria-current="page"]')).toHaveText('History');

  await page
    .getByRole('navigation', { name: 'Campaign sections' })
    .getByRole('link', {
      name: 'GM dashboard',
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/gm$`));
  await expect(primary.locator('span[aria-current="page"]')).toHaveText('GM dashboard');
});
