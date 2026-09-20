import { expect, test } from '@playwright/test';
import {
  CHARACTER_SECTIONS,
  expectCharacterNavigationReady,
  selectCharacterSection,
} from './character-navigation';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

test('character navigation adapts across mobile and desktop widths', async ({ page }) => {
  test.setTimeout(90_000);
  const widths = [320, 390, 767, 768, 769, 1280];

  // Register once and reuse this page and account for every responsive state.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`e2e-sheet-nav-${suffix()}@example.com`);
  await page.getByLabel(/display name/i).fill('Sheet Navigation QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 15_000 });
  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Navigation Test Character');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 10_000 });
  await expectCharacterNavigationReady(page);

  for (const width of widths) {
    const height = width < 768 ? 568 : 900;
    await page.setViewportSize({ width, height });
    await expectCharacterNavigationReady(page);

    const dock = page.locator('.sheet-dock');
    const flower = page.locator('.sheet-flower');
    const open = page.getByRole('button', { name: 'Open character navigation', exact: true });

    if (width >= 768) {
      await expect(dock).toBeVisible();
      await expect(flower).toBeHidden();
      await expect(open).toHaveCount(0);

      const buttons = dock.getByRole('button');
      await expect(buttons).toHaveCount(CHARACTER_SECTIONS.length);
      for (const section of CHARACTER_SECTIONS) {
        const button = dock.getByRole('button', { name: section, exact: true });
        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute('aria-label', section);
      }

      await selectCharacterSection(page, 'Combat');
      await expect(dock.getByRole('button', { name: 'Combat', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByRole('heading', { name: 'Combat', exact: true })).toBeVisible();

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(dock).toBeVisible();
    } else {
      await expect(dock).toBeHidden();
      await expect(flower).toBeVisible();
      await expect(open).toBeVisible();
      await expect(flower.locator('.sheet-petals')).toBeHidden();

      await open.click();
      await expect(flower.locator('.sheet-petals')).toBeVisible();
      const petals = flower.locator('.sheet-petals button');
      await expect(petals).toHaveCount(CHARACTER_SECTIONS.length);

      const boxes = [] as { x: number; y: number; right: number; bottom: number }[];
      for (const section of CHARACTER_SECTIONS) {
        const button = flower.getByRole('button', { name: section, exact: true });
        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute('aria-label', section);
        const box = await button.boundingBox();
        expect(box, `${section} petal has no layout box at ${width}px`).not.toBeNull();
        if (!box) continue;
        expect(box.width, `${section} target is too narrow`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${section} target is too short`).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(height);
        boxes.push({ x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height });
      }
      const hub = await flower.locator('.sheet-nav-toggle').boundingBox();
      expect(hub, `navigation hub has no layout box at ${width}px`).not.toBeNull();
      if (hub) {
        expect(hub.width).toBeGreaterThanOrEqual(44);
        expect(hub.height).toBeGreaterThanOrEqual(44);
        expect(hub.x).toBeGreaterThanOrEqual(0);
        expect(hub.y).toBeGreaterThanOrEqual(0);
        expect(hub.x + hub.width).toBeLessThanOrEqual(width);
        expect(hub.y + hub.height).toBeLessThanOrEqual(height);
        boxes.push({ x: hub.x, y: hub.y, right: hub.x + hub.width, bottom: hub.y + hub.height });
      }
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
        }
      }

      const combat = flower.getByRole('button', { name: 'Combat', exact: true });
      await combat.hover();
      await expect(flower.getByRole('tooltip', { name: /^Combat/ })).toBeVisible();
      const identity = flower.getByRole('button', { name: 'Identity', exact: true });
      await identity.focus();
      await expect(flower.getByRole('tooltip', { name: /^Identity/ })).toBeVisible();

      await flower.getByRole('button', { name: 'Skills', exact: true }).click();
      await expect(open).toBeVisible();
      await expect(flower.locator('.sheet-petals')).toBeHidden();
      await expect(
        page.locator('.sheet-section-heading').filter({ hasText: 'Skills' }),
      ).toBeFocused();

      await open.click();
      await page.keyboard.press('Escape');
      await expect(flower.locator('.sheet-petals')).toBeHidden();
      await expect(open).toBeFocused();

      await open.click();
      await page.mouse.click(8, 8);
      await expect(flower.locator('.sheet-petals')).toBeHidden();
    }
  }

  // The accessible navigation remains usable with either application theme.
  await page.getByRole('button', { name: /switch to (dark|light) mode/i }).click();
  await expectCharacterNavigationReady(page);
  await page.getByRole('button', { name: /switch to (dark|light) mode/i }).click();
  await expectCharacterNavigationReady(page);
});
