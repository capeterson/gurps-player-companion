import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test('notification settings and long inbox events fit responsive viewports', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so the generated account can be removed',
  );
  test.setTimeout(90_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const email = `notifications-responsive-${suffix()}@example.com`;
  const eventTitle = `CampaignRulesUpdated${'LongUnbrokenNotificationTitle'.repeat(5)}`;
  const eventMessage = `${'A long event message describes a campaign change in detail. '.repeat(8)}${'UnbrokenNotificationToken'.repeat(4)}`;
  const notification = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    type: 'campaign_rules_changed',
    payload: {
      topic: 'campaignChanges',
      title: eventTitle,
      message: eventMessage,
      href: null,
      actorId: null,
      characterId: null,
      campaignId: null,
      changes: ['Campaign rules'],
    },
    relatedId: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    actionable: false,
  };

  try {
    await page.route('**/api/v1/notifications**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([notification]),
      });
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Notifications Responsive QA');
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

    const preferenceLabels = [
      'Desktop notifications',
      'Campaign invitations',
      'Invitation accepted',
      'Invitations',
      'Membership and access',
      'Changes to my characters',
      'Points awards',
      'Campaign rules and settings',
      'Shared adventure log',
      'Linked library updates',
    ];
    for (const viewport of VIEWPORTS) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await page.goto('/settings');
        const settings = page.locator('#notification-settings');
        await expect(settings.getByRole('heading', { name: 'Notifications' })).toBeVisible();
        await expect(settings.getByText('Always on', { exact: true })).toBeVisible();
        for (const label of preferenceLabels) {
          const checkbox = settings.getByRole('checkbox', { name: label, exact: true });
          await expect(checkbox).toBeVisible();
          const [rowBox, textBox, checkboxBox] = await Promise.all([
            checkbox.locator('xpath=ancestor::label').boundingBox(),
            settings.getByText(label, { exact: true }).boundingBox(),
            checkbox.boundingBox(),
          ]);
          expect(rowBox, `${label} row at ${viewport.width}px`).not.toBeNull();
          expect(textBox, `${label} text at ${viewport.width}px`).not.toBeNull();
          expect(checkboxBox, `${label} control at ${viewport.width}px`).not.toBeNull();
          if (rowBox && textBox && checkboxBox) {
            expect(textBox.x).toBeGreaterThanOrEqual(rowBox.x);
            expect(textBox.x + textBox.width).toBeLessThanOrEqual(checkboxBox.x + 1);
            expect(checkboxBox.x + checkboxBox.width).toBeLessThanOrEqual(
              rowBox.x + rowBox.width + 1,
            );
          }
        }
        const settingsBox = await settings.boundingBox();
        expect(settingsBox).not.toBeNull();
        if (settingsBox) {
          expect(settingsBox.x).toBeGreaterThanOrEqual(0);
          expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(viewport.width);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        if ([320, 568].includes(viewport.width)) {
          await captureReviewScreenshot(settings, {
            path: testInfo.outputPath(
              `notification-settings-${viewport.width}x${viewport.height}.png`,
            ),
            animations: 'disabled',
          });
        }

        await page.goto('/');
        const bell = page.getByLabel('Notifications (1 unread)', { exact: true });
        await expect(bell).toBeVisible();
        await bell.click();
        const panel = page
          .locator('details.dropdown')
          .filter({ has: bell })
          .locator('.dropdown-content');
        await expect(panel.getByText(eventTitle, { exact: true })).toBeVisible();
        await expect(panel.getByText(eventMessage, { exact: true })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Mark all read' })).toBeVisible();

        const panelBox = await panel.boundingBox();
        const visualViewport = await page.evaluate(() => {
          const visual = window.visualViewport;
          const left = visual?.offsetLeft ?? 0;
          const top = visual?.offsetTop ?? 0;
          const width = visual?.width ?? window.innerWidth;
          const height = visual?.height ?? window.innerHeight;
          return { left, top, right: left + width, bottom: top + height };
        });
        expect(panelBox).not.toBeNull();
        if (panelBox) {
          expect(panelBox.x).toBeGreaterThanOrEqual(visualViewport.left - 1);
          expect(panelBox.y).toBeGreaterThanOrEqual(visualViewport.top - 1);
          expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(visualViewport.right + 1);
          expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(visualViewport.bottom + 1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );

        if ([320, 568].includes(viewport.width)) {
          await captureReviewScreenshot(page, {
            path: testInfo.outputPath(
              `notification-inbox-${viewport.width}x${viewport.height}.png`,
            ),
            animations: 'disabled',
          });
        }
        const markRead = panel.getByRole('button', { name: 'Mark read' });
        await markRead.scrollIntoViewIfNeeded();
        await expect(markRead).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Dismiss' })).toBeVisible();
        const actionBox = await markRead.boundingBox();
        expect(actionBox).not.toBeNull();
        if (actionBox && panelBox) {
          expect(actionBox.x).toBeGreaterThanOrEqual(panelBox.x);
          expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(
            panelBox.x + panelBox.width + 1,
          );
          expect(actionBox.y).toBeGreaterThanOrEqual(visualViewport.top - 1);
          expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(visualViewport.bottom + 1);
        }
        if ([320, 568].includes(viewport.width)) {
          await captureReviewScreenshot(page, {
            path: testInfo.outputPath(
              `notification-inbox-actions-${viewport.width}x${viewport.height}.png`,
            ),
            animations: 'disabled',
          });
        }
      });
    }
  } finally {
    try {
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
