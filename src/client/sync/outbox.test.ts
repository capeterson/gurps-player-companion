/**
 * Outbox semantics: the "latest patch wins per (entityId, fieldPath)"
 * rule from AGENTS.md, plus the parallel-different-fields case.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { enqueueFieldPatch } from './outbox.ts';

afterEach(async () => {
  await resetLocalDb();
});

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000c001';

async function seedCharacter() {
  const db = getLocalDb();
  await db.characters.put({
    id: CHAR_ID,
    ownerId: '0193b3c0-f1f0-7000-8000-00000000aaaa',
    campaignId: null,
    name: 'Test',
    playerName: null,
    height: null,
    weight: null,
    age: null,
    appearance: null,
    techLevel: null,
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
    tempSt: 0,
    tempDx: 0,
    tempIq: 0,
    tempHt: 0,
    tempHpMod: 0,
    tempWillMod: 0,
    tempPerMod: 0,
    tempFpMod: 0,
    tempSpeedQuarterMod: 0,
    tempMoveMod: 0,
    dismissedWarnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
  });
}

describe('enqueueFieldPatch', () => {
  it('coalesces sequential pending patches on the same field', async () => {
    await seedCharacter();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 11,
    });
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 12,
    });
    const db = getLocalDb();
    const ops = await db.outbox.toArray();
    expect(ops.length).toBe(1);
    expect(ops[0]?.attemptedValue).toBe(12);
    // Local row reflects the latest value immediately.
    const row = await db.characters.get(CHAR_ID);
    expect(row?.st).toBe(12);
  });

  it('keeps patches on different fields independent', async () => {
    await seedCharacter();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 11,
    });
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'dx',
      attemptedValue: 13,
    });
    const ops = await getLocalDb().outbox.toArray();
    expect(ops.length).toBe(2);
    const row = await getLocalDb().characters.get(CHAR_ID);
    expect(row?.st).toBe(11);
    expect(row?.dx).toBe(13);
  });

  it('captures the prior local value as prevValue', async () => {
    await seedCharacter();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 14,
    });
    const op = (await getLocalDb().outbox.toArray())[0];
    expect(op?.prevValue).toBe(10);
  });
});
