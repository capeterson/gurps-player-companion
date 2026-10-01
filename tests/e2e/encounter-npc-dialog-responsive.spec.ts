import { type Locator, type Page, expect, test } from '@playwright/test';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1920, height: 1080 },
];

async function register(page: Page) {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`npc-dialog-responsive-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('NPC dialog responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
}

async function createCampaign(page: Page) {
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.fetch('/api/v1/campaigns', {
    method: 'POST',
    data: { name: 'Responsive encounter', experimentalTurnTracker: true },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { id: string };
}

async function expectTopmost(target: Locator) {
  await expect(target).toBeVisible();
  const hitTarget = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && (element === hit || element.contains(hit));
  });
  expect(hitTarget).toBe(true);
}

test('detailed NPC dialog stays above the sticky header and inside every viewport', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  const campaign = await createCampaign(page);
  await page.goto(`/campaigns/${campaign.id}/encounters`);
  await expect(page.getByRole('heading', { name: 'Encounters' })).toBeVisible();
  await page.getByRole('button', { name: 'New encounter' }).click();
  await expect(page).toHaveURL(/\/campaigns\/[^/]+\/encounters\/[^/]+$/);
  await page.getByRole('button', { name: 'Detailed NPC' }).click();

  const dialog = page.getByRole('dialog');
  const modalBox = dialog.locator('.modal-box');
  const title = dialog.getByRole('heading', { name: 'Add NPC' });
  const name = dialog.getByRole('textbox', { name: 'NPC name' });
  const basicSpeed = dialog.getByRole('spinbutton', { name: 'Basic Speed' });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  await expect(dialog).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await test.step(`${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await expect(dialog).toBeVisible();
      await modalBox.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect(title).toBeVisible();
      await expect(name).toBeVisible();
      await expect(basicSpeed).toBeVisible();
      await expectTopmost(title);
      await expectTopmost(name);
      await expectTopmost(basicSpeed);
      if ([320, 568, 640, 768, 1024, 1920].includes(viewport.width)) {
        await page.screenshot({
          path: testInfo.outputPath(`npc-dialog-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }
      const box = await modalBox.boundingBox();
      expect(box).not.toBeNull();
      if (!box) return;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);

      await cancel.scrollIntoViewIfNeeded();
      await expect(cancel).toBeVisible();
      await expectTopmost(cancel);
    });
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await name.fill('Responsive NPC');
  await dialog.getByRole('button', { name: 'Add NPC', exact: true }).click();
  await expect(dialog).toBeHidden();
  const npc = page.getByRole('article').filter({ hasText: 'Responsive NPC' });
  await expect(npc).toBeVisible();
  await npc.getByRole('button', { name: 'Edit', exact: true }).click();
  const editDialog = page.getByRole('dialog');
  await expect(editDialog.getByRole('heading', { name: 'Edit NPC' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editDialog).toBeHidden();
  await npc.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editDialog.getByRole('heading', { name: 'Edit NPC' })).toBeVisible();
  await editDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(editDialog).toBeHidden();
});
