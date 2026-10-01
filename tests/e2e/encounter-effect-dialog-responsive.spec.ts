import { type Locator, type Page, expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 375, height: 667 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1920, height: 1080 },
];

async function register(page: Page) {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`effect-dialog-responsive-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Effect dialog responsive QA');
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
    data: { name: 'Responsive effect', experimentalTurnTracker: true },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { id: string };
}

async function expectTopmost(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  const hitTarget = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && (element === hit || element.contains(hit));
  });
  expect(hitTarget).toBe(true);
}

test('Add effect dialog stays above the sticky header and closes after create or edit', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await register(page);
  const campaign = await createCampaign(page);
  await page.goto(`/campaigns/${campaign.id}/encounters`);
  await page.getByRole('button', { name: 'New encounter' }).click();
  await expect(page).toHaveURL(/\/campaigns\/[^/]+\/encounters\/[^/]+$/);
  await page.getByLabel('NPC name').fill('Effect target NPC');
  await page.getByRole('button', { name: 'Add NPC', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Effect target NPC' })).toBeVisible();

  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const modalBox = dialog.locator('.modal-box');
  const title = dialog.getByRole('heading', { name: 'Add effect' });
  const name = dialog.getByRole('textbox', { name: 'Name' });
  const target = dialog.getByRole('combobox', { name: 'Target' });
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
      await expect(target).toBeVisible();
      if ([320, 568, 640].includes(viewport.width)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`effect-dialog-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }
      await expectTopmost(title);
      await expectTopmost(name);
      await expectTopmost(target);

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
      await expectTopmost(cancel);
      await expect
        .poll(
          async () => {
            const cancelBox = await cancel.boundingBox();
            return (
              cancelBox !== null &&
              cancelBox.x >= 0 &&
              cancelBox.y >= 0 &&
              cancelBox.x + cancelBox.width <= viewport.width &&
              cancelBox.y + cancelBox.height <= viewport.height
            );
          },
          { message: `Cancel remains fully reachable at ${viewport.width}×${viewport.height}` },
        )
        .toBe(true);
    });
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await name.fill('A protective ward');
  await target.selectOption({ label: 'Effect target NPC' });
  await dialog.getByRole('button', { name: 'Add effect', exact: true }).click();
  await expect(dialog).toBeHidden();
  const effect = page.getByRole('article').filter({ hasText: 'A protective ward' });
  await expect(effect).toBeVisible();

  await effect.getByRole('button', { name: 'Edit', exact: true }).click();
  const editDialog = page.getByRole('dialog');
  await expect(editDialog.getByRole('heading', { name: 'Edit effect' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editDialog).toBeHidden();
  await effect.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editDialog.getByRole('heading', { name: 'Edit effect' })).toBeVisible();
  await editDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(editDialog).toBeHidden();
});
