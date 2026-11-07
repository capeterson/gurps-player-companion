import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

const widths = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

const runId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

test('Combat keeps extreme pools and long equipment names reachable across viewports', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(120_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const id = runId();
  const email = `combat-responsive-${id}@example.com`;
  const weaponName = 'W'.repeat(160);
  const armorName = 'A'.repeat(160);
  let campaignId: string | undefined;
  let characterId: string | undefined;
  const inventoryIds: string[] = [];

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Combat Layout QA');
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
      timeout: 15_000,
    });

    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    async function post(path: string, data: object) {
      const response = await page.request.post(`/api/v1${path}`, {
        data,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json() as Promise<{ id: string }>;
    }

    const campaign = await post('/campaigns', {
      name: `Combat geometry ${id}`,
      experimentalTurnTracker: true,
      enforceAttributeCaps: false,
    });
    campaignId = campaign.id;
    const character = await post('/characters', {
      name: 'Combat Geometry Surveyor',
      campaignId,
      st: 99,
      dx: 99,
      iq: 99,
      ht: 99,
      hpMod: 50,
      fpMod: 50,
    });
    characterId = character.id;
    const combatResponse = await page.request.patch(`/api/v1/characters/${characterId}/combat`, {
      data: { currentHp: -1000, currentFp: -1000 },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(combatResponse.ok(), await combatResponse.text()).toBeTruthy();
    const weapon = await post(`/characters/${characterId}/inventory`, {
      name: weaponName,
      worn: true,
      equipped: true,
      weaponData: { damage: 'sw+1 cut', skill: null },
    });
    inventoryIds.push(weapon.id);
    const armor = await post(`/characters/${characterId}/inventory`, {
      name: armorName,
      worn: true,
      equipped: true,
      isArmor: true,
      armor: { locations: ['torso'], dr: 3 },
    });
    inventoryIds.push(armor.id);

    await page.goto(`/characters/${characterId}`);
    await selectCharacterSection(page, 'Combat');
    const status = page.getByRole('complementary', { name: 'Current Status' });
    await expect(
      status.getByRole('button', { name: /Adjust HP, current -1000 of 149/ }),
    ).toBeVisible();
    await expect(
      status.getByRole('button', { name: /Adjust FP, current -1000 of 149/ }),
    ).toBeVisible();

    const attacks = page.getByRole('table', { name: 'Attacks' });
    const weaponLink = attacks.getByRole('link', { name: weaponName, exact: true });
    const protection = page.getByRole('list', { name: 'Protection layers' });
    const armorLink = protection.getByRole('link', { name: armorName, exact: true });
    const armorValue = protection.getByText('3 DR', { exact: true });
    const trackerButton = page.getByRole('button', { name: 'Turn tracker', exact: true });
    await expect(attacks).toBeVisible();
    await expect(weaponLink).toBeVisible();
    await expect(protection).toBeVisible();
    await expect(armorLink).toBeVisible();
    await expect(armorValue).toBeVisible();
    if ((await trackerButton.getAttribute('aria-expanded')) !== 'true') await trackerButton.click();
    await page.getByRole('button', { name: 'Start tracker', exact: true }).click();
    const combatantName = 'C'.repeat(160);
    await page.getByRole('textbox', { name: 'Solo combatant name' }).fill(combatantName);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const combatant = page.getByText(combatantName, { exact: true });
    await expect(combatant).toBeVisible();

    for (const viewport of widths) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await armorLink.scrollIntoViewIfNeeded();
        await combatant.scrollIntoViewIfNeeded();
        await expect(
          status.getByRole('button', { name: /Adjust HP, current -1000 of 149/ }),
        ).toBeVisible();
        await expect(
          status.getByRole('button', { name: /Adjust FP, current -1000 of 149/ }),
        ).toBeVisible();
        await expect(weaponLink).toHaveText(weaponName);
        await expect(armorLink).toHaveText(armorName);
        await expect(armorValue).toHaveText('3 DR');
        await expect(combatant).toHaveText(combatantName);
        const geometry = await Promise.all(
          [armorLink, armorValue, combatant].map((element) =>
            element.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              const parent = node.parentElement?.getBoundingClientRect();
              return {
                x: rect.x,
                right: rect.right,
                width: rect.width,
                scrollWidth: node.scrollWidth,
                clientWidth: node.clientWidth,
                parent: parent ? { x: parent.x, right: parent.right } : null,
                documentWidth: document.documentElement.scrollWidth,
              };
            }),
          ),
        );
        for (const item of geometry) {
          expect(item.x).toBeGreaterThanOrEqual(0);
          expect(item.right).toBeLessThanOrEqual(viewport.width);
          expect(item.documentWidth).toBeLessThanOrEqual(viewport.width);
          expect(item.parent).not.toBeNull();
          if (item.parent) expect(item.right).toBeLessThanOrEqual(item.parent.right);
        }
        if ([320, 568, 640, 1024, 1440].includes(viewport.width)) {
          await attachReviewScreenshot(
            page,
            testInfo,
            `combat-${viewport.width}x${viewport.height}`,
            { animations: 'disabled' },
          );
        }
      });
    }
  } finally {
    try {
      for (const itemId of inventoryIds)
        await pool.query('delete from inventory_items where id=$1', [itemId]);
      if (characterId) await pool.query('delete from characters where id=$1', [characterId]);
      if (campaignId) await pool.query('delete from campaigns where id=$1', [campaignId]);
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});

