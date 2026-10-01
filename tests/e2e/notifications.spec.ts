import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

const timestamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test('notification controls stay opt-in, save preferences, and keep the inbox inside the viewport', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.addInitScript(() => {
    let permission: NotificationPermission = 'default';
    Object.defineProperty(window, '__notificationPermissionRequests', {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => permission,
    });
    Object.defineProperty(Notification, 'requestPermission', {
      configurable: true,
      value: async () => {
        (
          window as Window & { __notificationPermissionRequests: number }
        ).__notificationPermissionRequests += 1;
        permission = 'granted';
        return permission;
      },
    });
    Object.defineProperty(window, '__setNotificationPermission', {
      configurable: true,
      value: (value: NotificationPermission) => {
        permission = value;
      },
    });
  });

  const longMessage = `A GM updated several details on your character. ${'Representative long notification content. '.repeat(18)}`;
  await page.route('**/api/v1/notifications**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '11111111-1111-4111-8111-111111111111',
          userId: '22222222-2222-4222-8222-222222222222',
          type: 'character_changed',
          payload: {
            topic: 'characterChanges',
            title: 'A fellow campaign member updated your character',
            message: longMessage,
            href: '/characters/33333333-3333-4333-8333-333333333333',
            actorId: null,
            characterId: '33333333-3333-4333-8333-333333333333',
            campaignId: null,
            changes: ['Attributes', 'Skills', 'Inventory'],
          },
          relatedId: null,
          readAt: null,
          createdAt: new Date().toISOString(),
          actionable: false,
        },
      ]),
    });
  });
  const panelForBell = (bell: ReturnType<typeof page.getByLabel>) =>
    page.locator('details.dropdown').filter({ has: bell }).locator('.dropdown-content');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await expect(page.getByLabel(/email/i)).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __notificationPermissionRequests: number })
          .__notificationPermissionRequests,
    ),
  ).toBe(0);
  await page.goto('/register');
  const email = `e2e-notifications-${timestamp()}@example.com`;
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Notification QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page
    .getByRole('button', { name: /(create an account|create account|sign up|register)/i })
    .click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __notificationPermissionRequests: number })
          .__notificationPermissionRequests,
    ),
  ).toBe(0);

  await page.goto('/settings');
  const settings = page.locator('#notification-settings');
  await expect(settings.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  const desktop = settings.getByRole('checkbox', { name: 'Desktop notifications' });
  const emailInvitations = settings.getByRole('checkbox', { name: 'Campaign invitations' });
  const emailAccepted = settings.getByRole('checkbox', { name: 'Invitation accepted' });
  await expect(desktop).not.toBeChecked();
  await expect(emailInvitations).toBeChecked();
  await expect(emailAccepted).toBeChecked();
  await expect(settings.getByText('Always on')).toBeVisible();
  await expect(
    settings.getByText(/Email is available only for invitations and security alerts/i),
  ).toBeVisible();
  await expect(
    settings.getByText(/Password changes and passkey or API key changes always trigger an email/i),
  ).toBeVisible();
  await expect(settings.getByRole('checkbox', { name: 'Changes to my characters' })).toBeChecked();
  await expect(settings.getByRole('checkbox', { name: 'Points awards' })).toBeChecked();
  for (const label of [
    'Invitations',
    'Membership and access',
    'Changes to my characters',
    'Points awards',
    'Campaign rules and settings',
    'Shared adventure log',
    'Linked library updates',
  ]) {
    await expect(settings.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
  }

  const screenshotDir = process.env.NOTIFICATION_SCREENSHOT_DIR;
  await page.setViewportSize({ width: 1280, height: 2000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (screenshotDir) {
    await captureReviewScreenshot(settings, {
      path: `${screenshotDir}/notification-settings-desktop.png`,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 375, height: 2400 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(settings.getByRole('checkbox', { name: 'Desktop notifications' })).not.toBeChecked();
  if (screenshotDir) {
    await captureReviewScreenshot(settings, {
      path: `${screenshotDir}/notification-settings-mobile.png`,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Visiting Settings and opening the bell never asks for browser permission.
  const fixtureBell = page.getByLabel('Notifications (1 unread)', { exact: true });
  await fixtureBell.click();
  const fixturePanel = panelForBell(fixtureBell);
  await expect(
    fixturePanel.getByText('A fellow campaign member updated your character'),
  ).toBeVisible();
  await expect(fixturePanel).toHaveCSS('opacity', '1');
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __notificationPermissionRequests: number })
          .__notificationPermissionRequests,
    ),
  ).toBe(0);
  await fixtureBell.click();

  // In-app topic choices persist on the server and survive a reload.
  const characterChanges = settings.getByRole('checkbox', { name: 'Changes to my characters' });
  const topicOffSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/notification-preferences') &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  );
  await characterChanges.uncheck();
  await topicOffSaved;
  await expect(characterChanges).not.toBeChecked();
  await page.reload();
  await expect(
    settings.getByRole('checkbox', { name: 'Changes to my characters' }),
  ).not.toBeChecked();
  const topicOnSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/notification-preferences') &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  );
  await settings.getByRole('checkbox', { name: 'Changes to my characters' }).check();
  await topicOnSaved;
  await expect(settings.getByRole('checkbox', { name: 'Changes to my characters' })).toBeChecked();

  // The only permission prompt comes from the explicit Settings enable action.
  await desktop.check();
  await expect(desktop).toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __notificationPermissionRequests: number })
            .__notificationPermissionRequests,
      ),
    )
    .toBe(1);
  await desktop.uncheck();
  await page.evaluate(() => {
    (
      window as Window & { __setNotificationPermission: (value: NotificationPermission) => void }
    ).__setNotificationPermission('denied');
  });
  await desktop.click();
  await expect(desktop).not.toBeChecked();
  await expect(page.getByText(/Blocked by your browser/i)).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __notificationPermissionRequests: number })
          .__notificationPermissionRequests,
    ),
  ).toBe(1);

  // Revisit the real notification popover at supported breakpoints and inspect
  // its geometry against the viewport with long representative copy.
  const widths = [320, 375, 767, 768, 769, 1280];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 667 : 900 });
    await page.goto('/settings');
    const notificationSettings = page.locator('#notification-settings');
    await expect(
      notificationSettings.getByRole('heading', { name: 'Notifications' }),
    ).toBeVisible();
    for (const label of [
      'Campaign invitations',
      'Invitation accepted',
      'Desktop notifications',
      'Changes to my characters',
    ]) {
      await expect(
        notificationSettings.getByRole('checkbox', { name: label, exact: true }),
      ).toBeVisible();
    }
    await expect(notificationSettings.getByText('Always on', { exact: true })).toBeVisible();
    const settingsBox = await notificationSettings.boundingBox();
    expect(settingsBox, `notification settings card at ${width}px`).not.toBeNull();
    if (settingsBox) {
      expect(settingsBox.x, `settings card left edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(
        settingsBox.x + settingsBox.width,
        `settings card right edge at ${width}px`,
      ).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );

    await page.goto('/');
    const bell = page.getByLabel('Notifications (1 unread)');
    await expect(bell).toBeVisible();
    await bell.click();
    const panel = panelForBell(bell);
    await expect(panel.getByText('A fellow campaign member updated your character')).toBeVisible();
    await expect(panel).toHaveCSS('opacity', '1');
    if (screenshotDir && width === 320) {
      await captureReviewScreenshot(page, {
        path: `${screenshotDir}/notification-inbox-mobile.png`,
        fullPage: false,
        animations: 'disabled',
      });
    }
    const box = await panel.boundingBox();
    expect(box, `notification popover at ${width}px`).not.toBeNull();
    if (box) {
      const height = width < 768 ? 667 : 900;
      expect(box.x, `popover left edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.y, `popover top edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `popover right edge at ${width}px`).toBeLessThanOrEqual(width);
      expect(box.y + box.height, `popover bottom edge at ${width}px`).toBeLessThanOrEqual(height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await bell.click();
  }

  // Exercise the real invitation and character-history path as well. The
  // browser fixture above is only for long-copy popover geometry.
  await page.unroute('**/api/v1/notifications**');
  const playerToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const gmEmail = `e2e-notification-gm-${timestamp()}@example.com`;
  const gmRegistration = await page.request.post('/api/v1/auth/register', {
    data: { email: gmEmail, password: 'CorrectHorseBatteryStaple1', displayName: 'History GM' },
  });
  expect(gmRegistration.status(), await gmRegistration.text()).toBe(201);
  const gmToken = ((await gmRegistration.json()) as { accessToken: string }).accessToken;
  const gmHeaders = { authorization: `Bearer ${gmToken}` };
  const campaignName = `Notification history ${timestamp()}`;
  const campaignResponse = await page.request.post('/api/v1/campaigns', {
    headers: gmHeaders,
    data: { name: campaignName, allowGmCharacterEditing: true },
  });
  expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
  const campaign = (await campaignResponse.json()) as { id: string };
  const invitationResponse = await page.request.post(
    `/api/v1/campaigns/${campaign.id}/invitations`,
    { headers: gmHeaders, data: { handle: email, role: 'member' } },
  );
  expect(invitationResponse.status(), await invitationResponse.text()).toBe(201);
  await page.goto('/');
  const invitationBell = page.getByLabel(/Notifications \(1 unread\)/);
  await expect(invitationBell).toBeVisible();
  await invitationBell.click();
  const invitationPanel = panelForBell(invitationBell);
  await expect(invitationPanel.getByRole('button', { name: 'Accept' })).toBeVisible();
  await expect(invitationPanel.getByRole('button', { name: 'Decline' })).toBeVisible();
  await invitationPanel.getByRole('button', { name: 'Mark all read' }).click();
  await expect(invitationPanel.getByRole('button', { name: 'Accept' })).toBeVisible();
  await expect(invitationPanel.getByRole('button', { name: 'Decline' })).toBeVisible();
  await invitationPanel.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText(`Joined ${campaignName}`)).toBeVisible();

  const characterName =
    'A Longly Named Hero Whose Change History Must Be Easy to Reach from Notifications';
  const characterResponse = await page.request.post('/api/v1/characters', {
    headers: { authorization: `Bearer ${playerToken}` },
    data: { name: characterName, campaignId: campaign.id, st: 10 },
  });
  expect(characterResponse.status(), await characterResponse.text()).toBe(201);
  const character = (await characterResponse.json()) as { id: string };
  const editResponse = await page.request.patch(`/api/v1/characters/${character.id}`, {
    headers: gmHeaders,
    data: { st: 12 },
  });
  expect(editResponse.status(), await editResponse.text()).toBe(200);

  const readNotifications = async () => {
    const response = await page.request.get('/api/v1/notifications', {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as Array<{
      type: string;
      payload: Record<string, unknown>;
      readAt: string | null;
    }>;
  };
  await expect
    .poll(
      async () =>
        (await readNotifications()).some(
          (notification) =>
            notification.type === 'event' && notification.payload.characterId === character.id,
        ),
      { timeout: 20_000, intervals: [250, 500, 1_000] },
    )
    .toBe(true);
  const characterNotification = (await readNotifications()).find(
    (notification) =>
      notification.type === 'event' && notification.payload.characterId === character.id,
  );
  expect(characterNotification?.payload.href).toBe(`/characters/${character.id}#history`);

  await page.goto('/');
  const changeBell = page.getByLabel(/Notifications \(1 unread\)/);
  await expect(changeBell).toBeVisible();
  await changeBell.click();
  const changePanel = panelForBell(changeBell);
  await expect(changePanel.getByRole('link', { name: 'View' })).toBeVisible();
  await changePanel.getByRole('link', { name: 'View' }).click();
  await expect(changePanel).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/characters/${character.id}#history$`));
  await expect(page.getByRole('heading', { name: 'History' }).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Change history' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('ST 10 → 12')).toBeVisible({ timeout: 15_000 });
});
