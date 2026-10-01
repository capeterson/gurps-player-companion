import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

async function settleLayout(page: import('@playwright/test').Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function expectInsideViewport(
  locator: import('@playwright/test').Locator,
  viewport: (typeof viewports)[number],
) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
}

test('authenticated header navigation and account menu survive resize', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL so this test can remove its generated account',
  );
  test.setTimeout(90_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const email = `header-navigation-resize-${suffix()}@example.com`;
  const displayName = `LongUnspacedDisplayName${'NavigationLabel'.repeat(3)}`;

  try {
    await page.setViewportSize(viewports[0]);
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill(displayName);
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
      timeout: 15_000,
    });

    await page.goto('/campaigns');
    const title = page.getByRole('heading', { name: 'Campaigns', exact: true });
    const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
    const userMenuTrigger = page.locator('header.app-header summary[aria-label="Open user menu"]');
    await expect(title).toBeVisible();

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await settleLayout(page);
      await expect(title).toBeVisible();
      await expect(
        primaryNavigation.getByRole('link', { name: 'Character', exact: true }),
      ).toBeVisible();
      await expect(
        primaryNavigation.getByRole('link', { name: 'Campaign', exact: true }),
      ).toBeVisible();
      await expectInsideViewport(userMenuTrigger, viewport);
    }

    await page.setViewportSize(viewports[0]);
    await userMenuTrigger.click();
    const accountMenu = page.locator(
      'details.dropdown[open]:has(> summary[aria-label="Open user menu"]) ul.dropdown-content',
    );
    await expect(accountMenu).toContainText(email);
    await expect(accountMenu).toContainText('About');
    await expect(accountMenu).toContainText('Settings');
    await expect(accountMenu).toContainText('Logout');

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await settleLayout(page);
      await expect(accountMenu).toBeVisible();
      const box = await accountMenu.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
      await expectInsideViewport(
        accountMenu.getByRole('link', { name: 'Settings', exact: true }),
        viewport,
      );
      await expectInsideViewport(
        accountMenu.getByRole('button', { name: 'Logout', exact: true }),
        viewport,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      if (viewport.width === 320 || (viewport.width === 568 && viewport.height === 320)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`account-menu-resize-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }
    }

    await accountMenu.getByRole('link', { name: 'Settings', exact: true }).click();
    const settingsTitle = page.getByRole('heading', { name: 'Settings', exact: true });
    await expect(settingsTitle).toBeVisible();
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await settleLayout(page);
      await expect(settingsTitle).toBeVisible();
      await expect(
        primaryNavigation.getByRole('link', { name: 'Character', exact: true }),
      ).toBeVisible();
      await expect(
        primaryNavigation.getByRole('link', { name: 'Campaign', exact: true }),
      ).toBeVisible();
    }
  } finally {
    try {
      await pool.query('delete from users where email = $1', [email]);
    } finally {
      await pool.end();
    }
  }
});
