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
