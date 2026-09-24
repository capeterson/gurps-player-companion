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
