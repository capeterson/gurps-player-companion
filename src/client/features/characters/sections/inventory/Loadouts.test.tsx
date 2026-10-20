import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildInventoryItemOut } from '../../../../../shared/domain/characterDetail.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { type LocalCharacterInventory, getLocalDb, resetLocalDb } from '../../../../db/dexie.ts';
import { ToastProvider } from '../../../../lib/toast.tsx';
import { flashBus } from '../../../../sync/flashBus.ts';
import { InventoryPanel } from '../InventoryPanel.tsx';

const CHARACTER = '0193b3c0-f1f0-7000-8000-00000000f001';
const SWORD = '0193b3c0-f1f0-7000-8000-00000000f011';
const BOW = '0193b3c0-f1f0-7000-8000-00000000f012';
const CHEST = '0193b3c0-f1f0-7000-8000-00000000f013';
const ANVIL = '0193b3c0-f1f0-7000-8000-00000000f014';
const MELEE = '0193b3c0-f1f0-7000-8000-00000000f021';
const ARCHERY = '0193b3c0-f1f0-7000-8000-00000000f022';

function row(id: string, name: string, patch: Partial<LocalCharacterInventory> = {}) {
  return {
    id,
    characterId: CHARACTER,
    name,
    quantity: 1,
    weightLbs: 1,
    cost: 1,
    notes: null,
    parentId: null,
    externalLocation: null,
    worn: true,
    equipped: false,
    isContainer: false,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    isArmor: false,
    armor: null,
    weaponData: null,
    powerstoneData: null,
    magicItemData: null,
    enchantments: [],
    libraryItemId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 3,
    ...patch,
  } satisfies LocalCharacterInventory;
}

function loadout(id: string, name: string, itemIds: string[], sortOrder: number) {
  return {
    id,
    characterId: CHARACTER,
    name,
    itemIds,
    sortOrder,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 2,
  };
}

async function seed(extra: LocalCharacterInventory[] = []) {
  const db = getLocalDb();
  await db.characters.put({
    id: CHARACTER,
    ownerId: 'owner',
    campaignId: null,
    name: 'Ash',
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
    st: 10,
    dx: 10,
    iq: 10,
    ht: 10,
    hpMod: 0,
    willMod: 0,
    perMod: 0,
    fpMod: 0,
    speedQuarterMod: 0,
    moveMod: 0,
    dismissedWarnings: [],
    activeConditionGroups: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 5,
  });
  await db.characterInventory.bulkPut([
    row(SWORD, 'Sword', { equipped: true }),
    row(CHEST, 'Chest', { worn: false, isContainer: true }),
    row(BOW, 'Bow', { parentId: CHEST, worn: false }),
    ...extra,
  ]);
  await db.characterLoadouts.bulkPut([
    loadout(MELEE, 'Melee', [SWORD], 0),
    loadout(ARCHERY, 'Archery', [BOW], 1),
  ]);
}

/** The panel over live Dexie rows, as the sheet renders it. */
function LiveInventory({ canWrite }: { canWrite: boolean }) {
  const rows = useLiveQuery(() =>
    getLocalDb().characterInventory.where('characterId').equals(CHARACTER).toArray(),
  );
  if (!rows) return null;
  const character = {
    id: CHARACTER,
    campaignId: null,
    inventory: rows.map((entry) => buildInventoryItemOut(entry, new Map())),
    skills: [],
    libraryEffectsKnown: true,
    encumbrance: { playerWeightLbs: 0, basicLift: 20, level: 0 },
  } as unknown as CharacterDetail;
  return <InventoryPanel character={character} canWrite={canWrite} />;
}

async function renderInventory(canWrite = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <LiveInventory canWrite={canWrite} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  // The live inventory and loadout queries resolve before the toolbar shows them.
  await screen.findByRole('button', { name: /▾$/ });
  await waitFor(() => expect(menuButton()).toBeVisible());
}

function menuButton() {
  return screen.getByRole('button', { name: /^(Loadouts: )?\S+ ▾$|^Loadouts ▾$/ });
}

function openMenu() {
  fireEvent.click(menuButton());
  return screen.getByRole('menu', { name: 'Loadouts' });
}

