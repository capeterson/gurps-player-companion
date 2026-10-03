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
