import { describe, expect, it } from 'bun:test';
import { equipmentSwitch } from '../schemas/loadout.ts';
import {
  type LoadoutInventoryItem,
  equipmentSwitchProblem,
  equipmentSwitchUpdates,
  loadoutDelta,
  loadoutMoveUpdates,
  nextLoadoutSortOrder,
  planLastEquippedRestore,
  planLoadoutSwitch,
  sortLoadouts,
} from './loadouts.ts';

const NOW = '2026-10-19T12:00:00.000Z';
const ids = {
  sword: '00000000-0000-4000-8000-000000000001',
  shield: '00000000-0000-4000-8000-000000000002',
  armor: '00000000-0000-4000-8000-000000000003',
  chest: '00000000-0000-4000-8000-000000000004',
  bow: '00000000-0000-4000-8000-000000000005',
  backpack: '00000000-0000-4000-8000-000000000006',
  rope: '00000000-0000-4000-8000-000000000007',
  arrows: '00000000-0000-4000-8000-000000000008',
  quiver: '00000000-0000-4000-8000-000000000009',
  melee: '10000000-0000-4000-8000-000000000001',
  travel: '10000000-0000-4000-8000-000000000002',
} as const;

function item(
  id: string,
  patch: Omit<Partial<LoadoutInventoryItem>, 'name'> = {},
): LoadoutInventoryItem & { name: string } {
  return {
    id,
    name: Object.entries(ids).find(([, value]) => value === id)?.[0] ?? id,
    parentId: null,
    worn: true,
    externalLocation: null,
    equipped: false,
    quantity: 1,
    isContainer: false,
    ...patch,
  };
}

function apply(
  items: readonly LoadoutInventoryItem[],
  record: Parameters<typeof equipmentSwitchUpdates>[0],
) {
  const updates = equipmentSwitchUpdates(record);
  return items.map((row) => ({ ...row, ...updates.get(row.id) }));
}

function inventory() {
  return [
    item(ids.sword, { equipped: true }),
    item(ids.shield, { equipped: true }),
    item(ids.armor),
    item(ids.chest, { worn: false, isContainer: true }),
    item(ids.bow, { parentId: ids.chest, worn: false }),
    item(ids.backpack, { isContainer: true }),
    item(ids.rope, { parentId: ids.backpack, worn: false }),
  ];
}

describe('planLoadoutSwitch', () => {
  it('equips loadout items, unequips the rest and keeps their locations', () => {
    const items = inventory();
    const { record, skipped } = planLoadoutSwitch(
      items,
      { id: ids.travel, name: 'Travel', itemIds: [ids.armor, ids.rope] },
      null,
      NOW,
    );
    expect(equipmentSwitch.parse(record)).toEqual(record);
    const after = apply(items, record);
    expect(after.filter((row) => row.equipped).map((row) => row.id)).toEqual([ids.armor, ids.rope]);
    // The rope stays inside the carried backpack; the sword stays carried.
    expect(after.find((row) => row.id === ids.rope)?.parentId).toBe(ids.backpack);
    expect(after.find((row) => row.id === ids.sword)).toMatchObject({
      worn: true,
      equipped: false,
    });
    expect(skipped).toEqual([]);
    expect(record).toMatchObject({
      kind: 'loadout',
      activeLoadoutId: ids.travel,
      previousActiveLoadoutId: null,
      previousEquippedIds: [ids.sword, ids.shield],
    });
    expect(equipmentSwitchProblem(items, record)).toBeNull();
  });

  it('moves a stashed item alone to the root of On the player', () => {
    const items = inventory();
    const { record } = planLoadoutSwitch(
      items,
      { id: ids.melee, name: 'Melee', itemIds: [ids.bow] },
      null,
      NOW,
    );
    const bow = apply(items, record).find((row) => row.id === ids.bow);
    expect(bow).toMatchObject({
      parentId: null,
      worn: true,
      externalLocation: null,
      equipped: true,
    });
    const chest = apply(items, record).find((row) => row.id === ids.chest);
    expect(chest).toMatchObject({ worn: false, parentId: null });
  });

  it('brings a container in with its contents rather than pulling contents out', () => {
    const items = [
      item(ids.chest, { worn: false, isContainer: true, externalLocation: 'Inn room' }),
      item(ids.bow, { parentId: ids.chest, worn: false }),
    ];
    const { record } = planLoadoutSwitch(
      items,
      { id: ids.melee, name: 'Melee', itemIds: [ids.bow, ids.chest] },
      null,
      NOW,
    );
    const after = apply(items, record);
    expect(after.find((row) => row.id === ids.chest)).toMatchObject({
      parentId: null,
      worn: true,
      externalLocation: null,
      equipped: true,
    });
    expect(after.find((row) => row.id === ids.bow)).toMatchObject({
      parentId: ids.chest,
      equipped: true,
    });
  });

  it('skips items with nothing to carry and ignores deleted ids', () => {
    const items = [item(ids.arrows, { quantity: 0 }), item(ids.sword)];
    const { record, skipped } = planLoadoutSwitch(
      items,
      { id: ids.melee, name: 'Melee', itemIds: [ids.arrows, ids.sword, ids.quiver] },
      null,
      NOW,
    );
    expect(skipped).toEqual([{ itemId: ids.arrows, reason: 'quantity' }]);
    expect(
      apply(items, record)
        .filter((row) => row.equipped)
        .map((row) => row.id),
    ).toEqual([ids.sword]);
  });

  it('remembers the previously active loadout', () => {
    const items = inventory();
    const first = planLoadoutSwitch(
      items,
      { id: ids.melee, name: 'Melee', itemIds: [ids.sword] },
      null,
      NOW,
    );
    const second = planLoadoutSwitch(
      apply(items, first.record),
      { id: ids.travel, name: 'Travel', itemIds: [ids.rope] },
      first.record,
      NOW,
    );
    expect(second.record).toMatchObject({
      activeLoadoutId: ids.travel,
      activeLoadoutName: 'Travel',
      previousActiveLoadoutId: ids.melee,
      previousActiveLoadoutName: 'Melee',
    });
  });
});

