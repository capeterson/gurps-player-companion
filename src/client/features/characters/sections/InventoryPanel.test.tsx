import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import { getLocalDb, resetLocalDb } from '../../../db/dexie.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { InventoryPanel } from './InventoryPanel.tsx';

const CHARACTER_ID = '0193b3c0-f1f0-7000-8000-00000000c101';
const PACK_ID = '0193b3c0-f1f0-7000-8000-00000000c102';

function item(
  id: string,
  name: string,
  parentId: string | null,
  options: { container?: boolean; weapon?: boolean; worn?: boolean; equipped?: boolean } = {},
): InventoryItemOut {
  return {
    id,
    characterId: CHARACTER_ID,
    name,
    quantity: 1,
    weightLbs: 1,
    cost: 1,
    notes: null,
    parentId,
    externalLocation: null,
    worn: options.worn ?? parentId === null,
    equipped: options.equipped ?? false,
    isContainer: options.container ?? false,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    isArmor: false,
    armor: null,
    weaponData: options.weapon
      ? {
          damage: 'sw+1 cut',
          reach: '1',
          parry: '0',
          stRequired: 10,
          skill: 'Broadsword',
          db: null,
          ranged: null,
          notes: null,
          alternateModes: [],
        }
      : null,
    powerstoneData: null,
    magicItemData: null,
    enchantments: [],
    libraryItemId: null,
    effectiveWeightLbs: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function renderPanel(
  anchorItemId?: string,
  options: {
    canWrite?: boolean;
    inventory?: InventoryItemOut[];
    onDismissAnchor?: () => void;
  } = {},
) {
  const inventory = options.inventory ?? [
    item(PACK_ID, 'Backpack', null, { container: true }),
    item('apple', 'Apple', PACK_ID),
    item('pouch', 'Small pouch', PACK_ID, { container: true }),
    item('gem', 'Moon Gem', 'pouch'),
    item('sword', 'Broadsword', PACK_ID, { weapon: true }),
    item('tent', 'Tent', null, { worn: false }),
  ];
  const character = {
    id: CHARACTER_ID,
    campaignId: null,
    inventory,
    skills: [],
    libraryEffectsKnown: true,
    encumbrance: { playerWeightLbs: 0, basicLift: 20, level: 0 },
  } as unknown as CharacterDetail;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The sheet clears its URL hash when the panel dismisses a deep link.
  function Sheet() {
    const [anchor, setAnchor] = useState(anchorItemId ?? null);
    return (
      <>
        <button type="button">Outside the inventory</button>
        <InventoryPanel
          character={character}
          canWrite={options.canWrite ?? false}
          anchorItemId={anchor}
          onDismissAnchor={() => {
            options.onDismissAnchor?.();
            setAnchor(null);
          }}
        />
      </>
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Sheet />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function row(name: string): HTMLElement {
  const element = screen.getByText(name, { exact: true }).closest('tr');
  if (!element) throw new Error(`Expected a row for ${name}`);
  return element;
}

beforeEach(async () => {
  await resetLocalDb();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('Inventory location and equipment controls', () => {
  it('shows the Armor category icon when armor details are incomplete', () => {
    const incompleteArmor = {
      ...item('incomplete-armor', 'Incomplete coat', null),
      isArmor: true,
    };
    renderPanel(undefined, { inventory: [incompleteArmor] });

    const armorIcon = screen.getByRole('button', { name: 'Armor for Incomplete coat' });
    expect(armorIcon).toBeVisible();
    fireEvent.mouseEnter(armorIcon);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Armor');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('DR');
  });

  it('uses location instead of a Worn state and stores carried status from the selected location', async () => {
    const db = getLocalDb();
    await db.characterInventory.put({
      ...item(PACK_ID, 'Backpack', null, { container: true }),
      revision: 1,
    });
    renderPanel(undefined, { canWrite: true });

    expect(screen.queryByText('Worn', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Worn' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Add item' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add item' });
    expect(dialog).toHaveAttribute('open');
    const location = screen.getByRole('combobox', { name: 'Location' });
    expect(location).toHaveValue('');
    expect(within(location).getByRole('option', { name: 'On the player' })).toHaveValue('');
    expect(within(location).getByRole('option', { name: 'Stashed' })).toHaveValue('stashed');
    expect(within(location).getByRole('option', { name: 'in Backpack' })).toHaveValue(PACK_ID);

    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Carried knife' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    await waitFor(() => expect(dialog).not.toHaveAttribute('open'));
    const carriedOp = (await db.outbox.toArray()).find(
      (op) => (op.attemptedValue as { name?: string }).name === 'Carried knife',
    );
    expect(carriedOp?.attemptedValue).toMatchObject({
      name: 'Carried knife',
      parentId: null,
      worn: true,
      equipped: false,
    });
    expect(await db.characterInventory.get(carriedOp?.entityId ?? '')).toMatchObject({
      name: 'Carried knife',
      worn: true,
      equipped: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Stored knife' } });
    fireEvent.change(location, { target: { value: 'stashed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect(await db.outbox.count()).toBe(2));
    const stashedOp = (await db.outbox.toArray()).find(
      (op) => (op.attemptedValue as { name?: string }).name === 'Stored knife',
    );
    expect(stashedOp?.attemptedValue).toMatchObject({
      name: 'Stored knife',
      parentId: null,
      worn: false,
      equipped: false,
    });
    expect(await db.characterInventory.get(stashedOp?.entityId ?? '')).toMatchObject({
      name: 'Stored knife',
      worn: false,
      equipped: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Packed knife' } });
    fireEvent.change(location, { target: { value: PACK_ID } });
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(within(dialog).getByLabelText('Equipped')).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect(await db.outbox.count()).toBe(3));
    const packedOp = (await db.outbox.toArray()).find(
      (op) => (op.attemptedValue as { name?: string }).name === 'Packed knife',
    );
    expect(packedOp?.attemptedValue).toMatchObject({
      name: 'Packed knife',
      parentId: PACK_ID,
      worn: false,
      equipped: false,
    });
    expect(await db.characterInventory.get(packedOp?.entityId ?? '')).toMatchObject({
      name: 'Packed knife',
      parentId: PACK_ID,
      worn: false,
      equipped: false,
    });
  });

  it('clears Equipped when a selected item moves to Stashed', async () => {
    const sword = item('equipped-sword', 'Equipped sword', null, { weapon: true, equipped: true });
    await getLocalDb().characterInventory.put({ ...sword, revision: 1 });
    renderPanel(undefined, { canWrite: true, inventory: [sword] });
    fireEvent.click(screen.getByText('Equipped sword'));
    fireEvent.click(screen.getByRole('button', { name: 'Move to ▾' }));
    fireEvent.click(screen.getByRole('button', { name: /Stashed/ }));
    await waitFor(async () => {
      expect(await getLocalDb().characterInventory.get(sword.id)).toMatchObject({
        worn: false,
        equipped: false,
      });
    });
    const ops = (await getLocalDb().outbox.orderBy('enqueuedAt').toArray()).map((op) => [
      op.fieldPath,
      op.attemptedValue,
    ]);
    expect(ops).toEqual(
      expect.arrayContaining([
        ['worn', false],
        ['equipped', false],
      ]),
    );
    // The unequip is sent before the move, which the server would otherwise
    // answer by unequipping first and making this patch stale.
    expect(ops.findIndex(([field]) => field === 'equipped')).toBeLessThan(
      ops.findIndex(([field]) => field === 'worn'),
    );
  });

  it('only offers Equipped in the add form for a location on the player', async () => {
    const db = getLocalDb();
    const stashedChest = item('chest', 'Chest', null, { container: true, worn: false });
    await db.characterInventory.bulkPut([
      { ...item(PACK_ID, 'Backpack', null, { container: true }), revision: 1 },
      { ...stashedChest, revision: 1 },
    ]);
    renderPanel(undefined, {
      canWrite: true,
      inventory: [item(PACK_ID, 'Backpack', null, { container: true }), stashedChest],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add item' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'More options' }));
    const equipped = within(dialog).getByRole('checkbox', { name: 'Equipped' });
    fireEvent.click(equipped);
    expect(equipped).toBeChecked();
    expect(within(dialog).queryByText('Only items on the player can be equipped.')).toBeNull();

    const location = within(dialog).getByRole('combobox', { name: 'Location' });
    fireEvent.change(location, { target: { value: 'chest' } });
    expect(equipped).toBeDisabled();
    expect(equipped).not.toBeChecked();
    expect(within(dialog).getByText('Only items on the player can be equipped.')).toBeVisible();
    fireEvent.change(location, { target: { value: PACK_ID } });
    expect(equipped).toBeEnabled();
    expect(equipped).toBeChecked();

    fireEvent.change(location, { target: { value: 'stashed' } });
    fireEvent.change(within(dialog).getByLabelText('Item name'), {
      target: { value: 'Spare shield' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    expect((await db.outbox.toArray())[0]?.attemptedValue).toMatchObject({
      name: 'Spare shield',
      worn: false,
      equipped: false,
    });
  });
});

describe('Inventory selection dismissal', () => {
  it('collapsing a container deselects its contents and clears a deep link inside it', () => {
    const onDismissAnchor = vi.fn();
    renderPanel('gem', { canWrite: true, onDismissAnchor });
    expect(row('Moon Gem')).toHaveClass('outline-primary');
    fireEvent.click(screen.getByText('Apple', { exact: true }));
    expect(row('Apple')).toHaveAttribute('aria-selected', 'true');

    const backpack = row('Backpack');
    fireEvent.click(within(backpack).getByRole('button', { name: 'Collapse contents' }));

    expect(onDismissAnchor).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Apple', { exact: true })).not.toBeVisible();
    expect(screen.getByText('Moon Gem', { exact: true })).not.toBeVisible();
    expect(within(backpack).getByLabelText('4 contained items')).toBeVisible();
    fireEvent.click(within(backpack).getByRole('button', { name: 'Expand contents' }));
    expect(row('Apple')).toHaveAttribute('aria-selected', 'false');
    expect(row('Moon Gem')).not.toHaveClass('outline-primary');
  });

  it('keeps a selection outside the collapsed container', () => {
    renderPanel(undefined, { canWrite: true });
    const backpack = row('Backpack');
    fireEvent.click(within(backpack).getByRole('button', { name: 'Expand contents' }));
    fireEvent.click(screen.getByText('Tent', { exact: true }));
    fireEvent.click(screen.getByText('Apple', { exact: true }), { ctrlKey: true });
    expect(screen.getByText('2 selected')).toBeVisible();
    fireEvent.click(within(backpack).getByRole('button', { name: 'Collapse contents' }));
    expect(screen.getByText('1 selected')).toBeVisible();
    expect(row('Tent')).toHaveAttribute('aria-selected', 'true');
  });

  it('a press outside the panel clears the selection and a deep-link highlight', () => {
    const onDismissAnchor = vi.fn();
    renderPanel('tent', { canWrite: true, onDismissAnchor });
    fireEvent.click(screen.getByText('Backpack', { exact: true }));
    expect(screen.getByText('1 selected')).toBeVisible();

    // Presses inside the panel, including its toolbar, keep the selection.
    fireEvent.pointerDown(screen.getByRole('searchbox', { name: 'Filter inventory' }));
    expect(screen.getByText('1 selected')).toBeVisible();
    expect(onDismissAnchor).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside the inventory' }));
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
    expect(row('Backpack')).toHaveAttribute('aria-selected', 'false');
    expect(onDismissAnchor).toHaveBeenCalledTimes(1);
    expect(row('Tent')).not.toHaveClass('outline-primary');
  });
});

describe('Inventory group by type', () => {
  function openItemTypeMenu(tableName: string) {
    const table = screen.getByRole('table', { name: tableName });
    const heading = within(table).getByRole('button', { name: 'Sort by Item' }).closest('th');
    if (!heading) throw new Error('Item heading missing');
    fireEvent.contextMenu(heading);
    return screen.getByRole('dialog', { name: 'Filter Item type' });
  }

  it('groups each list into folding type sections that are not containers', () => {
    const first = renderPanel(undefined, { canWrite: true });
    const menu = openItemTypeMenu('Carried inventory');
    const toggle = within(menu).getByRole('switch', { name: 'Group by type' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    fireEvent.click(within(menu).getByRole('button', { name: 'Close filter' }));

    const carried = screen.getByRole('table', { name: 'Carried inventory' });
    expect(
      within(carried)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(['Container', 'Weapon', 'Other']);
    // Nested items are listed in their own type with their container named.
    expect(within(row('Broadsword')).getByText('in Backpack')).toBeVisible();
    expect(within(row('Moon Gem')).getByText('in Small pouch')).toBeVisible();
    expect(within(carried).queryByRole('button', { name: 'Expand contents' })).toBeNull();
    // The other list keeps its own choice.
    const stashed = screen.getByRole('table', { name: 'Stashed inventory' });
    expect(within(stashed).queryAllByRole('rowheader')).toHaveLength(0);

    fireEvent.click(screen.getByText('Broadsword', { exact: true }));
    fireEvent.click(screen.getByText('Apple', { exact: true }), { ctrlKey: true });
    expect(screen.getByText('2 selected')).toBeVisible();
    fireEvent.click(within(carried).getByRole('button', { name: 'Collapse Weapon' }));
    expect(screen.getByText('Broadsword', { exact: true })).not.toBeVisible();
    expect(within(carried).getByLabelText('1 item')).toBeVisible();
    expect(screen.getByText('1 selected')).toBeVisible();
    expect(row('Apple')).toHaveAttribute('aria-selected', 'true');

    first.unmount();
    renderPanel(undefined, { canWrite: true });
    const remembered = screen.getByRole('table', { name: 'Carried inventory' });
    expect(within(remembered).getAllByRole('rowheader')).toHaveLength(3);
    expect(screen.getByText('Broadsword', { exact: true })).not.toBeVisible();
    expect(within(remembered).getByRole('button', { name: 'Expand Weapon' })).toBeVisible();
  });

  it('reveals a deep-linked item in a collapsed section and shows only search matches', () => {
    window.localStorage.setItem(`gurps:inventoryGroupByType:${CHARACTER_ID}:worn`, 'true');
    window.localStorage.setItem(
      `gpc:inventory-type-group-expanded:${CHARACTER_ID}:worn:Other`,
      'false',
    );
    const linked = renderPanel('gem');
    expect(screen.getByText('Moon Gem', { exact: true })).toBeVisible();
    linked.unmount();

    renderPanel();
    expect(screen.getByText('Moon Gem', { exact: true })).not.toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter inventory' }), {
      target: { value: 'gem' },
    });
    const carried = screen.getByRole('table', { name: 'Carried inventory' });
    expect(screen.getByText('Moon Gem', { exact: true })).toBeVisible();
    expect(screen.queryByText('Backpack', { exact: true })).not.toBeInTheDocument();
    expect(
      within(carried)
        .getAllByRole('rowheader')
        .filter((header) => !header.closest('tbody')?.hidden)
        .map((header) => header.textContent),
    ).toEqual(['Other']);
  });
});

describe('Inventory container disclosure', () => {
  it('reveals a linked item through nested closed containers', () => {
    renderPanel('gem');
    expect(screen.getByText('Backpack')).toBeVisible();
    expect(screen.getByText('Small pouch')).toBeVisible();
    expect(screen.getByText('Moon Gem').closest('tr')).toHaveAttribute('id', 'inventory-gem');
    expect(screen.getByText('Apple')).toBeVisible();
  });
  it('starts collapsed and reports every recursively contained item', () => {
    renderPanel();

    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
    expect(screen.queryByText('Small pouch')).not.toBeInTheDocument();
    expect(screen.getByText('Backpack')).toBeVisible();
    expect(screen.getByLabelText('4 contained items')).toHaveTextContent('4 items');
  });

  it('excludes stashed equipment from the carried encumbrance total', () => {
    renderPanel();

    expect(screen.getByText(/^0 lbs$/)).toBeVisible();
    expect(screen.getByRole('table', { name: 'Carried inventory' })).toContainElement(
      screen.getByText('Backpack'),
    );
    expect(screen.getByRole('table', { name: 'Stashed inventory' })).toContainElement(
      screen.getByText('Tent'),
    );
    expect(screen.getByText(/^1(?:\.0)? lb$/)).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Worn inventory' })).not.toBeInTheDocument();
  });

  it('remembers expansion on this device without forcing nested containers open', () => {
    const first = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Expand contents' }));

    expect(screen.getByText('Apple')).toBeVisible();
    expect(screen.getByText('Small pouch')).toBeVisible();
    expect(screen.queryByText('Moon Gem')).not.toBeInTheDocument();
    expect(screen.getByLabelText('1 contained item')).toHaveTextContent('1 item');

    first.unmount();
    renderPanel();
    expect(screen.getByText('Small pouch')).toBeVisible();
    expect(screen.queryByText('Moon Gem')).not.toBeInTheDocument();
  });
});

describe('InventoryPanel filtering', () => {
  it('shows matches and ancestor containers while hiding unrelated contents', () => {
    renderPanel();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter inventory' }), {
      target: { value: 'gem' },
    });

    expect(screen.getByText('Backpack')).toBeVisible();
    expect(screen.getByText('Small pouch')).toBeVisible();
    expect(screen.getByText('Moon Gem')).toBeVisible();
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
    expect(screen.queryByText('Broadsword')).not.toBeInTheDocument();
    expect(screen.queryByText('Tent')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 6')).toBeVisible();
  });

  it('filters by item type from the Item heading with the same ancestor-only hierarchy', () => {
    renderPanel();
    const carried = screen.getByRole('table', { name: 'Carried inventory' });

    const itemHeading = within(carried).getByRole('button', { name: 'Sort by Item' }).closest('th');
    if (!itemHeading) throw new Error('Item heading missing');
    fireEvent.contextMenu(itemHeading);
    const menu = screen.getByRole('dialog', { name: 'Filter Item type' });
    expect(
      within(menu)
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent),
    ).toEqual(['Container', 'Other', 'Weapon']);
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Weapon' }));

    expect(screen.getByText('Backpack')).toBeVisible();
    expect(screen.getByText('Broadsword')).toBeVisible();
    expect(screen.queryByText('Apple')).not.toBeVisible();
    expect(screen.queryByText('Small pouch')).not.toBeVisible();
    expect(screen.getByText('1 column filter active')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Filter inventory by tag' })).toBeNull();
  });

  it('keeps only the matching nested branch and its visible ancestors during search', () => {
    const inventory = [
      item('pack', 'Travel pack', null, { container: true }),
      item('case', 'Map case', 'pack', { container: true }),
      item('charts', 'Coastal charts', 'case'),
      item('rations', 'Trail rations', 'case'),
      item('unrelated', 'Spare gloves', 'pack'),
      item('sword', 'Broadsword', null, { weapon: true }),
    ];
    renderPanel(undefined, { inventory });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter inventory' }), {
      target: { value: 'Trail rations' },
    });

    expect(screen.getByText('Travel pack')).toBeVisible();
    expect(screen.getByText('Map case')).toBeVisible();
    expect(screen.getByText('Trail rations')).toBeVisible();
    expect(screen.queryByText('Coastal charts')).not.toBeInTheDocument();
    expect(screen.queryByText('Spare gloves')).not.toBeInTheDocument();
    expect(screen.queryByText('Broadsword')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 6')).toBeVisible();
  });

  it('deselects nested items but retains an open editor when an ancestor is collapsed', () => {
    const pouchWeapon = item('gem', 'Moon Gem', 'pouch', { weapon: true });
    pouchWeapon.weaponData = {
      damage: 'sw+1 cut',
      reach: '1',
      parry: '0',
      stRequired: 10,
      skill: 'Broadsword',
      db: null,
      ranged: null,
      notes: null,
      alternateModes: [],
    };
    const inventory = [
      item('pack', 'Backpack', null, { container: true }),
      item('apple', 'Apple', 'pack'),
      item('pouch', 'Small pouch', 'pack', { container: true }),
      pouchWeapon,
      item('sword', 'Broadsword', null, { weapon: true }),
    ];
    renderPanel(undefined, { canWrite: true, inventory });

    const packRow = screen.getByText('Backpack', { exact: true }).closest('tr');
    expect(packRow).not.toBeNull();
    if (!packRow) throw new Error('Expected root container summary row');
    fireEvent.click(within(packRow).getByRole('button', { name: 'Expand contents' }));
    const pouchRow = screen.getByText('Small pouch', { exact: true }).closest('tr');
    expect(pouchRow).not.toBeNull();
    if (!pouchRow) throw new Error('Expected nested container summary row');
    fireEvent.click(within(pouchRow).getByRole('button', { name: 'Expand contents' }));
    const gemRow = screen.getByText('Moon Gem', { exact: true }).closest('tr');
    expect(gemRow).not.toBeNull();
    if (!gemRow) throw new Error('Expected nested weapon summary row');
    fireEvent.click(screen.getByText('Moon Gem', { exact: true }));
    expect(gemRow).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Weapon settings for Moon Gem' }));
    const editor = screen.getByRole('region', { name: 'Moon Gem: Weapon' });
    expect(editor).toBeVisible();
    expect(screen.getByLabelText('Damage', { exact: true })).toHaveValue('sw+1 cut');
    fireEvent.change(screen.getByLabelText('Damage', { exact: true }), {
      target: { value: 'sw+2 cut' },
    });
    expect(screen.getByLabelText('Damage', { exact: true })).toHaveValue('sw+2 cut');

    fireEvent.click(within(packRow).getByRole('button', { name: 'Collapse contents' }));
    expect(editor).not.toBeVisible();
    fireEvent.click(within(packRow).getByRole('button', { name: 'Expand contents' }));

    expect(gemRow).toBeVisible();
    expect(gemRow).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('region', { name: 'Moon Gem: Weapon' })).toBeVisible();
    expect(screen.getByLabelText('Damage', { exact: true })).toHaveValue('sw+2 cut');
  });
});

describe('InventoryPanel sorting and range filters', () => {
  const priced = (
    id: string,
    name: string,
    quantity: number,
    cost: number,
    weight: number,
    worn = true,
  ) => ({
    ...item(id, name, null, { worn }),
    quantity,
    cost,
    weightLbs: weight,
    effectiveWeightLbs: weight * quantity,
  });
  const inventory = [
    priced('sword', 'Broadsword', 1, 500, 3),
    priced('bolts', 'Crossbow bolts', 20, 2, 0.06),
    priced('rations', 'Rations', 6, 2, 0.5),
    priced('tent', 'Tent', 1, 80, 12, false),
    priced('bedroll', 'Bedroll', 1, 25, 7, false),
  ];
  const names = (table: HTMLElement) =>
    within(table)
      .getAllByRole('row')
      .filter((row) => row.classList.contains('inventory-item-row') && !row.hidden)
      .map((row) => row.querySelector('.inventory-item-title')?.textContent);

  it('sorts each list independently by the clicked column and reverses on a second click', () => {
    renderPanel(undefined, { inventory });
    const carried = screen.getByRole('table', { name: 'Carried inventory' });
    const stashed = screen.getByRole('table', { name: 'Stashed inventory' });
    expect(names(carried)).toEqual(['Broadsword', 'Crossbow bolts', 'Rations']);

    fireEvent.click(within(carried).getByRole('button', { name: 'Sort by Cost' }));
    // Cost sorts by price × quantity: 12, 40, 500.
    expect(names(carried)).toEqual(['Rations', 'Crossbow bolts', 'Broadsword']);
    expect(within(carried).getByRole('columnheader', { name: /Cost/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(within(carried).getByText('40')).toBeVisible();
    // Rations and bolts both cost 2 each.
    expect(within(carried).getAllByText('2 ea')).toHaveLength(2);

    fireEvent.click(within(carried).getByRole('button', { name: 'Sort by Cost' }));
    expect(names(carried)).toEqual(['Broadsword', 'Crossbow bolts', 'Rations']);
    expect(within(carried).getByRole('columnheader', { name: /Cost/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(names(stashed)).toEqual(['Bedroll', 'Tent']);

    fireEvent.click(within(stashed).getByRole('button', { name: 'Sort by Wt' }));
    fireEvent.click(within(stashed).getByRole('button', { name: 'Sort by Wt' }));
    expect(names(stashed)).toEqual(['Tent', 'Bedroll']);
    expect(names(carried)).toEqual(['Broadsword', 'Crossbow bolts', 'Rations']);
  });

  it('remembers each list sort on this device', () => {
    const first = renderPanel(undefined, { inventory });
    const carried = screen.getByRole('table', { name: 'Carried inventory' });
    fireEvent.click(within(carried).getByRole('button', { name: 'Sort by Qty' }));
    first.unmount();

    renderPanel(undefined, { inventory });
    expect(names(screen.getByRole('table', { name: 'Carried inventory' }))).toEqual([
      'Broadsword',
      'Rations',
      'Crossbow bolts',
    ]);
    expect(names(screen.getByRole('table', { name: 'Stashed inventory' }))).toEqual([
      'Bedroll',
      'Tent',
    ]);
  });

  it('filters quantity with a range from zero to the list maximum', () => {
    renderPanel(undefined, { inventory });
    const carried = screen.getByRole('table', { name: 'Carried inventory' });

    fireEvent.contextMenu(within(carried).getByRole('columnheader', { name: /Qty/ }));
    const menu = screen.getByRole('dialog', { name: 'Filter Qty' });
    const maximum = within(menu).getByRole('slider', { name: 'Maximum Qty' });
    expect(maximum).toHaveAttribute('max', '20');
    expect(within(menu).getByText('All values shown')).toBeVisible();

    fireEvent.change(maximum, { target: { value: '6' } });
    expect(names(carried)).toEqual(['Broadsword', 'Rations']);
    expect(within(menu).getByText('0 to 6')).toBeVisible();

    const minimum = within(menu).getByRole('spinbutton', { name: 'Minimum Qty value' });
    fireEvent.change(minimum, { target: { value: '2' } });
    fireEvent.blur(minimum);
    expect(names(carried)).toEqual(['Rations']);

    fireEvent.click(within(menu).getByRole('button', { name: 'Clear column filter' }));
    expect(names(carried)).toEqual(['Broadsword', 'Crossbow bolts', 'Rations']);
    expect(names(screen.getByRole('table', { name: 'Stashed inventory' }))).toEqual([
      'Bedroll',
      'Tent',
    ]);
  });
});
