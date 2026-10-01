import { type Page, expect, test } from '@playwright/test';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function register(page: Page) {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`campaign-workspace-responsive-${suffix()}@example.com`);
  await page.getByLabel(/display name/i).fill('Campaign Workspace Responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
    timeout: 15_000,
  });
}

async function createCampaign(page: Page) {
  const accessToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.post('/api/v1/campaigns', {
    data: {
      name: 'Responsive campaign workspace',
      experimentalTurnTracker: true,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { id: string };
}

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 767, height: 900 },
  { width: 768, height: 1024 },
  { width: 769, height: 900 },
  { width: 1023, height: 768 },
  { width: 1024, height: 768 },
  { width: 1025, height: 768 },
  { width: 1280, height: 800 },
];

async function settleDialogViewport(
  dialog: import('@playwright/test').Locator,
  modalBox: import('@playwright/test').Locator,
  viewport: { width: number; height: number },
) {
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.style.getPropertyValue('--dialog-viewport-height')),
    )
    .toBe(`${viewport.height}px`);
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.style.getPropertyValue('--dialog-viewport-width')),
    )
    .toBe(`${viewport.width}px`);
  await expect
    .poll(() =>
      modalBox.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          Math.abs(rect.width - Number.parseFloat(style.width)) < 1 &&
          Math.abs(rect.height - Number.parseFloat(style.height)) < 1
        );
      }),
    )
    .toBe(true);
}

test('campaign workspace pages and settings stay within supported form factors', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await register(page);
  const campaign = await createCampaign(page);
  const routes = [
    { path: `/campaigns/${campaign.id}`, heading: 'Overview' },
    { path: `/campaigns/${campaign.id}/log`, heading: 'Adventure Log' },
    { path: `/campaigns/${campaign.id}/library?section=traits`, heading: 'Library' },
    { path: `/campaigns/${campaign.id}/encounters`, heading: 'Encounters' },
    { path: `/campaigns/${campaign.id}/gm`, heading: 'GM dashboard' },
    { path: `/campaigns/${campaign.id}/history`, heading: 'History' },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    const heading = page.getByRole('heading', { name: route.heading, exact: true });
    await expect(heading).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('navigation', { name: 'Campaign sections' })).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await test.step(`${route.heading} at ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await expect(heading).toBeVisible();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(viewport.width);

        if ([320, 568, 1280].includes(viewport.width)) {
          await page.screenshot({
            path: testInfo.outputPath(
              `campaign-${route.heading.toLowerCase().replaceAll(' ', '-')}-${viewport.width}x${viewport.height}.png`,
            ),
            animations: 'disabled',
          });
        }
      });
    }
  }

  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Responsive campaign workspace' });
  const modalBox = dialog.locator('.modal-box');
  const dialogBody = dialog.locator('.modal-box > div.min-h-0');
  await expect(dialog).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await test.step(`campaign settings at ${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await settleDialogViewport(dialog, modalBox, viewport);
      const box = await modalBox.boundingBox();
      expect(box).not.toBeNull();
      if (!box) return;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await expect(dialog.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
      const save = dialog.getByRole('button', { name: 'Save', exact: true });
      await expect(cancel).toBeVisible();
      await expect(save).toBeVisible();
      for (const action of [cancel, save]) {
        const actionBox = await action.boundingBox();
        expect(actionBox).not.toBeNull();
        if (!actionBox) return;
        expect(actionBox.y).toBeGreaterThanOrEqual(0);
        expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(viewport.height);
      }
      if (viewport.height <= 768) {
        const bodyScroll = await dialogBody.evaluate((element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }));
        expect(bodyScroll.scrollHeight).toBeGreaterThan(bodyScroll.clientHeight);
      }

      if ([320, 568, 768, 1023, 1024, 1025, 1280].includes(viewport.width)) {
        await page.screenshot({
          path: testInfo.outputPath(`campaign-settings-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }
    });
  }

  await dialog.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(dialog.getByLabel('House rule set')).toBeVisible();
  await dialog.getByRole('button', { name: 'Members', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
});
