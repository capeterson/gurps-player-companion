import { type Page, expect } from '@playwright/test';

export const CHARACTER_SECTIONS = [
  'Overview',
  'Combat',
  'Traits',
  'Skills',
  'Magic',
  'Inventory',
  'History',
] as const;

/** Select a sheet section through its desktop dock or mobile FAB menu. */
export async function selectCharacterSection(page: Page, section: string) {
  await expectCharacterNavigationReady(page);
  // Both responsive variants intentionally share the same navigation label;
  // use the rendered variant to avoid selecting hidden mobile petals at a
  // narrow width.
  const desktopNavigation = page.locator('.sheet-dock');
  if (await desktopNavigation.isVisible().catch(() => false)) {
    await desktopNavigation.getByRole('button', { name: section, exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Open character navigation', exact: true }).click();
    await page.locator('.sheet-flower').getByRole('button', { name: section, exact: true }).click();
  }
}

/** Wait until either the desktop dock or mobile FAB is present and visible. */
export async function expectCharacterNavigationReady(page: Page) {
  await expect
    .poll(async () => {
      const desktop = await page
        .locator('.sheet-dock')
        .isVisible()
        .catch(() => false);
      if (desktop) return 'desktop';
      const mobile = await page
        .getByRole('button', { name: 'Open character navigation', exact: true })
        .isVisible()
        .catch(() => false);
      return mobile ? 'mobile' : 'missing';
    })
    .not.toBe('missing');
}

/** Assign a campaign through both the warning and final confirmation. */
export async function assignOverviewCampaign(page: Page, campaignName: string) {
  await page.getByRole('button', { name: 'Edit campaign', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Change character campaign?' });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Continue', exact: true }).click();

  const select = page.getByLabel('campaign', { exact: true });
  await expect(select).toBeVisible();
  await select.selectOption({ label: campaignName });
  const confirmation = page.getByRole('dialog', { name: 'Are you sure?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Change campaign', exact: true }).click();
  await expect(page.getByRole('link', { name: campaignName, exact: true })).toBeVisible();
}

/** Open the inventory Add item dialog unless it is already open. */
export async function openAddItem(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Add item' });
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
  }
  await expect(dialog).toBeVisible();
  return dialog;
}
