/**
 * Outbox semantics: the "latest patch wins per (entityId, fieldPath)"
 * rule from AGENTS.md, plus the parallel-different-fields case.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { type OutboxEntry, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import {
  MAX_ATTEMPTS,
  backoffMs,
  enqueueFieldPatch,
  readDrainableOps,
  recoverStaleInFlight,
} from './outbox.ts';

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

// ---------- drain ordering / self-heal ----------

function opRow(overrides: Partial<OutboxEntry> & Pick<OutboxEntry, 'clientOpId'>): OutboxEntry {
  return {
    entityClass: 'character',
    entityId: CHAR_ID,
    command: 'patch',
    coalesceKey: `${CHAR_ID}|st`,
    fieldPath: 'st',
    attemptedValue: 11,
    validationVersion: 1,
    status: 'pending',
    enqueuedAt: new Date().toISOString(),
    attemptCount: 0,
    ...overrides,
  };
}

describe('readDrainableOps', () => {
  const TRAIT_ID = '0193b3c0-f1f0-7000-8000-00000000e001';
  const future = new Date(Date.now() + 60_000).toISOString();

  it('holds back ops that depend on a create still in backoff', async () => {
    const db = getLocalDb();
    // Trait create backing off after a transient failure…
    await db.outbox.put(
      opRow({
        clientOpId: 'op-create',
        entityClass: 'character_trait',
        entityId: TRAIT_ID,
        command: 'create',
        coalesceKey: `${TRAIT_ID}|:create`,
        fieldPath: undefined,
        parentId: CHAR_ID,
        status: 'transient_retry',
        nextEarliestAttemptAt: future,
        enqueuedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    // …a queued patch on that same trait…
    await db.outbox.put(
      opRow({
        clientOpId: 'op-trait-patch',
        entityClass: 'character_trait',
        entityId: TRAIT_ID,
        coalesceKey: `${TRAIT_ID}|points`,
        fieldPath: 'points',
        parentId: CHAR_ID,
        enqueuedAt: '2026-01-01T00:00:01.000Z',
      }),
    );
    // …and an unrelated character patch.
    await db.outbox.put(
      opRow({ clientOpId: 'op-char-patch', enqueuedAt: '2026-01-01T00:00:02.000Z' }),
    );

    const ready = await readDrainableOps(50);
    // Only the unrelated patch drains; sending the trait patch now
    // would 404 server-side and roll the user's edit back.
    expect(ready.map((o) => o.clientOpId)).toEqual(['op-char-patch']);
  });

  it('lets a backoff on one field NOT block patches to other fields', async () => {
    const db = getLocalDb();
    await db.outbox.put(
      opRow({
        clientOpId: 'op-st',
        status: 'transient_retry',
        nextEarliestAttemptAt: future,
        enqueuedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    await db.outbox.put(
      opRow({
        clientOpId: 'op-dx',
        coalesceKey: `${CHAR_ID}|dx`,
        fieldPath: 'dx',
        enqueuedAt: '2026-01-01T00:00:01.000Z',
      }),
    );
    const ready = await readDrainableOps(50);
    expect(ready.map((o) => o.clientOpId)).toEqual(['op-dx']);
  });

  it('orders a create before a patch enqueued in the same millisecond', async () => {
    const db = getLocalDb();
    const sameInstant = '2026-01-01T00:00:00.000Z';
    await db.outbox.put(
      opRow({
        clientOpId: 'op-b-patch',
        entityClass: 'character_trait',
        entityId: TRAIT_ID,
        coalesceKey: `${TRAIT_ID}|points`,
        fieldPath: 'points',
        parentId: CHAR_ID,
        enqueuedAt: sameInstant,
      }),
    );
    await db.outbox.put(
      opRow({
        clientOpId: 'op-a-create',
        entityClass: 'character_trait',
        entityId: TRAIT_ID,
        command: 'create',
        coalesceKey: `${TRAIT_ID}|:create`,
        fieldPath: undefined,
        parentId: CHAR_ID,
        enqueuedAt: sameInstant,
      }),
    );
    const ready = await readDrainableOps(50);
    expect(ready.map((o) => o.command)).toEqual(['create', 'patch']);
  });
});

describe('recoverStaleInFlight', () => {
  it('re-promotes orphaned in_flight rows to pending', async () => {
    const db = getLocalDb();
    await db.outbox.put(opRow({ clientOpId: 'op-stale', status: 'in_flight', attemptCount: 2 }));
    const recovered = await recoverStaleInFlight();
    expect(recovered).toBe(1);
    const row = await db.outbox.get('op-stale');
    expect(row?.status).toBe('pending');
    // Attempt count survives so backoff keeps escalating on retry.
    expect(row?.attemptCount).toBe(2);
  });
});

describe('backoffMs', () => {
  it('caps at ~60s while attempts are fresh', () => {
    const ms = backoffMs(MAX_ATTEMPTS);
    expect(ms).toBeGreaterThanOrEqual(60_000);
    expect(ms).toBeLessThanOrEqual(61_000);
  });

  it('relaxes to a ~5-minute cadence past MAX_ATTEMPTS instead of giving up', () => {
    const ms = backoffMs(MAX_ATTEMPTS + 5);
    expect(ms).toBeGreaterThanOrEqual(300_000);
    expect(ms).toBeLessThanOrEqual(301_000);
  });
});