describe('planLastEquippedRestore', () => {
  it('returns moved items and the equipped set, and toggles back on a second restore', () => {
    const items = inventory();
    const equip = planLoadoutSwitch(
      items,
      { id: ids.melee, name: 'Melee', itemIds: [ids.bow] },
      null,
      NOW,
    );
    const switched = apply(items, equip.record);
    const restore = planLastEquippedRestore(switched, equip.record, NOW);
    const restored = apply(switched, restore.record);
    expect(restored).toEqual(items);
    expect(restore.record).toMatchObject({
      kind: 'restore',
      activeLoadoutId: null,
      previousActiveLoadoutId: ids.melee,
    });
    expect(equipmentSwitchProblem(switched, restore.record)).toBeNull();
    const again = planLastEquippedRestore(restored, restore.record, NOW);
    expect(apply(restored, again.record)).toEqual(switched);
    expect(again.record.activeLoadoutId).toBe(ids.melee);
  });

  it('keeps an item in place when its recorded container is gone', () => {
    const items = inventory();
    const equip = planLoadoutSwitch(
      items,
      { id: ids.melee, name: 'Melee', itemIds: [ids.bow] },
      null,
      NOW,
    );
    const switched = apply(items, equip.record).filter((row) => row.id !== ids.chest);
    const restore = planLastEquippedRestore(switched, equip.record, NOW);
    expect(restore.unrestored).toEqual([ids.bow]);
    expect(apply(switched, restore.record).find((row) => row.id === ids.bow)).toMatchObject({
      parentId: null,
      worn: true,
      equipped: false,
    });
  });

  it('refuses a restore that would put a container inside its own contents', () => {
    const items = [
      item(ids.chest, { worn: false, isContainer: true }),
      item(ids.backpack, { parentId: ids.chest, worn: false, isContainer: true }),
    ];
    const equip = planLoadoutSwitch(
      items,
      { id: ids.melee, name: 'Melee', itemIds: [ids.backpack] },
      null,
      NOW,
    );
    // The player later packs the chest inside the backpack it once held.
    const reorganized = apply(items, equip.record).map((row) =>
      row.id === ids.chest ? { ...row, parentId: ids.backpack } : row,
    );
    const restore = planLastEquippedRestore(reorganized, equip.record, NOW);
    expect(restore.unrestored).toEqual([ids.backpack]);
    expect(equipmentSwitchProblem(reorganized, restore.record)).toBeNull();
  });

  it('brings a previously equipped item back on the player after it was stashed', () => {
    const items = [item(ids.sword, { equipped: true }), item(ids.armor)];
    const equip = planLoadoutSwitch(
      items,
      { id: ids.melee, name: 'Melee', itemIds: [ids.armor] },
      null,
      NOW,
    );
    const stashed = apply(items, equip.record).map((row) =>
      row.id === ids.sword ? { ...row, worn: false } : row,
    );
    const restore = planLastEquippedRestore(stashed, equip.record, NOW);
    expect(apply(stashed, restore.record).find((row) => row.id === ids.sword)).toMatchObject({
      worn: true,
      equipped: true,
    });
  });
});

