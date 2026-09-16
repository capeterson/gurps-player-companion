import { describe, expect, it } from 'vitest';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import {
  buildTree,
  descendantsOf,
  eligibleContainers,
  filterInventoryTree,
  flattenDFS,
  validateReparent,
} from './inventoryTree.ts';

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

    const filtered = filterInventoryTree(items, 'GEM', 'all');

    expect([...filtered.matchedIds]).toEqual(['gem']);
    expect(filtered.byParent.get(null)?.map((entry) => entry.id)).toEqual(['pack']);
    expect(filtered.byParent.get('pack')?.map((entry) => entry.id)).toEqual(['pouch']);
    expect(filtered.byParent.get('pouch')?.map((entry) => entry.id)).toEqual(['gem']);
    expect(filtered.byId.has('apple')).toBe(false);
    expect(filtered.byId.has('sword')).toBe(false);
    expect(filtered.byId.has('tent')).toBe(false);
  });

  it('combines name and tag filters without revealing a matching container contents', () => {
    const pack = item('pack', null, 'Weapon pack', true);
    const sword = item('sword', 'pack', 'Broadsword');
    sword.weaponData = {
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
    const armor = item('armor', 'pack', 'Weapon harness');
    armor.isArmor = true;

    const weapons = filterInventoryTree([pack, sword, armor], 'sword', 'weapon');
    expect([...weapons.matchedIds]).toEqual(['sword']);
    expect(weapons.byParent.get(null)?.map((entry) => entry.id)).toEqual(['pack']);
    expect(weapons.byParent.get('pack')?.map((entry) => entry.id)).toEqual(['sword']);

    const matchingContainer = filterInventoryTree([pack, sword, armor], 'pack', 'container');
    expect([...matchingContainer.matchedIds]).toEqual(['pack']);
    expect(matchingContainer.byParent.get('pack')).toBeUndefined();
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
