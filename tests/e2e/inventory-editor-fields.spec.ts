import { join } from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { selectCharacterSection } from './character-navigation';
import { reviewArtifactsEnabled } from './review-artifacts';

const PASSWORD = 'CorrectHorseBatteryStaple1';
// Reported widths plus the 640px editor breakpoint boundaries.
const VIEWPORTS = [
  { width: 1280, height: 900, shots: true },
  { width: 641, height: 900, shots: false },
  { width: 640, height: 900, shots: false },
  { width: 639, height: 900, shots: false },
  { width: 375, height: 812, shots: true },
];
const ARMOR = 'Warded Mail Hauberk of the Long Northern Watch';
const WARD = 'Ward of the Lighthouse Keepers of the Northern Coast';
const PACK = "Traveler's Backpack with Many Pockets";
const POUCH = 'Oilskin Map Pouch';
const LANTERN = 'Hooded Brass Lantern';
const LIBRARY_ITEM = 'Long Watch Mail Hauberk (Campaign Armory)';
const SHOTS_DIR = process.env.INVENTORY_EDITOR_SHOTS_DIR;

async function expectInside(page: Page, locator: Locator, label: string) {
  const width = page.viewportSize()?.width ?? 0;
  const box = await locator.boundingBox();
  expect(box, `${label} is rendered`).not.toBeNull();
  if (!box) return;
  expect(box.x, `${label} starts inside ${width}px`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label} ends inside ${width}px`).toBeLessThanOrEqual(width + 1);
}

async function expectNoPageOverflow(page: Page) {
  const width = page.viewportSize()?.width ?? 0;
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width);
}

/** Every queued edit reached the server; a rejection would show the error state. */
async function expectSynced(page: Page) {
  await expect(page.getByRole('button', { name: /^All changes saved/ }).first()).toBeVisible({
    timeout: 15_000,
  });
}

async function shot(target: Locator, name: string, viewport: { width: number; shots: boolean }) {
  if (!reviewArtifactsEnabled || !SHOTS_DIR || !viewport.shots) return;
  // Background sync can re-render a just-moved row; capture its settled copy.
  await expect(async () => {
    await target.screenshot({
      path: join(SHOTS_DIR, `${name}-${viewport.width}.png`),
      animations: 'disabled',
      timeout: 3_000,
      // Fixed/sticky chrome would cover part of a tall editor capture.
      style: '.app-header, .sheet-dock, .sheet-flower { visibility: hidden !important; }',
    });
  }).toPass({ timeout: 15_000 });
}

test('inventory editor edits enchantment effects, library links and location', async ({ page }) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(240_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `inventory-editor-${runId}@example.com`;
  const campaignName = `Inventory editor ${runId}`;
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL ?? '',
    connectionTimeoutMillis: 5_000,
  });
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Inventory Editor QA');
    await page.getByLabel(/^password\b/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    async function api<T>(method: 'POST' | 'PATCH', path: string, data: object): Promise<T> {
      const response = await page.request.fetch(`/api/v1${path}`, {
        method,
        data,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
      return response.json() as Promise<T>;
    }

    const campaign = await api<{ id: string }>('POST', '/campaigns', { name: campaignName });
    const fortify = await api<{ id: string }>(
      'POST',
      `/campaigns/${campaign.id}/library/enchantments`,
      {
        name: 'Fortify',
        source: 'M66',
        tags: ['armor'],
        applicability: 'armor',
        effects: [{ target: 'dr', value: 1 }],
        levels: [],
        stackingPolicy: { kind: 'highest', key: 'fortify' },
      },
    );
    const libraryItem = await api<{ id: string }>(
      'POST',
      `/campaigns/${campaign.id}/library/items`,
      { name: LIBRARY_ITEM, cost: 900, weightLbs: 25, isArmor: true, armor: { dr: 4 } },
    );
    const character = await api<{ id: string }>('POST', '/characters', {
      name: 'Inventory editor character',
      campaignId: campaign.id,
    });
    const inventory = `/characters/${character.id}/inventory`;
    const armor = await api<{ item: { id: string; enchantments: unknown[] } }>('POST', inventory, {
      name: ARMOR,
      worn: true,
      equipped: true,
      weightLbs: 25,
      cost: 900,
      isArmor: true,
      armor: { dr: 4, locations: ['torso', 'arm_left', 'arm_right'] },
      libraryItemId: libraryItem.id,
      enchantments: [
        { spellName: 'Fortify', spellLevel: 15, definitionId: fortify.id },
        {
          spellName: WARD,
          spellLevel: 15,
          mechanics: {
            applicability: 'armor',
            effects: [
              { target: 'dr', value: 2 },
              { target: 'db', value: 1 },
              { target: 'skill', value: 1, skillName: 'Observation' },
            ],
            levels: [
              { level: 1, label: 'Lesser', effects: [{ target: 'dr', value: 1 }] },
              { level: 2, label: 'Greater', effects: [{ target: 'weapon_parry', value: 1 }] },
            ],
            stackingPolicy: { kind: 'stack' },
          },
        },
      ],
    });
    const pack = await api<{ item: { id: string } }>('POST', inventory, {
      name: PACK,
      worn: true,
      isContainer: true,
      weightLbs: 3,
      cost: 60,
      weightReductionPercent: 25,
    });
    await api('POST', inventory, {
      name: POUCH,
      parentId: pack.item.id,
      isContainer: true,
      weightLbs: 0.5,
      cost: 5,
    });
    const lantern = await api<{ item: { id: string } }>('POST', inventory, {
      name: LANTERN,
      worn: true,
      equipped: true,
      weightLbs: 2,
      cost: 20,
    });
    // The library definition grows while this device still holds the older
    // item snapshot (the state an offline device sees before its next pull).
    const staleEnchantments = armor.item.enchantments;
    await api('PATCH', `/campaigns/${campaign.id}/library/enchantments/${fortify.id}`, {
      name: 'Greater Fortify',
      effects: [{ target: 'dr', value: 2 }],
      levels: [{ level: 2, label: 'Hardened', effects: [{ target: 'dr', value: 1 }] }],
    });
    await pool.query('update inventory_items set enchantments = $1::jsonb where id = $2', [
      JSON.stringify(staleEnchantments),
      armor.item.id,
    ]);

    await page.goto(`/characters/${character.id}`);
    await selectCharacterSection(page, 'Inventory');
    const armorRow = page.locator(`#inventory-${armor.item.id}`);
    await expect(armorRow).toBeVisible({ timeout: 15_000 });
    await page
      .locator(`#inventory-${pack.item.id}`)
      .getByRole('button', { name: 'Expand contents' })
      .click();

    for (const viewport of VIEWPORTS) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);

        // (a) Independent enchantment effects form.
        await armorRow.getByRole('button', { name: `Enchantments settings for ${ARMOR}` }).click();
        const enchantments = page.getByRole('region', { name: `${ARMOR}: Enchantments` });
        await expect(enchantments).toBeVisible();
        await enchantments.getByRole('button', { name: `Edit effects of ${WARD}` }).click();
        const form = enchantments.getByRole('form', { name: `Effects of ${WARD}` });
        await expect(form.getByLabel('Base effect 3', { exact: true })).toHaveValue('skill');
        await expect(form.getByLabel('Base effect 3 skill')).toHaveValue('Observation');
        await expect(form.getByLabel('Level 2 label')).toHaveValue('Greater');
        for (const control of [
          form,
          form.getByLabel('Base effect 3 skill'),
          form.getByRole('button', { name: 'Save effects' }),
        ])
          await expectInside(page, control, 'effects form');
        await expectNoPageOverflow(page);
        await shot(form, 'a-enchantment-effects-form', viewport);
        await form.getByRole('button', { name: 'Cancel' }).click();

        // (b) Linked enchantment with a newer library definition.
        const notice = enchantments.getByText('Greater Fortify changed in the campaign library.');
        await expect(notice).toBeVisible();
        await enchantments.getByRole('button', { name: 'Review update' }).click();
        await expect(enchantments.getByText('Name: Fortify → Greater Fortify')).toBeVisible();
        await expect(enchantments.getByRole('list', { name: 'Removed effects' })).toContainText(
          '+1 DR',
        );
        await expect(enchantments.getByRole('list', { name: 'Added effects' })).toContainText(
          'Level 2 (Hardened): +1 DR',
        );
        const linkedGroup = enchantments.getByRole('group', { name: 'Enchantment 1' });
        await expectInside(page, linkedGroup, 'update preview');
        await shot(linkedGroup, 'b-enchantment-update-preview', viewport);
        await enchantments.getByRole('button', { name: 'Not now' }).click();
        await armorRow.getByRole('button', { name: `Enchantments settings for ${ARMOR}` }).click();

        // (d) Library link and Unlink confirmation.
        await armorRow.getByRole('button', { name: `Edit ${ARMOR}` }).click();
        const details = page.getByRole('region', { name: `${ARMOR}: Item details` });
        await expect(
          details.getByText(`Linked to ${LIBRARY_ITEM} in the campaign library`),
        ).toBeVisible();
        await details
          .getByRole('button', { name: `Unlink ${ARMOR} from the campaign library` })
          .click();
        await expect(details.getByRole('button', { name: 'Keep link' })).toBeVisible();
        await expectInside(page, details, 'item details');
        await shot(details, 'd-library-link-unlink', viewport);
        await details.getByRole('button', { name: 'Keep link' }).click();
        await details.getByRole('button', { name: 'Done' }).click();

        // (e) Location: on the player, stashed, then in a container.
        const lanternRow = page.locator(`#inventory-${lantern.item.id}`);
        await lanternRow.getByRole('button', { name: `Edit ${LANTERN}` }).click();
        const lanternEditor = page.getByRole('region', { name: `${LANTERN}: Item details` });
        const location = lanternEditor.getByRole('combobox', { name: 'Location' });
        await expect(location).toHaveValue('player');
        await expect(lanternEditor.getByRole('checkbox', { name: 'Equipped' })).toBeEnabled();
        await expectInside(page, lanternEditor, 'location editor');
        await shot(lanternEditor, 'e1-location-on-player', viewport);

        await location.selectOption('stashed');
        // The row moves to the Stashed table and its editor stays open there.
        const stashedEditor = page
          .getByRole('table', { name: 'Stashed inventory', exact: true })
          .getByRole('region', { name: `${LANTERN}: Item details` });
        await expect(stashedEditor).toBeVisible();
        await expectSynced(page);
        const equipped = stashedEditor.getByRole('checkbox', { name: 'Equipped' });
        await expect(equipped).toBeDisabled();
        await expect(equipped).not.toBeChecked();
        await expect(
          stashedEditor.getByText('Move the item on the player to equip it.'),
        ).toBeVisible();
        await stashedEditor.getByLabel('Stash location').fill('Room 3 at the Gull and Anchor Inn');
        await stashedEditor.getByLabel('Stash location').blur();
        await expectSynced(page);
        await expectInside(page, stashedEditor, 'stashed editor');
        await shot(stashedEditor, 'e2-location-stashed', viewport);

        await stashedEditor.getByRole('combobox', { name: 'Location' }).selectOption({
          label: `In ${POUCH}`,
        });
        const nestedEditor = page.getByRole('region', { name: `${LANTERN}: Item details` });
        await expect(nestedEditor.getByRole('combobox', { name: 'Location' })).toHaveValue(
          /^[0-9a-f-]{36}$/,
        );
        await expect(nestedEditor.getByLabel('Stash location')).toHaveCount(0);
        await expectSynced(page);
        await expectInside(page, nestedEditor, 'nested editor');
        await expectNoPageOverflow(page);
        await shot(nestedEditor, 'e3-location-in-container', viewport);

        await nestedEditor.getByRole('combobox', { name: 'Location' }).selectOption('player');
        const backOnPlayer = page
          .getByRole('table', { name: 'Carried inventory', exact: true })
          .getByRole('region', { name: `${LANTERN}: Item details` });
        await expect(backOnPlayer.getByRole('checkbox', { name: 'Equipped' })).toBeEnabled();
        await expectSynced(page);
        await backOnPlayer.getByRole('button', { name: 'Done' }).click();
      });
    }
  } finally {
    try {
      await pool.query(
        'delete from campaigns where name=$1 and owner_id=(select id from users where email=$2)',
        [campaignName, email],
      );
      await pool.query(
        'delete from characters where owner_id=(select id from users where email=$1)',
        [email],
      );
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
