import { afterEach, describe, expect, it } from 'vitest';
import { getLocalDb, resetLocalDb } from '../../db/dexie.ts';
import { cleanupLinkedSheetEffect } from './effectSheetCleanup.ts';

const CHARACTER_ID = '0193b3c0-f1f0-7000-8000-00000000e001';

afterEach(async () => {
  await resetLocalDb();
});

async function seedCharacter() {
  await getLocalDb().characters.put({
    id: CHARACTER_ID,
    ownerId: '0193b3c0-f1f0-7000-8000-00000000e002',
    campaignId: null,
    name: 'Target',
    playerName: null,
    height: null,
    weight: null,
    age: null,
    appearance: null,
    techLevel: null,
    st: 11,
    dx: 10,
    iq: 10,
    ht: 12,
    hpMod: 1,
    willMod: 0,
    perMod: 0,
    fpMod: 2,
    speedQuarterMod: 0,
    moveMod: 0,
    tempEffects: [
      { id: 'spell-effect', name: 'Might', mods: { st: 2 } },
      { id: 'keep', name: 'Other', mods: { dx: 1 } },
    ],
    dismissedWarnings: [],
    activeConditionGroups: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
  });
  await getLocalDb().characterCombat.put({
    id: CHARACTER_ID,
    characterId: CHARACTER_ID,
    currentHp: 12,
    currentFp: 14,
    conditions: ['stunned', 'bleeding'],
    maneuver: null,
    posture: 'standing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
  });
}

describe('cleanupLinkedSheetEffect', () => {
  it('clears linked PC conditions and temporary effects through local outbox patches', async () => {
    await seedCharacter();

    await cleanupLinkedSheetEffect(
      { linkedCondition: 'stunned', linkedTempEffectId: 'spell-effect' },
      { characterId: CHARACTER_ID },
    );

    const db = getLocalDb();
    expect((await db.characterCombat.get(CHARACTER_ID))?.conditions).toEqual(['bleeding']);
    expect((await db.characters.get(CHARACTER_ID))?.tempEffects).toEqual([
      { id: 'keep', name: 'Other', mods: { dx: 1 } },
    ]);
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(2);
    expect(ops.map((op) => [op.entityClass, op.fieldPath, op.attemptedValue])).toEqual(
      expect.arrayContaining([
        ['character', 'tempEffects', [{ id: 'keep', name: 'Other', mods: { dx: 1 } }]],
        ['character_combat', 'conditions', ['bleeding']],
      ]),
    );
  });

  it('does nothing for an NPC target', async () => {
    await cleanupLinkedSheetEffect(
      { linkedCondition: 'stunned', linkedTempEffectId: 'spell-effect' },
      { characterId: null },
    );
    expect(await getLocalDb().outbox.count()).toBe(0);
  });
});