test('Combat names illegal armor in the warning and incoming damage dialog across viewports', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(120_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const id = runId();
  const email = `armor-warning-${id}@example.com`;
  const longArmorName = 'Brigandine'.repeat(16);
  let campaignId: string | undefined;
  let characterId: string | undefined;
  const inventoryIds: string[] = [];

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Armor Warning QA');
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
      timeout: 15_000,
    });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    async function post(path: string, data: object) {
      const response = await page.request.post(`/api/v1${path}`, {
        data,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json() as Promise<{ id: string }>;
    }

    campaignId = (await post('/campaigns', { name: `Armor warnings ${id}` })).id;
    characterId = (await post('/characters', { name: 'Layering Test Defender', campaignId })).id;
    for (const armor of [
      { name: longArmorName, dr: 4 },
      { name: 'Mail shirt', dr: 3 },
    ]) {
      const row = await post(`/characters/${characterId}/inventory`, {
        name: armor.name,
        worn: true,
        equipped: true,
        isArmor: true,
        armor: {
          locations: ['torso', 'arm_left'],
          dr: armor.dr,
          flexible: false,
          concealable: false,
        },
      });
      inventoryIds.push(row.id);
    }

    await page.goto(`/characters/${characterId}`);
    await page.setViewportSize({ width: 375, height: 812 });
    const warningsToggle = page.getByRole('button', { name: /Warnings/ });
    if ((await warningsToggle.getAttribute('aria-expanded')) !== 'true')
      await warningsToggle.click();
    const sheetWarning = page.getByText(
      new RegExp(`“${longArmorName}”, “Mail shirt” at Torso, Left Arm, Vitals`),
    );
    await expect(sheetWarning).toBeVisible();
    await expect(sheetWarning).not.toContainText('arm_left');
    await sheetWarning.scrollIntoViewIfNeeded();
    await page.locator('html').evaluate((node) => node.setAttribute('data-theme', 'gilded-tome'));
    await attachReviewScreenshot(page, testInfo, 'armor-warning-sheet-dark-375', {
      animations: 'disabled',
    });
    await page.locator('html').evaluate((node) => node.setAttribute('data-theme', 'sunbolt'));
    await attachReviewScreenshot(page, testInfo, 'armor-warning-sheet-light-375', {
      animations: 'disabled',
    });

    await selectCharacterSection(page, 'Combat');
    const warning = page.getByText(/DR unavailable: resolve overlapping armor layers/);
    await expect(warning).toContainText(
      `“${longArmorName}”, “Mail shirt” at Torso, Left Arm, Vitals`,
    );
    await expect(warning).not.toContainText('arm_left');
    await page.getByRole('button', { name: /Incoming damage/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Incoming damage' });
    await expect(dialog).toBeVisible();
    const explanation = dialog.getByText(/Resolve overlapping armor layers in Inventory/);
    await expect(explanation).toContainText(
      `“${longArmorName}”, “Mail shirt” at Torso, Left Arm, Vitals`,
    );
    await expect(explanation).not.toContainText('arm_left');
    await page.getByLabel('Basic damage').fill('10');
    await expect(dialog.getByRole('button', { name: 'Damage unavailable' })).toBeDisabled();
    const modalBox = dialog.locator('.modal-box');

    for (const viewport of [
      { width: 375, height: 812 },
      { width: 575, height: 812 },
      { width: 1280, height: 800 },
    ]) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await expect(explanation).toBeVisible();
        const warningBounds = await warning.boundingBox();
        expect(warningBounds).not.toBeNull();
        if (warningBounds) {
          expect(warningBounds.x).toBeGreaterThanOrEqual(0);
          expect(warningBounds.x + warningBounds.width).toBeLessThanOrEqual(viewport.width);
        }
        const bounds = await dialog.boundingBox();
        expect(bounds).not.toBeNull();
        if (bounds) {
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.y).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
        }
        const contentBounds = await modalBox.boundingBox();
        expect(contentBounds).not.toBeNull();
        if (contentBounds) {
          expect(contentBounds.x).toBeGreaterThanOrEqual(0);
          expect(contentBounds.y).toBeGreaterThanOrEqual(0);
          expect(contentBounds.x + contentBounds.width).toBeLessThanOrEqual(viewport.width);
          expect(contentBounds.y + contentBounds.height).toBeLessThanOrEqual(viewport.height);
        }
        const explanationGeometry = await explanation.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return {
            x: rect.x,
            right: rect.right,
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
          };
        });
        expect(explanationGeometry.x).toBeGreaterThanOrEqual(0);
        expect(explanationGeometry.right).toBeLessThanOrEqual(viewport.width);
        expect(explanationGeometry.scrollWidth).toBeLessThanOrEqual(
          explanationGeometry.clientWidth,
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        await attachReviewScreenshot(page, testInfo, `armor-warning-${viewport.width}`, {
          animations: 'disabled',
        });
      });
    }
  } finally {
    try {
      for (const itemId of inventoryIds)
        await pool.query('delete from inventory_items where id=$1', [itemId]);
      if (characterId) await pool.query('delete from characters where id=$1', [characterId]);
      if (campaignId) await pool.query('delete from campaigns where id=$1', [campaignId]);
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});

