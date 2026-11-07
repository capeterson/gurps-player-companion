import { type Locator, type Page, expect } from '@playwright/test';
import { test } from './authenticated-fixture';
import { selectCharacterSection } from './character-navigation';
import { reviewArtifactsEnabled } from './review-artifacts';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });

const SHOT_DIR = process.env.DWA_SHOT_DIR;
const LONG_WEAPON = `Ceremonial ${'Longname'.repeat(8)} Dueling Blade`;

// One account and page are reused for every width and state in this scenario.
const widths = [
  { width: 390, height: 844 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 800 },
];

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found as Box;
}

function inside(inner: Box, outer: Box, tolerance = 1) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - tolerance);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - tolerance);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + tolerance);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + tolerance);
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function targetOf(button: Locator) {
  const text = (await button.innerText()).replace(/\s+/g, ' ').trim();
  const match = /(-?\d+)\s*$/.exec(text);
  expect(match, `target number in "${text}"`).not.toBeNull();
  return Number(match?.[1]);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function settleAnimations(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}

test('Dual-Weapon Attack picks, penalties and overlays stay inside the viewport', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const headers = { Authorization: `Bearer ${token}` };
  async function post<T = { id: string }>(path: string, data: object) {
    const response = await page.request.post(`/api/v1${path}`, { data, headers });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as T;
  }

  const character = await post('/characters', {
    name: `Dual-weapon QA ${Date.now()}`,
    st: 11,
    dx: 12,
    iq: 10,
    ht: 11,
  });
  for (const name of ['Shortsword', 'Rapier', 'Main-Gauche']) {
    await post(`/characters/${character.id}/skills`, {
      name,
      attribute: 'DX',
      difficulty: 'A',
      points: 4,
    });
  }
  const inventory = `/characters/${character.id}/inventory`;
  await post(inventory, {
    name: 'Shortsword',
    worn: true,
    equipped: true,
    weaponData: { damage: 'sw cut', skill: 'Shortsword', reach: '1' },
  });
  await post(inventory, {
    name: 'Rapier',
    worn: true,
    equipped: true,
    enchantments: [
      {
        spellName: 'Flaming Weapon',
        spellLevel: 15,
        mechanics: {
          applicability: 'weapon',
          effects: [{ target: 'weapon_damage', value: 2, damageType: 'fire' }],
          levels: [],
          stackingPolicy: { kind: 'stack' },
        },
      },
    ],
    weaponData: {
      skill: 'Rapier',
      reach: '1,2',
      modes: [
        { key: 'thrust', name: 'Thrust', skill: 'Rapier', damage: 'thr+1 imp', reach: '1,2' },
        { key: 'swing', name: 'Swing', skill: 'Rapier', damage: 'sw cut', reach: '1,2' },
      ],
    },
  });
  await post(inventory, {
    name: LONG_WEAPON,
    worn: true,
    equipped: true,
    weaponData: { damage: 'thr imp', skill: 'Main-Gauche', reach: 'C,1' },
  });

  await page.goto(`/characters/${character.id}`);
  await selectCharacterSection(page, 'Combat');
  const attacks = page.getByRole('table', { name: 'Attacks' });
  await expect(attacks).toBeVisible({ timeout: 20_000 });
  const toggle = page.getByRole('button', { name: 'Dual-Weapon Attack', exact: true });
  const shortswordBox = () => attacks.getByRole('rowgroup', { name: 'Shortsword', exact: true });
  const rapierGroup = () => attacks.getByRole('rowgroup', { name: 'Rapier', exact: true });
  const longGroup = () => attacks.getByRole('rowgroup', { name: LONG_WEAPON, exact: true });

  // The enchantment's bonus is listed under the damage chip with its own type.
  await expect(attacks.getByRole('list', { name: 'Extra damage: Rapier, Thrust' })).toContainText(
    /\+2\s+fire\s+Flaming Weapon/,
  );

  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const swordTarget = shortswordBox().getByRole('button', { name: /^Shortsword\b/ });
  const rapierThrust = rapierGroup().getByRole('button', { name: /^Rapier . Thrust\b/ });
  const base = {
    shortsword: await targetOf(swordTarget),
    rapier: await targetOf(rapierThrust),
  };

  for (const viewport of widths) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      // Start each width from a clean, inactive state.
      if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(swordTarget).toBeVisible();
      expect(await targetOf(swordTarget)).toBe(base.shortsword);

      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('Choose two attacks.', { exact: true })).toBeVisible();

      const swordCheck = page.getByRole('checkbox', {
        name: 'Dual-Weapon Attack with Shortsword',
      });
      const thrustCheck = page.getByRole('checkbox', {
        name: 'Dual-Weapon Attack with Rapier · Thrust',
      });
      const swingCheck = page.getByRole('checkbox', {
        name: 'Dual-Weapon Attack with Rapier · Swing',
      });
      const longCheck = page.getByRole('checkbox', {
        name: 'Dual-Weapon Attack with Main-Gauche',
      });
      for (const check of [swordCheck, thrustCheck, swingCheck, longCheck]) {
        await expect(check).toBeVisible();
        await expect(check).toBeEnabled();
      }

      await swordCheck.check();
      await expect(page.getByText('Choose one more attack.', { exact: true })).toBeVisible();
      await thrustCheck.check();
      // Same weapon: the other Rapier mode may not be chosen; a third weapon neither.
      await expect(swingCheck).toBeDisabled();
      await expect(longCheck).toBeDisabled();
      await expect(
        page.getByText(
          'Shortsword and Rapier Thrust: -4 each; the foe defends at -1. Clear one to choose another.',
          { exact: true },
        ),
      ).toBeVisible();
      // No Ambidexterity: the off-hand question appears; the off-hand line loses a further 4.
      await expect(page.getByText('Which attack uses your off hand?')).toBeVisible();
      const offHand = page.getByRole('radiogroup');
      await expect(offHand).toBeVisible();
      await offHand.getByRole('radio', { name: 'Shortsword' }).click();

      expect(await targetOf(swordTarget)).toBe(base.shortsword - 8);
      expect(await targetOf(rapierThrust)).toBe(base.rapier - 4);
      await noHorizontalScroll(page);

      // The table fits its own scroll wrapper, so no header or cell is clipped, and the
      // enchantment bonus reads '+2 fire' with its source on one line or the next.
      const wrapperOverflow = await attacks.evaluate((table) => {
        const wrapper = table.parentElement as HTMLElement;
        return wrapper.scrollWidth - wrapper.clientWidth;
      });
      expect(wrapperOverflow, `attacks wrapper overflow at ${viewport.width}`).toBeLessThanOrEqual(
        0,
      );
      await expect(
        attacks.getByRole('list', { name: 'Extra damage: Rapier, Thrust' }),
      ).toContainText(/\+2\s+fire\s+Flaming Weapon/);

      // Row geometry: every control sits inside its row without overlapping.
      for (const [group, check, targetButton] of [
        [shortswordBox(), swordCheck, swordTarget],
        [rapierGroup(), thrustCheck, rapierThrust],
      ] as const) {
        const row = await box(group.getByRole('row').filter({ has: check }).first());
        const parts: Box[] = [await box(check), await box(targetButton)];
        const damage = group
          .getByRole('row')
          .filter({ has: check })
          .first()
          .getByRole('button', { name: / (cut|imp)$/ })
          .first();
        parts.push(await box(damage));
        const star = group.getByRole('button', { name: /^Modifiers: / }).first();
        await expect(star).toBeVisible();
        parts.push(await box(star));
        for (const part of parts) inside(part, row);
        for (let i = 0; i < parts.length; i += 1)
          for (let j = i + 1; j < parts.length; j += 1)
            expect(
              overlaps(parts[i] as Box, parts[j] as Box),
              `parts ${i} and ${j} overlap at ${viewport.width}`,
            ).toBe(false);
      }

      // The long weapon name stays inside the page, wraps, and does not push its row wide.
      const longName = longGroup().getByRole('link', { name: LONG_WEAPON, exact: true });
      await longName.scrollIntoViewIfNeeded();
      const longBox = await box(longName);
      expect(longBox.x).toBeGreaterThanOrEqual(0);
      expect(longBox.x + longBox.width).toBeLessThanOrEqual(viewport.width + 1);
      await noHorizontalScroll(page);

      // The ✦ tooltip on a picked row states the foe's penalty and stays on screen.
      const star = shortswordBox().getByRole('button', { name: 'Modifiers: Shortsword' });
      await star.scrollIntoViewIfNeeded();
      await star.click();
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText('Foe defends at -1 (MA83)');
      await expect(tooltip).toContainText('-4 Dual-Weapon Attack (MA83)');
      await expect(tooltip).toContainText('-4 Off hand');
      await settleAnimations(page);
      const tipBox = await box(tooltip);
      const view = page.viewportSize() as { width: number; height: number };
      inside(tipBox, { x: 0, y: 0, width: view.width, height: view.height }, 0.5);
      await page.keyboard.press('Escape');
      await expect(tooltip).toBeHidden();

      // Turning the mode off restores every target.
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(await targetOf(swordTarget)).toBe(base.shortsword);
      expect(await targetOf(rapierThrust)).toBe(base.rapier);
    });
  }

  if (reviewArtifactsEnabled && SHOT_DIR) {
    // Review screenshots of the open card with the mode active (light and dark).
    const themeNames = new Map<string, string>();
    for (const scheme of ['light', 'dark'] as const) {
      // The stored mode wins over the OS preference, so set it and reload.
      await page.evaluate((mode) => localStorage.setItem('gpc.theme', mode), scheme);
      await page.reload();
      await selectCharacterSection(page, 'Combat');
      await expect(attacks).toBeVisible({ timeout: 20_000 });
      const themeName = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
      themeNames.set(scheme, themeName);
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 640, height: 800 },
        { width: 1280, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await toggle.scrollIntoViewIfNeeded();
        if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
        await page.getByRole('checkbox', { name: 'Dual-Weapon Attack with Shortsword' }).check();
        await page
          .getByRole('checkbox', { name: 'Dual-Weapon Attack with Rapier · Thrust' })
          .check();
        await page.getByRole('radiogroup').getByRole('radio', { name: 'Shortsword' }).click();
        await attacks.scrollIntoViewIfNeeded();
        await settleAnimations(page);
        await page.screenshot({
          path: `${SHOT_DIR}/dwa-${viewport.width}-${scheme}.png`,
          fullPage: false,
        });
        await page.getByRole('checkbox', { name: 'Dual-Weapon Attack with Shortsword' }).uncheck();
        await toggle.click();
      }
    }
    expect(themeNames.get('light')).not.toBe(themeNames.get('dark'));
  }
});
