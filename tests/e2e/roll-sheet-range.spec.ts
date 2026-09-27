import { type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';

async function create(page: Page, path: string, data: object) {
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.post(`/api/v1${path}`, {
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('ranged attack sheet combines Aim, bounded range, body map and a reachable Roll action', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`roll-range-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Roll sheet player');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 15_000 });

  const character = await create(page, '/characters', { name: 'Range tester', dx: 12 });
  await create(page, `/characters/${character.id}/skills`, {
    name: 'Pistol',
    attribute: 'DX',
    difficulty: 'E',
    points: 12,
  });
  await create(page, `/characters/${character.id}/inventory`, {
    name: 'Target pistol',
    equipped: true,
    weaponData: {
      skill: 'Pistol',
      damage: '2d pi',
      ranged: {
        acc: 3,
        range: { kind: 'fixed', halfDamageYards: 100, maxYards: 150 },
        rof: '1',
        shots: '9+1(3)',
        bulk: -4,
        recoil: 2,
      },
    },
  });
  await page.goto(`/characters/${character.id}`);
  await selectCharacterSection(page, 'Combat');

  for (const width of [320, 519, 520, 521, 574, 575, 576, 767, 768, 769]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: /Pistol \d+/ }).click();
    const sheet = page.getByRole('dialog', { name: /Roll Pistol/ });
    await expect(sheet.getByText('Max 150 yd')).toBeVisible();
    const slider = sheet.getByRole('slider', { name: 'Range band' });
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute('aria-valuetext', /yards, .*range penalty/);
    await sheet.getByLabel('Distance').fill('30');
    await sheet.getByRole('button', { name: '3+ sec' }).click();
    if (width === 575) {
      await expect(sheet.getByRole('button', { name: '3+ sec' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.waitForTimeout(250);
      await page.screenshot({ path: '/tmp/gpc-roll-sheet-compact-575.png' });
    }
    await sheet.getByRole('button', { name: /Choose on map/ }).click();
    if (width <= 520) {
      const callouts = sheet.locator('.roll-hit-map .armor-callout');
      await expect(callouts).toHaveCount(15);
      const boxes = await callouts.evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }),
      );
      for (let i = 0; i < boxes.length; i += 1)
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          if (!a || !b) continue;
          expect(
            a.x < b.x + b.width &&
              b.x < a.x + a.width &&
              a.y < b.y + b.height &&
              b.y < a.y + a.height,
          ).toBe(false);
        }
    }
    if (width === 320) {
      await sheet.locator('.roll-hit-map').scrollIntoViewIfNeeded();
      await page.screenshot({ path: '/tmp/gpc-roll-sheet-map-320.png' });
    }
    const skull = sheet.getByRole('button', { name: 'Skull -7' }).last();
    await skull.click();
    const roll = sheet.getByRole('button', { name: /Roll vs \d+/ });
    await expect(roll).toBeVisible();
    const [sheetBox, rollBox] = await Promise.all([sheet.boundingBox(), roll.boundingBox()]);
    expect(sheetBox).not.toBeNull();
    expect(rollBox).not.toBeNull();
    if (sheetBox && rollBox) {
      expect(sheetBox.x).toBeGreaterThanOrEqual(0);
      expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(width);
      expect(sheetBox.y).toBeGreaterThanOrEqual(0);
      expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(900);
      expect(rollBox.y).toBeGreaterThanOrEqual(sheetBox.y);
      expect(rollBox.y + rollBox.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height);
    }
    await sheet.getByLabel('Distance').fill('151');
    await expect(roll).toBeDisabled();
    if (width === 575) {
      await sheet.getByLabel('Distance').fill('30');
      await sheet.getByRole('button', { name: /Choose on map/ }).click();
      await sheet.getByRole('group', { name: 'Choose hit location' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: '/tmp/gpc-roll-sheet-range-575.png' });
    }
    await sheet.getByRole('button', { name: 'Close' }).last().click();
  }

  await page.evaluate(() => localStorage.setItem('gpc.theme', 'dark'));
  await page.setViewportSize({ width: 575, height: 900 });
  await page.reload();
  await selectCharacterSection(page, 'Combat');
  await page.getByRole('button', { name: /Pistol \d+/ }).click();
  const darkSheet = page.getByRole('dialog', { name: 'Roll Pistol' });
  await darkSheet.getByLabel('Distance').fill('30');
  await darkSheet.getByRole('button', { name: '3+ sec' }).click();
  await expect(darkSheet.getByRole('button', { name: '3+ sec' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/gpc-roll-sheet-compact-dark-575.png' });
  await darkSheet.getByRole('button', { name: /Choose on map/ }).click();
  await darkSheet.getByRole('group', { name: 'Choose hit location' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const darkRoll = darkSheet.getByRole('button', { name: /Roll vs \d+/ });
  await expect(darkRoll).toBeVisible();
  const darkRollBox = await darkRoll.boundingBox();
  expect(darkRollBox).not.toBeNull();
  if (darkRollBox) expect(darkRollBox.y + darkRollBox.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: '/tmp/gpc-roll-sheet-expanded-dark-575.png' });
  await darkSheet.getByRole('button', { name: 'Close' }).last().click();

  const longSkill = 'Pistol with an exceptionally long precision training specialization';
  await create(page, `/characters/${character.id}/skills`, {
    name: longSkill,
    attribute: 'DX',
    difficulty: 'E',
    points: 4,
  });
  await create(page, `/characters/${character.id}/inventory`, {
    name: 'Second target pistol',
    equipped: true,
    weaponData: {
      skill: longSkill,
      damage: '2d pi',
      ranged: { acc: 2, range: { kind: 'fixed', halfDamageYards: 40, maxYards: 80 } },
    },
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/characters/${character.id}`);
  await selectCharacterSection(page, 'Combat');
  await page.getByRole('button', { name: new RegExp(longSkill) }).click();
  const longSheet = page.getByRole('dialog', { name: `Roll ${longSkill}` });
  await expect(longSheet.getByText('Max 80 yd')).toBeVisible();
  const longBox = await longSheet.boundingBox();
  expect(longBox).not.toBeNull();
  if (longBox) {
    expect(longBox.x).toBeGreaterThanOrEqual(0);
    expect(longBox.x + longBox.width).toBeLessThanOrEqual(320);
    expect(longBox.y).toBeGreaterThanOrEqual(0);
    expect(longBox.y + longBox.height).toBeLessThanOrEqual(900);
  }
});
