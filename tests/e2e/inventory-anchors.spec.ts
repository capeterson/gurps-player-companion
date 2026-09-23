import { expect, test } from '@playwright/test';
import { expectCharacterNavigationReady, selectCharacterSection } from './character-navigation';

test.use({ serviceWorkers: 'block' });

test('a combat weapon link reveals nested inventory and survives reload', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`anchors-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Anchor player');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Anchor character');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expectCharacterNavigationReady(page);
  await selectCharacterSection(page, 'Inventory');
  const path = new URL(page.url()).pathname;
  const addForm = page.getByLabel('Item name').locator('xpath=ancestor::form');

  await page.getByLabel('Item name').fill('Deep Pack');
  await addForm.getByRole('button', { name: 'More options' }).click();
  await addForm.getByRole('button', { name: '+ Container', exact: true }).click();
  await addForm.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByText('Deep Pack', { exact: true })).toBeVisible();

  await page.getByLabel('Item name').fill('Deep Pouch');
  await addForm.getByLabel('Parent container').selectOption({ label: 'in Deep Pack' });
  await addForm.getByRole('button', { name: 'More options' }).click();
  await addForm.getByRole('button', { name: '+ Container', exact: true }).click();
  await addForm.getByRole('button', { name: /^add$/i }).click();
  await expect(addForm.getByRole('option', { name: 'in Deep Pouch' })).toBeAttached();

  await page.getByLabel('Item name').fill('Deep Sword');
  await addForm.getByLabel('Parent container').selectOption({ label: 'in Deep Pouch' });
  await addForm.getByRole('button', { name: 'More options' }).click();
  await addForm.getByRole('button', { name: '+ Weapon', exact: true }).click();
  await addForm.getByLabel('Equipped').check();
  await addForm.getByRole('button', { name: /^add$/i }).click();

  const packRow = page.getByText('Deep Pack', { exact: true }).locator('xpath=ancestor::tr');
  await packRow.getByRole('button', { name: 'Expand contents' }).click();
  const pouchRow = page.getByText('Deep Pouch', { exact: true }).locator('xpath=ancestor::tr');
  await pouchRow.getByRole('button', { name: 'Expand contents' }).click();
  const inventorySword = page
    .getByText('Deep Sword', { exact: true })
    .locator('xpath=ancestor::tr');
  await expect(inventorySword).toBeVisible();
  const swordAnchor = await inventorySword.getAttribute('id');
  expect(swordAnchor).toMatch(/^inventory-[a-f0-9-]+$/);
  await pouchRow.getByRole('button', { name: 'Collapse contents' }).click();
  await packRow.getByRole('button', { name: 'Collapse contents' }).click();

  await selectCharacterSection(page, 'Combat');
  await expect(page.getByRole('link', { name: 'Deep Sword' })).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { __anchorPage?: boolean }).__anchorPage = true;
  });
  await page.getByRole('link', { name: 'Deep Sword' }).click();
  await expect(page).toHaveURL(new RegExp(`${path}#${swordAnchor}$`));
  await expect(page.locator('.sheet-section-heading')).toHaveText('Inventory');
  const swordRow = page.locator(`#${swordAnchor}`);
  await expect(swordRow).toBeVisible();
  await expect(swordRow).toBeInViewport();
  expect(await swordRow.evaluate((element) => getComputedStyle(element).outlineWidth)).not.toBe(
    '0px',
  );
  expect(
    await page.evaluate(() => (window as Window & { __anchorPage?: boolean }).__anchorPage),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/inventory-anchor-visible.png' });

  await page.reload();
  await expect(swordRow).toBeVisible();
  await expect(swordRow).toBeInViewport();
  expect(await swordRow.evaluate((element) => getComputedStyle(element).outlineWidth)).not.toBe(
    '0px',
  );
});
