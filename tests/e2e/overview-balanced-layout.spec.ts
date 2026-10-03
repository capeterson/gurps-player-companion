import { type Locator, type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('Visible element has no bounds');
  return bounds;
}

function card(page: Page, title: string) {
  return page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::section[1]');
}

test('Overview stat cards align without gaps and utilities retain their natural height', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('rowan@example.invalid');
  await page.getByLabel(/^password\b/i).fill('change-me-please-this-is-a-seed-account');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const headers = { Authorization: `Bearer ${token}` };
  const response = await page.request.post('/api/v1/characters', {
    headers,
    data: { name: 'Balanced Overview Surveyor' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const character = await response.json();
  const widths = [320, 639, 640, 641, 767, 768, 769, 1023, 1024, 1025, 1212, 1279, 1280, 1281, 1440];
  try {
    for (const state of [
      { name: 'base', data: { st: 15, dx: 17, iq: 14, ht: 15 } },
      {
        name: 'modified',
        data: { st: 15, dx: 17, iq: 14, ht: 15, willMod: 2, perMod: 1, moveMod: 1 },
      },
      {
        name: 'large-values',
        data: {
          st: 99,
          dx: 99,
          iq: 99,
          ht: 99,
          hpMod: 50,
          willMod: 50,
          perMod: 50,
          fpMod: 50,
          speedQuarterMod: 50,
          moveMod: 50,
          tempEffects: [{ id: 'manual', name: 'Manual adjustments', mods: { st: 50, will: 50 } }],
        },
      },
    ]) {
      const patch = await page.request.patch(`/api/v1/characters/${character.id}`, {
        headers,
        data: state.data,
      });
      expect(patch.ok(), await patch.text()).toBeTruthy();
      await page.goto(`/characters/${character.id}`);
      await selectCharacterSection(page, 'Overview');
      await expect(page.getByRole('textbox', { name: 'ST base', exact: true })).toHaveValue(
        String(state.data.st),
      );
      if (state.name === 'modified') {
        await expect(page.locator('#attribute-Will')).toContainText('16');
        await expect(page.locator('#attribute-Per')).toContainText('15');
        await expect(page.locator('#attribute-Move')).toContainText('9');
      }
      for (const theme of ['gilded-tome', 'illuminated-manuscript']) {
        await page.evaluate((name) => document.documentElement.setAttribute('data-theme', name), theme);
        for (const width of widths) {
          await page.setViewportSize({ width, height: width === 1212 ? 880 : 900 });
          const primary = card(page, 'Attributes');
          const secondary = card(page, 'Secondary attributes');
          const status = card(page, 'Status');
          const [a, b, s] = await Promise.all([box(primary), box(secondary), box(status)]);
          for (const bounds of [a, b, s]) {
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
          }
          if (width >= 768) {
            expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
            expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
            expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
            expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
            expect(Math.abs(s.x - a.x)).toBeLessThanOrEqual(1);
            expect(s.y - (a.y + a.height)).toBeCloseTo(16, 0);
            const ledger = await box(page.getByRole('button', { name: /^Point ledger/ }));
            expect(Math.abs(ledger.y - s.y)).toBeLessThanOrEqual(1);
          } else {
            expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
            expect(s.y).toBeGreaterThanOrEqual(b.y + b.height);
          }
          if (width >= 1024) {
            const [hp, will, per, fp, speed, move] = await Promise.all([
              box(page.locator('#attribute-HP')),
              box(page.locator('#attribute-Will')),
              box(page.locator('#attribute-Per')),
              box(page.locator('#attribute-FP')),
              box(page.locator('#attribute-Speed')),
              box(page.locator('#attribute-Move')),
            ]);
            expect(Math.abs(hp.y - will.y)).toBeLessThanOrEqual(1);
            expect(Math.abs(hp.y - per.y)).toBeLessThanOrEqual(1);
            expect(Math.abs(fp.y - speed.y)).toBeLessThanOrEqual(1);
            expect(Math.abs(fp.y - move.y)).toBeLessThanOrEqual(1);
            expect(fp.y).toBeGreaterThan(hp.y);
          }
          for (const name of ['Point ledger', 'Encumbrance']) {
            const trigger = page.getByRole('button', { name: new RegExp(`^${name}`) });
            await expect(trigger).toBeVisible();
            if ((await trigger.getAttribute('aria-expanded')) === 'true') await trigger.click();
            const fold = trigger.locator('xpath=ancestor::section[1]');
            const [panel, heading] = await Promise.all([box(fold), box(trigger)]);
            expect(panel.height - heading.height).toBeLessThanOrEqual(2);
          }
          for (const [parent, names] of [
            [primary, ['ST', 'DX', 'IQ', 'HT']],
            [secondary, ['HP', 'Will', 'Per', 'FP', 'Speed', 'Move']],
          ] as const) {
            const parentBox = await box(parent);
            for (const name of names) {
              const cell = page.locator(`#attribute-${name}`);
              const cellBox = await box(cell);
              for (const control of await cell
                .locator('input, button[aria-label^="Edit "], .num')
                .all()) {
                const controlBox = await box(control);
                expect(controlBox.x).toBeGreaterThanOrEqual(cellBox.x - 1);
                expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(
                  cellBox.x + cellBox.width + 1,
                );
                expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(
                  parentBox.y + parentBox.height + 1,
                );
              }
            }
          }
          const encumbrance = page.getByRole('button', { name: /^Encumbrance$/ });
          await encumbrance.click();
          await expect(page.getByText('Carrying', { exact: true })).toBeVisible();
          if (state.name === 'modified' && [320, 1212, 1440].includes(width)) {
            await attachReviewScreenshot(page, testInfo, `overview-${theme}-${width}`, {
              fullPage: true,
            });
          }
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
            .toBeLessThanOrEqual(width);
        }
      }
    }
  } finally {
    const deletion = await page.request.delete(`/api/v1/characters/${character.id}`, { headers });
    expect(deletion.ok(), await deletion.text()).toBeTruthy();
  }
});