describe('equipmentSwitchProblem', () => {
  it('refuses a stale switch planned against another inventory', () => {
    const items = inventory();
    const { record } = planLoadoutSwitch(
      items,
      { id: ids.melee, name: 'Melee', itemIds: [ids.bow] },
      null,
      NOW,
    );
    const changed = items.map((row) =>
      row.id === ids.bow ? { ...row, quantity: 1, worn: true } : row,
    );
    expect(equipmentSwitchProblem(changed, record)).toContain('changed on another device');
    const extraEquip = items.map((row) =>
      row.id === ids.armor ? { ...row, equipped: true } : row,
    );
    expect(equipmentSwitchProblem(extraEquip, record)).toContain('changed on another device');
  });

  it('refuses equipping off the player, foreign parents and cycles', () => {
    const items = inventory();
    const base = {
      kind: 'loadout' as const,
      activeLoadoutId: ids.melee,
      activeLoadoutName: 'Melee',
      previousActiveLoadoutId: null,
      previousActiveLoadoutName: null,
      switchedAt: NOW,
      previousEquippedIds: [ids.sword, ids.shield],
    };
    const before = { equipped: false, worn: false, parentId: ids.chest, externalLocation: null };
    expect(
      equipmentSwitchProblem(items, {
        ...base,
        changes: [{ itemId: ids.bow, before, after: { ...before, equipped: true } }],
      }),
    ).toBe('Equipped items must be on the player');
    expect(
      equipmentSwitchProblem(items, {
        ...base,
        changes: [{ itemId: ids.bow, before, after: { ...before, parentId: ids.quiver } }],
      }),
    ).toContain('not on this character');
    expect(
      equipmentSwitchProblem(items, {
        ...base,
        changes: [{ itemId: ids.bow, before, after: { ...before, parentId: ids.sword } }],
      }),
    ).toContain('not a container');
    const chestBefore = { equipped: false, worn: false, parentId: null, externalLocation: null };
    expect(
      equipmentSwitchProblem(
        [...items, item(ids.quiver, { parentId: ids.chest, worn: false, isContainer: true })],
        {
          ...base,
          changes: [
            {
              itemId: ids.chest,
              before: chestBefore,
              after: { ...chestBefore, parentId: ids.quiver },
            },
          ],
        },
      ),
    ).toContain('cycle');
  });
});

describe('loadoutDelta', () => {
  it('reports extra and missing equipment', () => {
    const items = inventory();
    expect(loadoutDelta(items, { itemIds: [ids.sword, ids.shield] }).exact).toBe(true);
    const delta = loadoutDelta(items, { itemIds: [ids.sword, ids.armor, ids.quiver] });
    expect(delta.exact).toBe(false);
    expect(delta.extraEquipped.map((row) => row.name)).toEqual(['shield']);
    expect(delta.missing.map((row) => row.name)).toEqual(['armor']);
  });
});

describe('loadout ordering', () => {
  const alpha = { id: 'a', name: 'Alpha', sortOrder: 0 };
  const beta = { id: 'b', name: 'Beta', sortOrder: 1 };
  const gamma = { id: 'c', name: 'Gamma', sortOrder: 2 };
  const list = [alpha, beta, gamma];

  it('sorts by order, then name', () => {
    expect(sortLoadouts([gamma, { ...beta, sortOrder: 0 }, alpha]).map((l) => l.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(nextLoadoutSortOrder(list)).toBe(3);
    expect(nextLoadoutSortOrder([])).toBe(0);
  });

  it('moves one loadout to the midpoint of its new neighbours', () => {
    expect(loadoutMoveUpdates(list, 2, 0)).toEqual([{ id: 'c', sortOrder: -1 }]);
    expect(loadoutMoveUpdates(list, 0, 1)).toEqual([{ id: 'a', sortOrder: 1.5 }]);
    expect(loadoutMoveUpdates(list, 0, 2)).toEqual([{ id: 'a', sortOrder: 3 }]);
    expect(loadoutMoveUpdates(list, 1, 1)).toEqual([]);
  });

  it('renumbers the list when the gap is exhausted', () => {
    const tight = [
      { id: 'a', name: 'A', sortOrder: 0 },
      { id: 'b', name: 'B', sortOrder: 1e-7 },
      { id: 'c', name: 'C', sortOrder: 2e-7 },
    ];
    expect(loadoutMoveUpdates(tight, 2, 1)).toEqual([
      { id: 'c', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ]);
  });
});
