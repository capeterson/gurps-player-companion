import { describe, expect, it } from 'vitest';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import { CATEGORY_LABELS } from './inventory/itemCategories.ts';
import {
  INVENTORY_OTHER_TYPE,
  buildTree,
  descendantsOf,
  eligibleContainers,
  filterInventoryTree,
  flattenDFS,
  inventoryCostTotals,
  inventoryTypeLabels,
  sortInventoryTree,
  validateReparent,
} from './inventoryTree.ts';

function weapon(): NonNullable<InventoryItemOut['weaponData']> {
  return {
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
}

function item(
  id: string,
  parentId: string | null,
  name: string,
  isContainer = false,
): InventoryItemOut {
  return {
    id,
    characterId: 'c1',
    name,
    quantity: 1,
    weightLbs: 0,
    cost: 0,
    notes: null,
    parentId,
    externalLocation: null,
    worn: false,
    equipped: false,
    isContainer,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    isArmor: false,
    armor: null,
    weaponData: null,
    powerstoneData: null,
    magicItemData: null,
    enchantments: [],
    libraryItemId: null,
    effectiveWeightLbs: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('buildTree', () => {
  it('groups items by parentId and sorts each bucket by name', () => {
    const items = [
      item('1', null, 'Sword'),
      item('2', null, 'Backpack', true),
      item('3', '2', 'Bedroll'),
      item('4', '2', 'Apple'),
    ];
    const { byParent, byId } = buildTree(items);
    expect(byId.size).toBe(4);
    expect(byParent.get(null)?.map((i) => i.name)).toEqual(['Backpack', 'Sword']);
    expect(byParent.get('2')?.map((i) => i.name)).toEqual(['Apple', 'Bedroll']);
  });

  it('promotes orphans to roots when their parent is missing from the set', () => {
    // Codex review on PR #22: deleting a container optimistically leaves
    // its children with a parentId that no longer resolves. Without
    // orphan recovery the children would vanish from the rendered tree
    // until the next sync. Surfacing them as roots keeps them visible
    // and editable in the meantime.
    const items = [
      item('a', null, 'Apple'),
      item('orphan', 'gone', 'Bedroll'),
      item('also-orphan', 'gone-too', 'Coin', true),
      item('child-of-orphan', 'also-orphan', 'Spike'),
    ];
    const { byParent } = buildTree(items);
    // Both orphans show up in the null bucket alongside the actual root.
    expect(
      byParent
        .get(null)
        ?.map((i) => i.id)
        .sort(),
    ).toEqual(['a', 'also-orphan', 'orphan']);
    // The orphan-with-children keeps its children attached.
    expect(byParent.get('also-orphan')?.map((i) => i.id)).toEqual(['child-of-orphan']);
    // The original (broken) parentIds are NOT in byParent.
    expect(byParent.get('gone')).toBeUndefined();
    expect(byParent.get('gone-too')).toBeUndefined();
  });
});

describe('flattenDFS', () => {
  it('walks roots in order, depth-first, including all descendants', () => {
    const items = [
      item('a', null, 'A'),
      item('b', null, 'B', true),
      item('c', 'b', 'C'),
      item('d', 'b', 'D', true),
      item('e', 'd', 'E'),
    ];
    const { byParent } = buildTree(items);
    const roots = byParent.get(null) ?? [];
    expect(flattenDFS(roots, byParent).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('filterInventoryTree', () => {
  it('keeps matching nested items and only the containers needed to reach them', () => {
    const items = [
      item('pack', null, 'Backpack', true),
      item('apple', 'pack', 'Apple'),
      item('pouch', 'pack', 'Small pouch', true),
      item('gem', 'pouch', 'Moon Gem'),
      item('sword', 'pack', 'Broadsword'),
      item('tent', null, 'Tent'),
    ];

    const filtered = filterInventoryTree(items, 'GEM');

    expect([...filtered.matchedIds]).toEqual(['gem']);
    expect(filtered.byParent.get(null)?.map((entry) => entry.id)).toEqual(['pack']);
    expect(filtered.byParent.get('pack')?.map((entry) => entry.id)).toEqual(['pouch']);
    expect(filtered.byParent.get('pouch')?.map((entry) => entry.id)).toEqual(['gem']);
    expect(filtered.byId.has('apple')).toBe(false);
    expect(filtered.byId.has('sword')).toBe(false);
    expect(filtered.byId.has('tent')).toBe(false);
  });

  it('does not reveal a matching container contents', () => {
    const pack = item('pack', null, 'Weapon pack', true);
    const sword = item('sword', 'pack', 'Broadsword');

    const matchingContainer = filterInventoryTree([pack, sword], 'pack');
    expect([...matchingContainer.matchedIds]).toEqual(['pack']);
    expect(matchingContainer.byParent.get('pack')).toBeUndefined();
  });
});

describe('inventoryTypeLabels', () => {
  it('uses the item category labels and falls back to Other', () => {
    const sword = item('sword', null, 'Broadsword');
    sword.weaponData = weapon();
    sword.enchantments = [{ spellName: 'Puissance' } as InventoryItemOut['enchantments'][number]];
    const rope = item('rope', null, 'Rope');
    expect(inventoryTypeLabels(sword)).toEqual([
      CATEGORY_LABELS.weapon,
      CATEGORY_LABELS.enchantments,
    ]);
    expect(inventoryTypeLabels(rope)).toEqual([INVENTORY_OTHER_TYPE]);
  });

  it('offers every category the item editor can add', () => {
    const everything = item('box', null, 'Everything box', true);
    everything.isArmor = true;
    everything.weaponData = weapon();
    everything.powerstoneData = { maxEnergy: 5, currentEnergy: 0 };
    everything.magicItemData = {
      spellName: 'Light',
      spellSkillLevel: 15,
      mode: 'charged',
      chargesMax: 1,
      chargesCurrent: 1,
    } as InventoryItemOut['magicItemData'];
    everything.enchantments = [
      { spellName: 'Fortify' } as InventoryItemOut['enchantments'][number],
    ];
    expect(inventoryTypeLabels(everything).sort()).toEqual(Object.values(CATEGORY_LABELS).sort());
  });
});

describe('inventoryCostTotals', () => {
  it('totals price × quantity plus the full value of nested contents', () => {
    const pack = { ...item('pack', null, 'Pack', true), cost: 60 };
    const pouch = { ...item('pouch', 'pack', 'Pouch', true), cost: 10, quantity: 1 };
    const coins = { ...item('coins', 'pouch', 'Coins'), cost: 2, quantity: 40 };
    const rations = { ...item('rations', 'pack', 'Rations'), cost: 2, quantity: 6 };
    const totals = inventoryCostTotals([pack, pouch, coins, rations]);
    expect(totals.get('coins')).toBe(80);
    expect(totals.get('pouch')).toBe(90);
    expect(totals.get('pack')).toBe(60 + 90 + 12);
  });
});

describe('sortInventoryTree', () => {
  const pack = { ...item('pack', null, 'Pack', true), cost: 60, quantity: 1 };
  const gem = { ...item('gem', 'pack', 'Gem'), cost: 500, quantity: 1 };
  const apple = { ...item('apple', 'pack', 'Apple'), cost: 1, quantity: 3 };
  const tent = { ...item('tent', null, 'Tent'), cost: 80, quantity: 1 };
  const bolts = { ...item('bolts', null, 'Bolts'), cost: 2, quantity: 20 };
  const items = [pack, gem, apple, tent, bolts];
  const totals = inventoryCostTotals(items);
  const ids = (byParent: Map<string | null, InventoryItemOut[]>, parent: string | null) =>
    byParent.get(parent)?.map((entry) => entry.id);

  it('sorts roots and each container by total cost, keeping contents with their container', () => {
    const { byParent } = buildTree(items);
    const ascending = sortInventoryTree(byParent, 'cost', false, false, totals);
    expect(ids(ascending, null)).toEqual(['bolts', 'tent', 'pack']);
    expect(ids(ascending, 'pack')).toEqual(['apple', 'gem']);
    const descending = sortInventoryTree(byParent, 'cost', true, false, totals);
    expect(ids(descending, null)).toEqual(['pack', 'tent', 'bolts']);
    expect(ids(descending, 'pack')).toEqual(['gem', 'apple']);
  });

  it('falls back to item name for equal values', () => {
    const { byParent } = buildTree(items);
    const byQty = sortInventoryTree(byParent, 'qty', false, false, totals);
    expect(ids(byQty, null)).toEqual(['pack', 'tent', 'bolts']);
    const byName = sortInventoryTree(byParent, 'item', true, false, totals);
    expect(ids(byName, null)).toEqual(['tent', 'pack', 'bolts']);
  });
});

describe('descendantsOf', () => {
  it('returns all transitive children of a container', () => {
    const items = [
      item('root', null, 'Pack', true),
      item('mid', 'root', 'Pouch', true),
      item('leaf', 'mid', 'Coin'),
    ];
    const { byParent } = buildTree(items);
    expect([...descendantsOf('root', byParent)].sort()).toEqual(['leaf', 'mid']);
  });
});

describe('eligibleContainers', () => {
  it('excludes the item itself, its descendants, and non-container items', () => {
    const items = [
      item('pack', null, 'Pack', true),
      item('belt', null, 'Belt', true),
      item('sword', null, 'Sword'),
      item('pouch', 'pack', 'Pouch', true),
    ];
    expect(eligibleContainers(items, 'pack').map((i) => i.id)).toEqual(['belt']);
  });
});

describe('validateReparent', () => {
  it('rejects self-drop', () => {
    const { byParent } = buildTree([item('x', null, 'X', true)]);
    expect(validateReparent('x', 'x', byParent).ok).toBe(false);
  });

  it('rejects dropping a container into its own descendant', () => {
    const items = [item('outer', null, 'Outer', true), item('inner', 'outer', 'Inner', true)];
    const { byParent } = buildTree(items);
    expect(validateReparent('outer', 'inner', byParent).ok).toBe(false);
  });

  it('accepts a normal sibling reparent', () => {
    const items = [item('a', null, 'A'), item('b', null, 'B', true)];
    const { byParent } = buildTree(items);
    expect(validateReparent('a', 'b', byParent).ok).toBe(true);
  });

  it('accepts dropping to root', () => {
    const items = [item('a', 'b', 'A'), item('b', null, 'B', true)];
    const { byParent } = buildTree(items);
    expect(validateReparent('a', null, byParent).ok).toBe(true);
  });
});
