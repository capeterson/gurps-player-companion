import { type Page, expect } from '@playwright/test';

/** The header menu that is on screen: the compact character hamburger below
 *  1280px on a character page, otherwise the account menu. */
export function visibleHeaderMenuTrigger(page: Page) {
  return page
    .locator(
      'header.app-header summary[aria-label^="Open navigation for"], header.app-header summary[aria-label="Open user menu"]',
    )
    .filter({ visible: true })
    .first();
}

/** Switch light/dark through the header menu item, then close the menu. */
export async function switchThemeFromMenu(page: Page, target?: 'Light' | 'Dark') {
  const trigger = visibleHeaderMenuTrigger(page);
  await trigger.click();
  const item = page
    .getByRole('button', {
      name: target ? `Switch to ${target} mode` : /^Switch to (Dark|Light) mode$/,
      exact: !!target,
    })
    .filter({ visible: true });
  await expect(item).toBeVisible();
  await item.click();
  await page.keyboard.press('Escape');
}

/** Ensure the page uses the named palette (light = sunbolt, dark = gilded-tome). */
export async function ensureThemeMode(page: Page, mode: 'Light' | 'Dark') {
  const wanted = mode === 'Light' ? 'sunbolt' : 'gilded-tome';
  if ((await page.locator('html').getAttribute('data-theme')) !== wanted) {
    await switchThemeFromMenu(page, mode);
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', wanted);
}
