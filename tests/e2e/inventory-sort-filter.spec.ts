import { type Locator, type Page, expect, test } from '@playwright/test';
import {
  expectCharacterNavigationReady,
  openAddItem,
  selectCharacterSection,
} from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

test.use({ serviceWorkers: 'block' });

const WIDTHS = [320, 639, 640, 641, 1280] as const;

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

async function addItem(page: Page, name: string, quantity: string, cost: string) {
  const dialog = await openAddItem(page);
  await dialog.getByLabel('Item name').fill(name);
  await dialog.getByLabel('Quantity').fill(quantity);
  await dialog.getByLabel('Weight (lbs)').fill('1');
  await dialog.getByLabel('Cost').fill(cost);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

test('inventory sorts by heading and filters ranges inside the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`inventory-sort-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Inventory sorter');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Inventory sorter');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expectCharacterNavigationReady(page);
  await selectCharacterSection(page, 'Inventory');

  // The section is not folded behind a disclosure.
  await expect(page.getByRole('button', { name: /collapse inventory/i })).toHaveCount(0);

  await addItem(page, 'Broadsword', '1', '500');
  await addItem(page, 'Crossbow bolts', '20', '2');
  await addItem(page, 'Rations', '6', '2');

  const carried = page.getByRole('table', { name: 'Carried inventory', exact: true });
  const titles = carried.locator('.inventory-item-title');
  await expect(titles).toHaveText(['Broadsword', 'Crossbow bolts', 'Rations']);

  // One row: selection actions sit beside search and Add item.
  await titles.first().click();
  await expect(page.getByText('1 selected')).toBeVisible();
  const addButton = page.getByRole('button', { name: 'Add item', exact: true });
  const selected = page.getByText('1 selected');
  const addBox = await addButton.boundingBox();
  const selectedBox = await selected.boundingBox();
  expect(addBox && selectedBox && Math.abs(addBox.y - selectedBox.y)).toBeLessThan(24);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  for (const width of WIDTHS) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 800 });
      const sortByCost = carried.getByRole('button', { name: 'Sort by Cost' });
      await expect(sortByCost).toBeVisible();
      await sortByCost.click();
      const costHeading = carried.getByRole('columnheader').filter({
        has: page.getByRole('button', { name: 'Sort by Cost' }),
      });
      const direction = await costHeading.getAttribute('aria-sort');
      // Price × quantity: Rations 12, bolts 40, sword 500.
      await expect(titles).toHaveText(
        direction === 'ascending'
          ? ['Rations', 'Crossbow bolts', 'Broadsword']
          : ['Broadsword', 'Crossbow bolts', 'Rations'],
      );

      await carried
        .getByRole('columnheader')
        .filter({ has: page.getByRole('button', { name: 'Sort by Qty' }) })
        .click({ button: 'right' });
      const menu = page.getByRole('dialog', { name: 'Filter Qty' });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('slider', { name: 'Maximum Qty' })).toHaveAttribute('max', '20');
      await expectInsideViewport(page, menu);
      await menu.getByRole('spinbutton', { name: 'Maximum Qty value' }).fill('6');
      await menu.getByRole('spinbutton', { name: 'Maximum Qty value' }).press('Enter');
      await expect(carried.getByText('Rations', { exact: true })).toBeVisible();
      await expect(carried.getByText('Broadsword', { exact: true })).toBeVisible();
      await expect(carried.getByText('Crossbow bolts', { exact: true })).toBeHidden();
      await attachReviewScreenshot(page, testInfo, `inventory-range-filter-${width}`, {
        animations: 'disabled',
      });
      await menu.getByRole('button', { name: 'Clear column filter' }).click();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();

      const dialog = await openAddItem(page);
      await expectInsideViewport(page, dialog.locator('.modal-box'));
      await attachReviewScreenshot(page, testInfo, `inventory-add-item-${width}`, {
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }
});
