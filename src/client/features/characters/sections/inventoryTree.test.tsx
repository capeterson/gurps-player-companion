import { describe, expect, it } from 'vitest';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import {
  buildTree,
  descendantsOf,
  eligibleContainers,
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
