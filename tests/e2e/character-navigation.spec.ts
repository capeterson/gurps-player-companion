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
    const subpixelTolerance = 1;
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
      await expect(buttons.first()).toHaveAttribute('aria-label', 'Overview');
      await expect(buttons.nth(1)).toHaveAttribute('aria-label', 'Combat');
      for (const section of CHARACTER_SECTIONS) {
        const button = dock.getByRole('button', { name: section, exact: true });
        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute('aria-label', section);
        await expect(button.locator('.dock-label')).toBeVisible();
        if (['Traits', 'Skills', 'Magic', 'Inventory'].includes(section)) {
          await expect(button.locator('.sheet-nav-count')).toBeVisible();
        }
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
        const petal = button.locator('..');
        const label = petal.locator('.sheet-petal-label');
        await expect(label).toBeVisible();
        await expect(label).toContainText(section);
        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute('aria-label', section);
        if (['Traits', 'Skills', 'Magic', 'Inventory'].includes(section)) {
          await expect(petal.locator('.sheet-petal-count')).toBeVisible();
        }
        await expect(flower.locator('[role="tooltip"]')).toHaveCount(0);
        const labelBox = await label.boundingBox();
        expect(labelBox, `${section} label has no layout box at ${width}px`).not.toBeNull();
        if (labelBox) {
          expect(labelBox.x).toBeGreaterThanOrEqual(0);
          expect(labelBox.y).toBeGreaterThanOrEqual(0);
          expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(width);
          expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(height);
        }
        const groupBox = await petal.boundingBox();
        expect(groupBox, `${section} group has no layout box at ${width}px`).not.toBeNull();
        if (groupBox) {
          expect(groupBox.x).toBeGreaterThanOrEqual(0);
          expect(groupBox.y).toBeGreaterThanOrEqual(0);
          expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(width);
          expect(groupBox.y + groupBox.height).toBeLessThanOrEqual(height);
          boxes.push({
            x: groupBox.x,
            y: groupBox.y,
            right: groupBox.x + groupBox.width,
            bottom: groupBox.y + groupBox.height,
          });
          if (labelBox) {
            expect(labelBox.x).toBeGreaterThanOrEqual(groupBox.x - subpixelTolerance);
            expect(labelBox.y).toBeGreaterThanOrEqual(groupBox.y - subpixelTolerance);
            expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(
              groupBox.x + groupBox.width + subpixelTolerance,
            );
            expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(
              groupBox.y + groupBox.height + subpixelTolerance,
            );
          }
          const count = petal.locator('.sheet-petal-count');
          if (await count.count()) {
            await expect(count).toBeVisible();
            const countBox = await count.boundingBox();
            expect(countBox, `${section} count has no layout box at ${width}px`).not.toBeNull();
            if (countBox) {
              expect(countBox.x).toBeGreaterThanOrEqual(0);
              expect(countBox.y).toBeGreaterThanOrEqual(0);
              expect(countBox.x + countBox.width).toBeLessThanOrEqual(width);
              expect(countBox.y + countBox.height).toBeLessThanOrEqual(height);
            }
          }
        }
        const box = await button.boundingBox();
        expect(box, `${section} petal has no layout box at ${width}px`).not.toBeNull();
        if (!box) continue;
        expect(box.width, `${section} target is too narrow`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${section} target is too short`).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(height);
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
      await expect(flower.locator('[role="tooltip"]')).toHaveCount(0);
      const overview = flower.getByRole('button', { name: 'Overview', exact: true });
      await overview.focus();
      await expect(flower.locator('[role="tooltip"]')).toHaveCount(0);

      await flower
        .getByRole('button', { name: 'Skills', exact: true })
        .locator('..')
        .locator('.sheet-petal-label')
        .click();
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
