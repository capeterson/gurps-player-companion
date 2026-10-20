import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { test } from './authenticated-fixture';
import { selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

test.use({ serviceWorkers: 'block' });

// Phone, the 640px breakpoint boundaries, and desktop.
const VIEWPORTS = [
  { width: 375, height: 700 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 1280, height: 800 },
] as const;

const LONG_NAME = 'Archery from the north tower battlements during the long winter siege';

async function expectInsideViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
}

async function api(page: Page) {
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  return async (path: string, method: 'GET' | 'POST' | 'PATCH', data?: object) => {
    const response = await page.request.fetch(`/api/v1${path}`, {
      method,
      ...(data ? { data } : {}),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
}

async function setup(page: Page) {
  const call = await api(page);
  const character = await call('/characters', 'POST', { name: 'Loadout tester' });
  const inventory = `/characters/${character.id}/inventory`;
  const add = async (data: object) => (await call(inventory, 'POST', data)).item as { id: string };
  const sword = await add({ name: 'Sword', equipped: true });
  const shield = await add({ name: 'Shield', equipped: true });
  const chest = await add({ name: 'Iron chest', worn: false, isContainer: true });
  const bow = await add({ name: 'Bow', parentId: chest.id });
  const loadouts = `/characters/${character.id}/loadouts`;
  await call(loadouts, 'POST', { name: 'Melee', itemIds: [sword.id, shield.id] });
  await call(loadouts, 'POST', { name: LONG_NAME, itemIds: [bow.id] });
  await page.goto(`/characters/${character.id}`);
  await selectCharacterSection(page, 'Inventory');
  return { call, characterId: character.id, bow };
}

function menuButton(page: Page) {
  return page.getByRole('button', { name: /▾$/ }).filter({ hasText: /Loadouts|Melee|Archery/ });
}

function loadoutRow(page: Page, name: string) {
  return page
    .getByRole('menu', { name: 'Loadouts' })
    .getByRole('listitem')
    .filter({ hasText: name });
}

test('equips, explains and restores loadouts, with overlays inside the viewport', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { call, characterId, bow } = await setup(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await menuButton(page).click();
    const menu = page.getByRole('menu', { name: 'Loadouts' });
    await expect(menu).toBeVisible();
    await expect(loadoutRow(page, LONG_NAME)).toBeVisible();
    await expectInsideViewport(page, menu);
    await attachReviewScreenshot(page, testInfo, `loadouts-menu-${viewport.width}`);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await menuButton(page).click();
  await loadoutRow(page, LONG_NAME).getByRole('menuitem', { name: 'Equip' }).click();
  await expect(page.getByText('1 equipped, 2 unequipped, 1 moved.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Equipped: Bow' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Equipped: Sword' })).toHaveCount(0);
  const active = menuButton(page).getByText(LONG_NAME);
  await expect(active).toHaveClass(/font-semibold/);

  // Another device unequips the bow; the cursor brings it here.
  await expect
    .poll(
      async () => (await call(`/characters/${characterId}/loadouts`, 'GET')).lastEquipmentSwitch,
    )
    .not.toBeNull();
  await call(`/characters/${characterId}/inventory/${bow.id}`, 'PATCH', { equipped: false });
  await page.reload();
  await selectCharacterSection(page, 'Inventory');
  await expect(menuButton(page).getByText(LONG_NAME)).toHaveClass(/italic/, { timeout: 15_000 });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await menuButton(page).hover();
    const tooltip = page.getByRole('tooltip').filter({ hasText: 'Not equipped: Bow' });
    await expect(tooltip).toBeVisible();
    await expectInsideViewport(page, tooltip);
    await attachReviewScreenshot(page, testInfo, `loadouts-changed-${viewport.width}`);
    await page.mouse.move(0, 0);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'Restore Last Equipped' }).click();
  await expect(page.getByText(/^Restored Last Equipped:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Equipped: Sword' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Equipped: Shield' })).toBeVisible();
  await expect(menuButton(page)).toHaveText('Loadouts ▾');
  await expect
    .poll(async () => {
      const detail = await call(`/characters/${characterId}`, 'GET');
      return detail.inventory.find((item: { id: string }) => item.id === bow.id)?.parentId;
    })
    .not.toBeNull();
});

test('creates, edits and reorders loadouts, and equips offline', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 700 });
  const { call, characterId } = await setup(page);

  await menuButton(page).click();
  await page.getByRole('menuitem', { name: 'New loadout' }).click();
  const editor = page.getByRole('region', { name: /^Loadout / });
  await expect(editor).toHaveAccessibleName('Loadout New loadout');
  await expect(editor.getByLabel('Name')).toBeFocused();
  await expect(editor.getByRole('checkbox', { name: 'Sword' })).toBeChecked();
  await editor.getByLabel('Name').fill('Travel');
  await editor.getByLabel('Name').blur();
  await editor.getByRole('checkbox', { name: 'Bow' }).check();
  await expectInsideViewport(page, editor);
  await attachReviewScreenshot(page, testInfo, 'loadout-editor-375');
  await editor.getByRole('button', { name: 'Done' }).click();

  await menuButton(page).click();
  const names = () =>
    page
      .getByRole('menu', { name: 'Loadouts' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('menuitem', { name: 'Equip' }) })
      .allTextContents();
  await expect.poll(names).toEqual(['MeleeEquip', `${LONG_NAME}Equip`, 'TravelEquip']);
  await page.getByRole('button', { name: 'Reorder Travel' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(names).toEqual(['MeleeEquip', 'TravelEquip', `${LONG_NAME}Equip`]);
  await expect(page.getByRole('button', { name: 'Reorder Travel' })).toBeFocused();
  await page.getByRole('button', { name: 'Reorder Melee' }).dragTo(loadoutRow(page, LONG_NAME));
  await expect.poll(names).toEqual(['TravelEquip', `${LONG_NAME}Equip`, 'MeleeEquip']);
  await page.keyboard.press('Escape');

  await context.setOffline(true);
  await menuButton(page).click();
  await loadoutRow(page, 'Travel').getByRole('menuitem', { name: 'Equip' }).click();
  await expect(page.getByText(/^Equipped Travel:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Equipped: Bow' })).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(
      async () =>
        (await call(`/characters/${characterId}/loadouts`, 'GET')).lastEquipmentSwitch
          ?.activeLoadoutName,
      { timeout: 30_000 },
    )
    .toBe('Travel');
  const server = await call(`/characters/${characterId}/loadouts`, 'GET');
  expect(server.loadouts.map((entry: { name: string }) => entry.name)).toEqual([
    'Travel',
    LONG_NAME,
    'Melee',
  ]);
});
