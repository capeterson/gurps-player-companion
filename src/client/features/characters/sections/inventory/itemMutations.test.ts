import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  armorData,
  inventoryItemOut,
  weaponData,
} from '../../../../../shared/schemas/inventory.ts';
import { getLocalDb } from '../../../../db/dexie.ts';
import { addCategory, mutateItem, removeCategory, writeItemPath } from './itemMutations.ts';

const ID = '0193b3c0-f1f0-7000-8000-00000000a001';
const CHARACTER = '0193b3c0-f1f0-7000-8000-00000000c001';
async function seed() {
  const value = inventoryItemOut.parse({
    id: ID,
    characterId: CHARACTER,
    name: 'Staff',
    quantity: 1,
    weightLbs: 4,
    cost: 10,
    notes: null,
    parentId: null,
    externalLocation: 'Wagon',
    worn: false,
    equipped: false,
    isContainer: false,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    isArmor: false,
    armor: null,
    weaponData: weaponData.parse({
      damage: 'sw+2 cr',
      alternateModes: [{ name: 'Thrust', damage: 'thr+2 cr' }],
    }),
    powerstoneData: null,
    magicItemData: null,
    enchantments: [],
    libraryItemId: null,
    effectiveWeightLbs: 4,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  await getLocalDb().characterInventory.put({ ...value, revision: 1 });
  return value;
}
async function read() {
  return inventoryItemOut.parse({
    ...(await getLocalDb().characterInventory.get(ID)),
    effectiveWeightLbs: 4,
  });
}
afterEach(() => vi.restoreAllMocks());

describe('inline inventory local mutations', () => {
  it('edits synced rows whose Postgres numeric columns arrive as strings', async () => {
    await seed();
    await getLocalDb().characterInventory.update(ID, {
      weightLbs: '4.00' as unknown as number,
      cost: '10.00' as unknown as number,
      hideawayCapacityLbs: '0.00' as unknown as number,
    });
    await addCategory(ID, 'armor');
    await writeItemPath(ID, 'armor.dr', 3, 'DR');
    const row = await getLocalDb().characterInventory.get(ID);
    expect(row?.armor).toMatchObject({ dr: 3 });
    expect(row?.weightLbs).toBe('4.00');
    expect(row?.cost).toBe('10.00');
  });

  it('atomically adds armor, preserves other facets and carrying state, and groups history', async () => {
    const before = await seed();
    await addCategory(ID, 'armor');
    const after = await read();
    expect(after).toMatchObject({
      isArmor: true,
      armor: { dr: 0 },
      weaponData: before.weaponData,
      equipped: false,
      worn: false,
      externalLocation: 'Wagon',
    });
    const ops = await getLocalDb().outbox.toArray();
    expect(ops.map((op) => op.fieldPath).sort()).toEqual(['armor', 'isArmor']);
    expect(ops[0]?.batchId).toBeTruthy();
    expect(ops[0]?.batchId).toBe(ops[1]?.batchId);
    expect(ops.every((op) => op.status === 'pending' && op.parentId === CHARACTER)).toBe(true);
  });

  it('rolls back both fields if queueing category creation fails', async () => {
    await seed();
    const db = getLocalDb();
    const original = db.outbox.add.bind(db.outbox);
    vi.spyOn(db.outbox, 'add')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(addCategory(ID, 'armor')).rejects.toThrow('disk full');
    expect((await read()).isArmor).toBe(false);
    expect((await read()).armor).toBeNull();
    expect(await db.outbox.count()).toBe(0);
  });

  it('merges concurrent JSON leaf edits against the latest local row and coalesces correctly', async () => {
    await seed();
    await getLocalDb().characterInventory.update(ID, {
      isArmor: true,
      armor: armorData.parse({ dr: 2, typedDr: { burn: 7 } }),
    });
    await Promise.all([
      writeItemPath(ID, 'armor.dr', 4, 'DR'),
      writeItemPath(ID, 'armor.db', 0, 'Defense bonus'),
      writeItemPath(ID, 'armor.typedDr.cut', 6, 'Cutting DR'),
    ]);
    expect((await read()).armor).toMatchObject({ dr: 4, db: 0, typedDr: { burn: 7, cut: 6 } });
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.prevValue).toEqual(armorData.parse({ dr: 2, typedDr: { burn: 7 } }));
  });

  it('creates ranged data on demand and removes an empty block after the last value is cleared', async () => {
    await seed();
    await writeItemPath(ID, 'weaponData.ranged.acc', 0, 'Accuracy');
    expect((await read()).weaponData?.ranged?.acc).toBe(0);
    await writeItemPath(ID, 'weaponData.ranged.range', '100/150', 'Range');
    await writeItemPath(ID, 'weaponData.ranged.acc', null, 'Accuracy');
    expect((await read()).weaponData?.ranged?.range).toBe('100/150');
    await writeItemPath(ID, 'weaponData.ranged.range', null, 'Range');
    expect((await read()).weaponData?.ranged).toBeNull();
    expect((await read()).weaponData?.alternateModes).toEqual([
      { name: 'Thrust', damage: 'thr+2 cr' },
    ]);
  });

  it('guards container contents even when the UI has a stale child list', async () => {
    const parent = await seed();
    await addCategory(ID, 'container');
    await getLocalDb().characterInventory.put({
      ...parent,
      id: '0193b3c0-f1f0-7000-8000-00000000a002',
      parentId: ID,
      revision: 1,
    });
    await expect(removeCategory(ID, 'container')).rejects.toThrow('Move the contents');
    expect((await read()).isContainer).toBe(true);
  });

  it('validates energy capacity and numeric bounds instead of silently clamping edits', async () => {
    await seed();
    await addCategory(ID, 'powerstone');
    await expect(
      writeItemPath(ID, 'powerstoneData.currentEnergy', 10, 'Current energy'),
    ).rejects.toThrow();
    expect((await read()).powerstoneData).toMatchObject({ maxEnergy: 5, currentEnergy: 0 });
    await expect(writeItemPath(ID, 'weaponData.db', 5, 'Shield DB')).rejects.toThrow();
    await expect(writeItemPath(ID, 'weaponData.stRequired', 2.5, 'ST required')).rejects.toThrow();
  });

  it('requires a real spell name when adding a magic item and preserves charge state on unrelated edits', async () => {
    await seed();
    await expect(addCategory(ID, 'magicItem')).rejects.toThrow();
    await addCategory(ID, 'magicItem', 'Light');
    await writeItemPath(ID, 'magicItemData.chargesCurrent', 3, 'Charges');
    await writeItemPath(ID, 'magicItemData.notes', 'Silver wand', 'Notes');
    expect((await read()).magicItemData).toMatchObject({
      spellName: 'Light',
      chargesCurrent: 3,
      chargesMax: 10,
    });
  });

  it('does not resurrect a category removed before an input commit', async () => {
    await seed();
    await removeCategory(ID, 'weapon');
    await expect(writeItemPath(ID, 'weaponData.damage', 'sw cut', 'Damage')).rejects.toThrow(
      'category was removed',
    );
    expect((await read()).weaponData).toBeNull();
  });

  it('adds multiple enchantments and alternate modes without overwriting their siblings', async () => {
    await seed();
    await mutateItem(ID, 'Enchantments', () => ({
      enchantments: [
        { spellName: 'Fortify', spellLevel: 15 },
        { spellName: 'Deflect', notes: 'Cloak' },
      ],
    }));
    await Promise.all([
      writeItemPath(ID, 'enchantments.0.category', '+3', 'Label'),
      writeItemPath(ID, 'enchantments.1.spellLevel', 0, 'Skill'),
    ]);
    expect((await read()).enchantments).toEqual([
      { spellName: 'Fortify', spellLevel: 15, category: '+3' },
      { spellName: 'Deflect', notes: 'Cloak', spellLevel: 0 },
    ]);
  });
});
