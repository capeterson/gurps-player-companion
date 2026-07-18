/**
 * Outbox semantics: the "latest patch wins per (entityId, fieldPath)"
 * rule from AGENTS.md, plus the parallel-different-fields case.
 */

import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OutboxEntry, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import {
  MAX_ATTEMPTS,
  backoffMs,
  enqueueFieldPatch,
  readDrainableOps,
  recoverStaleInFlight,
} from './outbox.ts';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  await resetLocalDb();
});

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

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
    tempEffects: [],
    dismissedWarnings: [],
    activeConditionGroups: [],
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

  it('coalescing preserves the ORIGINAL prevValue, not the intermediate optimistic value', async () => {
    // PR #46 review finding: two rapid same-field patches must leave the
    // surviving op's prevValue pointing at the value the field had
    // BEFORE either patch -- not at the first patch's (about-to-be-
    // deleted) attemptedValue, which is what a naive re-read of the
    // local row would capture (the local row already reflects the
    // first patch by the time the second one runs).
    await seedCharacter(); // st starts at 10
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
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.attemptedValue).toBe(12);
    // Must be 10 (the original), not 11 (the coalesced-away op's value).
    expect(ops[0]?.prevValue).toBe(10);
  });

  it('a three-way coalesce still carries forward the ORIGINAL prevValue', async () => {
    await seedCharacter(); // st starts at 10
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
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 13,
    });
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.attemptedValue).toBe(13);
    expect(ops[0]?.prevValue).toBe(10);
  });

  it('an explicit args.prevValue override still wins over the carried-forward value', async () => {
    // The orchestrator's stale_base self-heal path (orchestrator.ts)
    // deliberately passes the server-confirmed current value as
    // `prevValue` when re-enqueueing a patch; that override must not be
    // clobbered by the coalescing carry-forward logic.
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
      prevValue: 99,
    });
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.prevValue).toBe(99);
  });
});

describe('coalescing + orchestrator rollback', () => {
  it('rejection after coalescing restores the ORIGINAL pre-edit value, not an intermediate one', async () => {
    // End-to-end version of the two prior coalescing tests: drive the
    // surviving op through the real orchestrator and confirm the
    // rollback lands on 10 (the true last-synced value), not 11 (the
    // first tap's optimistic value that a naive re-read would have
    // captured as prevValue).
    await seedCharacter(); // st starts at 10
    tokenStore.write({
      accessToken: jwtForUser('0193b3c0-f1f0-7000-8000-00000000aaaa'),
      refreshToken: 'refresh',
      accessTokenExpiresIn: 3600,
    });

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
    // Sanity: the local row shows the latest optimistic value pre-sync.
    expect((await getLocalDb().characters.get(CHAR_ID))?.st).toBe(12);

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string }>;
        };
        const outcomes = body.operations.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'rejected' as const,
          reason: 'st rejected in test',
        }));
        return new Response(JSON.stringify({ outcomes }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/sync/cursor')) {
        return new Response(JSON.stringify({ changes: [], nextCursor: {}, hasMore: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    getSyncOrchestrator().start();
    try {
      await waitFor(async () => {
        const row = await getLocalDb().characters.get(CHAR_ID);
        expect(row?.st).toBe(10);
      });
    } finally {
      getSyncOrchestrator().stop();
    }
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
