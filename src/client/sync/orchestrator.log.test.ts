/**
 * Journal coverage for the sync-log enrichment added alongside the
 * batch-local revision fast-forward fix: the stale_base self-heal,
 * rollback, and transient-retry paths in `applyOutcomes` now leave a
 * trace in `syncLog` (previously they left none, which made this class
 * of "burst of edits keeps stale_basing" bug invisible in the debug
 * log).
 */

import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import { enqueueFieldPatch } from './outbox.ts';

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

const USER_ID = '0193b3c0-f1f0-7000-8000-00000000aaaa';
const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000c001';

async function seedCharacter() {
  const db = getLocalDb();
  await db.characters.put({
    id: CHAR_ID,
    ownerId: USER_ID,
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

function login() {
  tokenStore.write({
    accessToken: jwtForUser(USER_ID),
    refreshToken: 'refresh',
    accessTokenExpiresIn: 3600,
  });
}

function cursorResponse() {
  return new Response(JSON.stringify({ changes: [], nextCursor: {}, hasMore: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  await resetLocalDb();
});

describe('applyOutcomes sync-log diagnostics', () => {
  it('logs a "requeued" entry when the stale_base self-heal re-enqueues an unchanged field', async () => {
    await seedCharacter();
    login();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 13,
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string; fieldPath?: string }>;
        };
        const outcomes = body.operations.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'stale_base' as const,
          reason: 'newer server revision',
          // The server's current value for `st` is still 10 (the
          // client's own prevValue) -- another op in the same burst
          // advanced the revision, not a foreign write. Guard 1 passes,
          // so the self-heal re-enqueues rather than rolling back.
          latestEntity: { id: CHAR_ID, st: 10, revision: 5 },
        }));
        return new Response(JSON.stringify({ outcomes }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/sync/cursor')) return cursorResponse();
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    getSyncOrchestrator().start();
    try {
      await waitFor(async () => {
        const log = await getLocalDb().syncLog.toArray();
        expect(log.some((entry) => entry.result === 'requeued')).toBe(true);
      });
      const log = await getLocalDb().syncLog.toArray();
      const requeued = log.find((entry) => entry.result === 'requeued');
      expect(requeued).toMatchObject({
        direction: 'push',
        result: 'requeued',
        entityClass: 'character',
        entityId: CHAR_ID,
        fieldPath: 'st',
      });
      // The op was re-enqueued with the fresh revision -- it should
      // still be present in the outbox (or already applied, if the
      // loop ran again), never lost.
      await waitFor(async () => {
        const row = await getLocalDb().characters.get(CHAR_ID);
        expect(row?.st).toBe(13);
      });
    } finally {
      getSyncOrchestrator().stop();
    }
  });

  it('logs a "rolled_back" entry when the server rejects an op', async () => {
    await seedCharacter();
    login();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 999,
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string }>;
        };
        const outcomes = body.operations.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'rejected' as const,
          reason: 'ST must be <= 20',
        }));
        return new Response(JSON.stringify({ outcomes }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/sync/cursor')) return cursorResponse();
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    getSyncOrchestrator().start();
    try {
      await waitFor(async () => {
        const row = await getLocalDb().characters.get(CHAR_ID);
        expect(row?.st).toBe(10);
      });
      const log = await getLocalDb().syncLog.toArray();
      expect(log).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            direction: 'push',
            result: 'rolled_back',
            entityClass: 'character',
            entityId: CHAR_ID,
            fieldPath: 'st',
          }),
        ]),
      );
    } finally {
      getSyncOrchestrator().stop();
    }
  });

  it('logs exactly one "retrying" entry across repeated transient failures of the same op', async () => {
    await seedCharacter();
    login();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 14,
    });

    let operationsCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        operationsCalls += 1;
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string }>;
        };
        const outcomes = body.operations.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'transient' as const,
          reason: 'db hiccup',
        }));
        return new Response(JSON.stringify({ outcomes }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/sync/cursor')) return cursorResponse();
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const orchestrator = getSyncOrchestrator();
    orchestrator.start();
    try {
      // First drain attempt: pending -> transient_retry, one "retrying" row logged.
      await waitFor(() => expect(operationsCalls).toBeGreaterThanOrEqual(1));
      await waitFor(async () => {
        const log = await getLocalDb().syncLog.toArray();
        expect(log.filter((entry) => entry.result === 'retrying')).toHaveLength(1);
      });

      // Force the backoff window closed instead of waiting on the real
      // 5s loop tick + exponential backoff, then nudge the loop.
      const db = getLocalDb();
      const stillPending = await db.outbox.toArray();
      await db.outbox.bulkPut(
        stillPending.map((row) => ({ ...row, nextEarliestAttemptAt: undefined })),
      );
      orchestrator.triggerDrain();

      // Second drain attempt: op was already transient_retry going in,
      // so no additional "retrying" row should be logged.
      await waitFor(() => expect(operationsCalls).toBeGreaterThanOrEqual(2));
      const log = await getLocalDb().syncLog.toArray();
      const retrying = log.filter((entry) => entry.result === 'retrying');
      expect(retrying).toHaveLength(1);
      expect(retrying[0]).toMatchObject({
        direction: 'push',
        entityClass: 'character',
        entityId: CHAR_ID,
        fieldPath: 'st',
      });
    } finally {
      orchestrator.stop();
    }
  });
});
