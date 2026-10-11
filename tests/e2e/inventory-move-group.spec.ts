import { type Locator, type Page, expect, test } from '@playwright/test';
import { expectCharacterNavigationReady, selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

test.use({ serviceWorkers: 'block' });

// Phone, the 640px breakpoint boundaries, and desktop.
const VIEWPORTS = [
  { width: 375, height: 700 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 1280, height: 800 },
] as const;

async function expectInsideViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
}

/** The control is painted on top at its center, not covered by sticky chrome. */
async function expectUncovered(locator: Locator) {
  const hit = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return Boolean(target && (target === element || element.contains(target)));
  });
  expect(hit).toBe(true);
}

test('long inventories move rows without dragging and group by type', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`inventory-move-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Inventory mover');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
    timeout: 15_000,
  });
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  async function post(path: string, data: object) {
    const response = await page.request.post(`/api/v1${path}`, {
      data,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json() as Promise<{ id: string; item?: { id: string } }>;
  }

  const characterId = (await post('/characters', { name: 'Long inventory mover' })).id;
  const inventory = `/characters/${characterId}/inventory`;
  const pack = (await post(inventory, { name: 'Backpack', isContainer: true, worn: true })).item;
  await post(inventory, {
    name: 'Belt dagger',
    parentId: pack?.id,
    weaponData: { damage: 'sw-2 cut', skill: 'Knife' },
  });
  await post(inventory, {
    name: 'Leather jacket',
    worn: true,
    equipped: true,
    isArmor: true,
    armor: { locations: ['torso', 'arm_left', 'arm_right'], dr: 1, flexible: true },
  });
  for (let index = 1; index <= 24; index++) {
    const label = String(index).padStart(2, '0');
    await post(inventory, { name: `Carried supply ${label}`, worn: true });
    await post(inventory, { name: `Stored supply ${label}`, worn: false });
  }
  const targets = VIEWPORTS.map((_, index) => `Zephyr lantern ${index + 1}`);
  for (const name of targets) await post(inventory, { name, worn: false });

  await page.goto(`/characters/${characterId}`);
  await expectCharacterNavigationReady(page);
  await selectCharacterSection(page, 'Inventory');
  const carried = page.getByRole('table', { name: 'Carried inventory', exact: true });
  const stashed = page.getByRole('table', { name: 'Stashed inventory', exact: true });

  for (const [index, viewport] of VIEWPORTS.entries()) {
    await test.step(`move from Stashed at ${viewport.width}px`, async () => {
      await page.setViewportSize(viewport);
      const target = targets[index] as string;
      const title = stashed.getByText(target, { exact: true });
      await title.scrollIntoViewIfNeeded();
      await title.click();
      // The selection toolbar follows the scroll far below the section top.
      const selected = page.getByText('1 selected', { exact: true });
      await expect(selected).toBeInViewport({ ratio: 1 });
      const moveTo = page.getByRole('button', { name: 'Move to ▾' });
      await expect(moveTo).toBeInViewport({ ratio: 1 });
      await expectUncovered(moveTo);
      await expectUncovered(title);
      await attachReviewScreenshot(page, testInfo, `inventory-sticky-move-${viewport.width}`, {
        animations: 'disabled',
      });
      await moveTo.click();
      const onPlayer = page.getByRole('button', { name: 'On the player', exact: true });
      await expect(onPlayer).toBeVisible();
      await expectInsideViewport(
        page,
        page.locator('ul.dropdown-content').filter({ has: onPlayer }),
      );
      await onPlayer.click();
      await expect(carried.getByText(target, { exact: true })).toBeVisible();
      await expect(stashed.getByText(target, { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );

      // Pressing outside the inventory panel clears the selection.
      await expect(selected).toBeVisible();
      await page.getByRole('complementary', { name: 'Current Status' }).click({
        position: { x: 2, y: 2 },
      });
      await expect(selected).toBeHidden();
    });
  }

  await test.step('group by type', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await carried
      .getByRole('columnheader')
      .filter({ has: page.getByRole('button', { name: 'Sort by Item' }) })
      .click({ button: 'right' });
    const menu = page.getByRole('dialog', { name: 'Filter Item type' });
    await expect(menu).toBeVisible();
    await expectInsideViewport(page, menu);
    const grouping = menu.getByRole('switch', { name: 'Group by type' });
    await grouping.check();
    await attachReviewScreenshot(page, testInfo, 'inventory-group-by-type-menu', {
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await expect(carried.getByRole('rowheader')).toHaveText([
      'Armor',
      'Container',
      'Weapon',
      'Other',
    ]);
    const dagger = carried.getByRole('row').filter({ hasText: 'Belt dagger' });
    await expect(dagger.getByText('in Backpack')).toBeVisible();
    await expect(stashed.getByRole('rowheader')).toHaveCount(0);
    await attachReviewScreenshot(page, testInfo, 'inventory-group-by-type-1280', {
      animations: 'disabled',
    });

    await dagger.getByText('Belt dagger', { exact: true }).click();
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
    await carried.getByRole('button', { name: 'Collapse Weapon' }).click();
    await expect(dagger).toBeHidden();
    await expect(carried.getByLabel('1 item', { exact: true })).toBeVisible();
    await expect(page.getByText('1 selected', { exact: true })).toBeHidden();

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      const header = carried.getByRole('rowheader', { name: /Armor/ });
      await expect(header).toBeVisible();
      await expectInsideViewport(page, header.getByRole('button', { name: 'Collapse Armor' }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      await attachReviewScreenshot(page, testInfo, `inventory-group-by-type-${viewport.width}`, {
        animations: 'disabled',
      });
    }
  });
});
