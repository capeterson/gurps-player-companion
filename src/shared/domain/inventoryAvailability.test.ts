import { describe, expect, it } from 'bun:test';
import {
  availableEquipment,
  inventoryAvailability,
  promotedInventoryLocation,
} from './inventoryAvailability.ts';

describe('inventoryAvailability', () => {
  it('inherits carried location from roots and requires every ancestor to have quantity', () => {
    const items = [
      {
        id: 'carried-pack',
        parentId: null,
        quantity: 1,
        worn: true,
        externalLocation: null,
        equipped: true,
      },
      {
        id: 'nested-weapon',
        parentId: 'carried-pack',
        quantity: 1,
        worn: false,
        externalLocation: null,
        equipped: true,
      },
      {
        id: 'stashed-pack',
        parentId: null,
        quantity: 1,
        worn: false,
        externalLocation: null,
        equipped: true,
      },
      {
        id: 'stashed-descendant',
        parentId: 'stashed-pack',
        quantity: 1,
        worn: true,
        externalLocation: null,
        equipped: true,
      },
      {
        id: 'external-pack',
        parentId: null,
        quantity: 1,
        worn: true,
        externalLocation: 'At home',
        equipped: true,
      },
      {
        id: 'external-descendant',
        parentId: 'external-pack',
        quantity: 1,
        worn: false,
        externalLocation: null,
        equipped: true,
      },
    ];
    const result = inventoryAvailability(items);
    expect(result.get('carried-pack')).toEqual({ carried: true, equipped: true });
    expect(result.get('nested-weapon')).toEqual({ carried: true, equipped: true });
    expect(result.get('stashed-descendant')).toEqual({ carried: false, equipped: false });
    expect(result.get('external-descendant')).toEqual({ carried: false, equipped: false });
    expect(availableEquipment(items).map(({ id }) => id)).toEqual([
      'carried-pack',
      'nested-weapon',
    ]);
  });

  it('excludes zero-quantity items and descendants from both carried and equipped availability', () => {
    const result = inventoryAvailability([
      {
        id: 'empty-pack',
        parentId: null,
        quantity: 0,
        worn: true,
        externalLocation: null,
        equipped: true,
      },
      {
        id: 'item-in-empty-pack',
        parentId: 'empty-pack',
        quantity: 1,
        worn: false,
        externalLocation: null,
        equipped: true,
      },
      {
        id: 'zero-item',
        parentId: null,
        quantity: 0,
        worn: true,
        externalLocation: null,
        equipped: true,
      },
      {
        id: 'unequipped',
        parentId: null,
        quantity: 1,
        worn: true,
        externalLocation: null,
        equipped: false,
      },
    ]);
    expect(result.get('empty-pack')).toEqual({ carried: false, equipped: false });
    expect(result.get('item-in-empty-pack')).toEqual({ carried: false, equipped: false });
    expect(result.get('zero-item')).toEqual({ carried: false, equipped: false });
    expect(result.get('unequipped')).toEqual({ carried: true, equipped: false });
  });

  it('fails closed for containment cycles', () => {
    const result = inventoryAvailability([
      { id: 'a', parentId: 'b', quantity: 1, worn: true, equipped: true },
      { id: 'b', parentId: 'a', quantity: 1, worn: true, equipped: true },
    ]);
    expect(result.get('a')).toEqual({ carried: false, equipped: false });
    expect(result.get('b')).toEqual({ carried: false, equipped: false });
  });
});

describe('promotedInventoryLocation', () => {
  it('copies the deleted carried root location when a nested child is promoted to root', () => {
    expect(
      promotedInventoryLocation({ parentId: null, worn: true, externalLocation: null }),
    ).toEqual({
      parentId: null,
      worn: true,
      externalLocation: null,
    });
  });

  it('preserves an external stash label when a root container is deleted', () => {
    expect(
      promotedInventoryLocation({ parentId: null, worn: false, externalLocation: 'At home' }),
    ).toEqual({
      parentId: null,
      worn: false,
      externalLocation: 'At home',
    });
  });

  it('does not overwrite location flags while a child remains nested', () => {
    expect(
      promotedInventoryLocation({
        parentId: 'outer-container',
        worn: false,
        externalLocation: null,
      }),
    ).toEqual({
      parentId: 'outer-container',
    });
  });
});