beforeEach(async () => {
  await resetLocalDb();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('Inventory loadouts', () => {
  it('equips a loadout, names it as active, and restores Last Equipped from the toast', async () => {
    await seed();
    await renderInventory();
    const menu = openMenu();
    expect(
      within(menu)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['MeleeEquip', 'ArcheryEquip', 'New loadout']);
    fireEvent.click(
      within(within(menu).getByText('Archery').closest('li') as HTMLElement).getByRole('menuitem', {
        name: 'Equip',
      }),
    );
    expect(await screen.findByText('Equipped Archery: 1 equipped, 1 unequipped, 1 moved.')).toBe(
      screen.getByText('Equipped Archery: 1 equipped, 1 unequipped, 1 moved.'),
    );
    const db = getLocalDb();
    expect(await db.characterInventory.get(BOW)).toMatchObject({
      equipped: true,
      parentId: null,
      worn: true,
    });
    await waitFor(() => expect(menuButton()).toHaveTextContent('Archery ▾'));
    expect(within(menuButton()).getByText('Archery')).toHaveClass('font-semibold', 'text-primary');

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(
      await screen.findByText('Restored Last Equipped: 1 equipped, 1 unequipped, 1 moved.'),
    ).toBeVisible();
    expect(await db.characterInventory.get(BOW)).toMatchObject({
      equipped: false,
      parentId: CHEST,
    });
    await waitFor(() => expect(menuButton()).toHaveTextContent('Loadouts ▾'));
    expect(await db.outbox.count()).toBe(2);
  });

  it('de-emphasizes a changed active loadout and explains the difference', async () => {
    await seed();
    await renderInventory();
    fireEvent.click(
      within(within(openMenu()).getByText('Melee').closest('li') as HTMLElement).getByRole(
        'menuitem',
        { name: 'Equip' },
      ),
    );
    await waitFor(() =>
      expect(within(menuButton()).getByText('Melee')).toHaveClass('font-semibold'),
    );
    // A manual edit after the switch.
    await getLocalDb().characterInventory.update(SWORD, { equipped: false });
    await waitFor(() =>
      expect(within(menuButton()).getByText('Melee')).toHaveClass('italic', 'text-base-content/60'),
    );
    fireEvent.focus(menuButton());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Not equipped: Sword');
    expect(
      within(screen.getByRole('tooltip')).getByRole('link', { name: 'Sword' }),
    ).toHaveAttribute('href', `#inventory-${SWORD}`);
  });

  it('names a changed encumbrance level and skipped items in the switch toast', async () => {
    await seed([
      row(ANVIL, 'Anvil', { worn: false, weightLbs: 45 }),
      row('0193b3c0-f1f0-7000-8000-00000000f015', 'Arrows', { quantity: 0 }),
    ]);
    await getLocalDb().characterLoadouts.put(
      loadout(MELEE, 'Melee', [SWORD, ANVIL, '0193b3c0-f1f0-7000-8000-00000000f015'], 0),
    );
    await renderInventory();
    fireEvent.click(
      within(within(openMenu()).getByText('Melee').closest('li') as HTMLElement).getByRole(
        'menuitem',
        { name: 'Equip' },
      ),
    );
    expect(
      await screen.findByText(
        'Equipped Melee: 1 equipped, 1 moved. Skipped Arrows (quantity 0). Encumbrance now Medium.',
      ),
    ).toBeVisible();
  });

  it('creates, edits, reorders and deletes loadouts', async () => {
    await seed();
    await renderInventory();
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'New loadout' }));
    const editor = await screen.findByRole('region', { name: 'Loadout New loadout' });
    const name = within(editor).getByLabelText('Name');
    await waitFor(() => expect(name).toHaveFocus());
    expect(within(editor).getByRole('checkbox', { name: 'Sword' })).toBeChecked();
    expect(within(editor).getByRole('checkbox', { name: 'Bow' })).not.toBeChecked();
    expect(within(editor).getByText('On the player')).toBeVisible();
    expect(within(editor).getByText('Stashed')).toBeVisible();

    fireEvent.change(name, { target: { value: 'Travel' } });
    fireEvent.blur(name);
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Bow' }));
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Sword' }));
    const db = getLocalDb();
    await waitFor(async () => {
      const created = (await db.characterLoadouts.toArray()).find(
        (entry) => entry.name === 'Travel',
      );
      expect(created?.itemIds).toEqual([BOW]);
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('region', { name: /^Loadout / })).not.toBeInTheDocument();

    let menu = openMenu();
    fireEvent.keyDown(within(menu).getByRole('button', { name: 'Reorder Travel' }), {
      key: 'ArrowUp',
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole('menu', { name: 'Loadouts' }))
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['MeleeEquip', 'TravelEquip', 'ArcheryEquip', 'New loadout']),
    );
    expect(screen.getByRole('button', { name: 'Reorder Travel' })).toHaveFocus();

    menu = screen.getByRole('menu', { name: 'Loadouts' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit Archery' }));
    const archery = await screen.findByRole('region', { name: 'Loadout Archery' });
    fireEvent.click(within(archery).getByRole('button', { name: 'Delete loadout' }));
    expect(
      within(archery).getByText('Delete Archery? Its items stay in the inventory.'),
    ).toBeVisible();
    fireEvent.click(within(archery).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await db.characterLoadouts.get(ARCHERY)).toBeUndefined());
    expect(await db.characterInventory.get(BOW)).toBeDefined();
  });

  it('rolls a refused rename back in the editor with a flash', async () => {
    await seed();
    await renderInventory();
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Edit Melee' }));
    const editor = await screen.findByRole('region', { name: 'Loadout Melee' });
    const name = within(editor).getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Duel' } });
    fireEvent.blur(name);
    const db = getLocalDb();
    await waitFor(async () => expect((await db.characterLoadouts.get(MELEE))?.name).toBe('Duel'));
    // The orchestrator's rollback: restore the row, then flash the field.
    await db.characterLoadouts.update(MELEE, { name: 'Melee' });
    flashBus.emit({ key: `character_loadout:${MELEE}:name`, reason: 'denied' });
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: /^Loadout / })).getByLabelText('Name'),
      ).toHaveValue('Melee'),
    );
    expect(
      within(screen.getByRole('region', { name: /^Loadout / })).getByLabelText('Name'),
    ).toHaveAttribute('data-flashing', 'true');
  });

  it('shows loadouts without actions to read-only viewers', async () => {
    await seed();
    await renderInventory(false);
    const menu = openMenu();
    expect(within(menu).getByText('Melee')).toBeVisible();
    expect(within(menu).queryByRole('menuitem', { name: 'Equip' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'New loadout' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: /^Reorder/ })).not.toBeInTheDocument();
  });
});
