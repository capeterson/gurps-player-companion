import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  options: { canWrite?: boolean; inventory?: InventoryItemOut[] } = {},
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
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <InventoryPanel
          character={character}
          canWrite={options.canWrite ?? false}
          anchorItemId={anchorItemId ?? null}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
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
    expect(
      within(screen.getByRole('combobox', { name: 'Filter inventory by tag' })).queryByRole(
        'option',
        { name: 'Worn' },
      ),
    ).not.toBeInTheDocument();

    const location = screen.getByRole('combobox', { name: 'Location' });
    expect(location).toHaveValue('');
    expect(within(location).getByRole('option', { name: 'On the player' })).toHaveValue('');
    expect(within(location).getByRole('option', { name: 'Stashed' })).toHaveValue('stashed');
    expect(within(location).getByRole('option', { name: 'in Backpack' })).toHaveValue(PACK_ID);

    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Carried knife' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
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

    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Stored knife' } });
    fireEvent.change(location, { target: { value: 'stashed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
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

    fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Packed knife' } });
    fireEvent.change(location, { target: { value: PACK_ID } });
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByLabelText('Equipped')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
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
    expect(
      (await getLocalDb().outbox.toArray()).map((op) => [op.fieldPath, op.attemptedValue]),
    ).toEqual(
      expect.arrayContaining([
        ['worn', false],
        ['equipped', false],
      ]),
    );
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

  it('filters by item tag with the same ancestor-only hierarchy', () => {
    renderPanel();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter inventory by tag' }), {
      target: { value: 'weapon' },
    });

    expect(screen.getByText('Backpack')).toBeVisible();
    expect(screen.getByText('Broadsword')).toBeVisible();
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
    expect(screen.queryByText('Small pouch')).not.toBeInTheDocument();
    expect(screen.queryByText('Moon Gem')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 6')).toBeVisible();
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

  it('retains nested selection and an open editor when an ancestor is collapsed', () => {
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
    expect(gemRow).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Moon Gem: Weapon' })).toBeVisible();
    expect(screen.getByLabelText('Damage', { exact: true })).toHaveValue('sw+2 cut');
  });
});