test('Attacks keep one dense, contained row per attack mode across viewports', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(180_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const id = runId();
  const email = `attack-ledger-${id}@example.com`;
  const longPistol = 'Bluesteel Pistol – Dexter of the Lantern Coast Irregulars';
  const rifle = 'Bluesteel Rifle – Caliban';
  let campaignId: string | undefined;
  let characterId: string | undefined;

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Attack Ledger QA');
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
      timeout: 15_000,
    });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    async function post(path: string, data: object) {
      const response = await page.request.post(`/api/v1${path}`, {
        data,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json() as Promise<{ id: string }>;
    }

    campaignId = (await post('/campaigns', { name: `Attack ledger ${id}` })).id;
    characterId = (
      await post('/characters', { name: 'Ledger Duelist', campaignId, st: 11, dx: 14 })
    ).id;
    for (const [name, specialization, difficulty] of [
      ['Guns', 'Pistol', 'E'],
      ['Guns', 'Rifle', 'E'],
      ['Brawling', null, 'E'],
      ['Rapier', null, 'A'],
      ['Main-Gauche', null, 'A'],
      ['Knife', null, 'E'],
      ['Thrown Weapon', 'Knife', 'E'],
    ] as const) {
      await post(`/characters/${characterId}/skills`, {
        name,
        specialization,
        attribute: 'DX',
        difficulty,
        points: 8,
      });
    }
    const weapons = [
      {
        name: longPistol,
        modes: [
          {
            key: 'shot',
            name: 'Shot',
            skill: 'Guns (Pistol)',
            damage: '2d+1 pi+',
            ranged: {
              acc: 3,
              range: { kind: 'fixed', halfDamageYards: 1600, maxYards: 2000 },
              rof: '3',
              shots: '30+1(3)',
              bulk: -2,
              recoil: 3,
            },
          },
          { key: 'grip', name: 'Pistol grip', skill: 'Brawling', damage: 'thr+1 cr', reach: 'C,1' },
        ],
      },
      {
        name: 'Rapier',
        modes: [
          { key: 'swing', name: 'Swing', skill: 'Rapier', damage: 'sw cut', reach: '1,2' },
          { key: 'thrust', name: 'Thrust', skill: 'Rapier', damage: 'thr+1 imp', reach: '1,2' },
        ],
      },
      {
        name: 'Main-Gauche',
        modes: [
          { key: 'thrust', name: 'Thrust', skill: 'Main-Gauche', damage: 'thr imp', reach: 'C,1' },
          { key: 'swing', name: 'Swing', skill: 'Main-Gauche', damage: 'sw-3 cut', reach: 'C,1' },
        ],
      },
      {
        name: 'Large Knife',
        modes: [
          { key: 'swing', name: 'Swing', skill: 'Knife', damage: 'sw-2 cut', reach: 'C,1' },
          { key: 'thrust', name: 'Thrust', skill: 'Knife', damage: 'thr imp', reach: 'C' },
          {
            key: 'thrown',
            name: 'Thrown',
            skill: 'Thrown Weapon (Knife)',
            damage: 'thr imp',
            ranged: {
              acc: 0,
              range: { kind: 'fixed', halfDamageYards: 9, maxYards: 15 },
              rof: '1',
              shots: 'T(1)',
              bulk: -2,
            },
          },
        ],
      },
      {
        name: rifle,
        modes: [
          {
            key: 'shot',
            name: 'Shot',
            skill: 'Guns (Rifle)',
            damage: '4d+2 pi+',
            stRequired: 12,
            ranged: {
              acc: 5,
              range: { kind: 'fixed', halfDamageYards: 160, maxYards: 1600 },
              rof: '1',
              shots: '1(3)',
              bulk: -5,
              recoil: 3,
            },
          },
        ],
      },
      {
        name: 'Brass Knuckles',
        modes: [
          { key: 'primary', name: 'Primary', skill: 'Brawling', damage: 'thr cr', reach: 'C' },
        ],
      },
    ];
    for (const weapon of weapons) {
      await post(`/characters/${characterId}/inventory`, {
        name: weapon.name,
        worn: true,
        equipped: true,
        weaponData: { modes: weapon.modes },
      });
    }

    await page.goto(`/characters/${characterId}`);
    await selectCharacterSection(page, 'Combat');
    const attacks = page.getByRole('table', { name: 'Attacks' });
    await expect(attacks).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Attack order' })).toHaveCount(0);
    const groups = attacks.getByRole('rowgroup').filter({ has: page.getByRole('rowheader') });
    await expect(groups).toHaveCount(6);
    const rifleGroup = attacks.getByRole('rowgroup', { name: rifle });
    await expect(rifleGroup.getByText('ST 12 (−1)', { exact: true })).toBeVisible();
    const modifiers = rifleGroup.getByRole('button', { name: `Modifiers: ${rifle}, Shot` });
    await expect(attacks.getByRole('button', { name: /^Modifiers:/ })).toHaveCount(1);

    const viewports = [
      { width: 320, height: 568 },
      { width: 375, height: 812 },
      { width: 568, height: 320 },
      { width: 639, height: 800 },
      { width: 640, height: 800 },
      { width: 641, height: 800 },
      { width: 768, height: 1024 },
      { width: 1023, height: 800 },
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
    ];
    for (const viewport of viewports) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await expect(attacks.getByRole('link', { name: longPistol })).toHaveText(longPistol);
        await expect(
          attacks.getByRole('rowgroup', { name: 'Rapier' }).getByRole('button', {
            name: /^Rapier · Swing \d+$/,
          }),
        ).toBeVisible();
        const geometry = await attacks.evaluate((table) => {
          const box = (element: Element | null) => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          };
          const wrapper = table.parentElement as HTMLElement;
          return {
            documentWidth: document.documentElement.scrollWidth,
            tableHeight: table.getBoundingClientRect().height,
            wrapper: box(wrapper),
            wrapperOverflow: wrapper.scrollWidth - wrapper.clientWidth,
            groups: [...table.querySelectorAll('tbody[aria-label]')].map((group) => ({
              name: group.getAttribute('aria-label'),
              weapon: box(group.querySelector('th a')),
              rows: [...group.querySelectorAll('tr')].map((row) => {
                const buttons = [...row.querySelectorAll('button')];
                // The attack roll is named by its visible skill, mode and level.
                const skill = buttons.find((button) => !button.hasAttribute('aria-label'));
                const damage = buttons.find((button) =>
                  /^\d+d/.test(button.getAttribute('aria-label') ?? ''),
                );
                const modifier = buttons.find((button) =>
                  (button.getAttribute('aria-label') ?? '').startsWith('Modifiers:'),
                );
                return {
                  skill: box(skill?.querySelector('.num') ?? null),
                  skillButton: box(skill ?? null),
                  damage: box(damage ?? null),
                  modifier: box(modifier ?? null),
                };
              }),
            })),
          };
        });
        expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width);
        expect(geometry.wrapperOverflow).toBeLessThanOrEqual(0);
        const wrapper = geometry.wrapper;
        expect(wrapper).not.toBeNull();
        if (!wrapper) return;
        const inside = (rect: { left: number; right: number } | null) => {
          expect(rect).not.toBeNull();
          if (!rect) return;
          expect(rect.left).toBeGreaterThanOrEqual(wrapper.left - 0.5);
          expect(rect.right).toBeLessThanOrEqual(wrapper.right + 0.5);
        };
        const apart = (
          a: { left: number; right: number; top: number; bottom: number } | null,
          b: { left: number; right: number; top: number; bottom: number } | null,
        ) => {
          if (!a || !b) return;
          const overlaps =
            a.left < b.right - 0.5 &&
            b.left < a.right - 0.5 &&
            a.top < b.bottom - 0.5 &&
            b.top < a.bottom - 0.5;
          expect(overlaps).toBe(false);
        };
        for (const group of geometry.groups) {
          inside(group.weapon);
          const first = group.rows[0];
          expect(first?.skillButton).toBeTruthy();
          if (group.weapon && first?.skillButton) {
            if (viewport.width >= 640) {
              // The weapon name starts its group beside the first attack.
              expect(Math.abs(group.weapon.top - first.skillButton.top)).toBeLessThanOrEqual(8);
            } else {
              expect(group.weapon.bottom).toBeLessThanOrEqual(first.skillButton.top + 0.5);
            }
          }
          for (const row of group.rows) {
            inside(row.skill);
            inside(row.damage);
            if (row.modifier) inside(row.modifier);
            apart(row.skill, row.damage);
            apart(row.skill, row.modifier);
            apart(row.damage, row.modifier);
          }
        }
        if (viewport.width === 1280) expect(geometry.tableHeight).toBeLessThanOrEqual(480);

        if (viewport.width === 375 || viewport.width === 1280) {
          // The phone grid keeps native table semantics.
          await expect(rifleGroup.getByRole('rowheader', { name: rifle })).toBeVisible();
          await expect(rifleGroup.getByRole('row')).toHaveCount(1);
          await expect(
            attacks.getByRole('rowgroup', { name: 'Large Knife' }).getByRole('row'),
          ).toHaveCount(3);
          await expect(
            attacks.getByRole('rowgroup', { name: 'Large Knife' }).getByRole('cell', {
              name: 'Acc 0 · 9/15 · RoF 1 · Shots T(1) · Bulk −2',
            }),
          ).toBeVisible();
        }

        // Open the breakdown with its trigger near the bottom of the viewport.
        await modifiers.evaluate((node) => node.scrollIntoView({ block: 'end' }));
        await modifiers.click();
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip.getByRole('region', { name: 'Attack' })).toContainText('ST (B270)');
        const headerBottom = await page
          .locator('header')
          .first()
          .evaluate((node) => node.getBoundingClientRect().bottom);
        const bounds = await tooltip.boundingBox();
        expect(bounds).not.toBeNull();
        if (bounds) {
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
          expect(bounds.y).toBeGreaterThanOrEqual(headerBottom);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
        }
        if ([375, 640, 1280].includes(viewport.width)) {
          await attachReviewScreenshot(page, testInfo, `attacks-tooltip-${viewport.width}`, {
            animations: 'disabled',
          });
        }
        // Keyboard users dismiss it with Escape and stay on the trigger.
        await page.mouse.move(0, 0);
        await modifiers.blur();
        await modifiers.focus();
        await expect(tooltip).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(tooltip).toHaveCount(0);
        await expect(modifiers).toBeFocused();
        if ([320, 375, 640, 1024, 1280].includes(viewport.width)) {
          await attacks.scrollIntoViewIfNeeded();
          for (const theme of ['sunbolt', 'gilded-tome']) {
            await page.locator('html').evaluate((node, name) => {
              node.setAttribute('data-theme', name);
            }, theme);
            await attachReviewScreenshot(attacks, testInfo, `attacks-${theme}-${viewport.width}`, {
              animations: 'disabled',
            });
          }
          await page.locator('html').evaluate((node) => node.setAttribute('data-theme', 'sunbolt'));
        }
      });
    }
  } finally {
    try {
      if (characterId) {
        await pool.query('delete from inventory_items where character_id=$1', [characterId]);
        await pool.query('delete from character_skills where character_id=$1', [characterId]);
        await pool.query('delete from characters where id=$1', [characterId]);
      }
      if (campaignId) await pool.query('delete from campaigns where id=$1', [campaignId]);
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
