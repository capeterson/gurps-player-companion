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
import {
  getSyncOrchestrator,
  resetSyncOrchestratorForTests,
  setRejectionNotifier,
} from './orchestrator.ts';
import { enqueueFieldPatch } from './outbox.ts';
import { syncStateStore } from './state.ts';

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

const USER_ID = '0193b3c0-f1f0-7000-8000-00000000aaaa';
const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000c001';
const SKILL_ID = '0193b3c0-f1f0-7000-8000-00000000d001';

async function seedCharacter() {
  const db = getLocalDb();
  await db.characters.put({
    id: CHAR_ID,
    ownerId: USER_ID,
    campaignId: null,
    name: 'Test',
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
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

async function seedSkill() {
  await getLocalDb().characterSkills.put({
    id: SKILL_ID,
    characterId: CHAR_ID,
    name: 'Stealth',
    attribute: 'DX',
    difficulty: 'A',
    points: 2,
    techLevel: null,
    specialization: null,
    notes: 'Quietly.',
    librarySkillId: null,
    libraryMechanics: null,
    defaults: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
  syncStateStore.reset('synced');
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

  it('records a rollback in the direction the local row actually moved', async () => {
    await seedCharacter();
    login();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 999,
      prevValue: 10,
      humanName: 'ST',
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
      const rolled = log.find((entry) => entry.result === 'rolled_back');
      // The row moved 999 -> 10. Recording it the other way round would
      // show the user the refused edit as their final value and the
      // restored one as discarded.
      expect(rolled).toMatchObject({ previousValue: 999, newValue: 10 });
    } finally {
      getSyncOrchestrator().stop();
    }
  });

  it('uses the server value as the restored side when one comes back', async () => {
    await seedCharacter();
    login();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 13,
      prevValue: 10,
      humanName: 'ST',
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string }>;
        };
        const outcomes = body.operations.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'conflict' as const,
          reason: 'someone else edited this',
          // revertLocal prefers this over prevValue, so the journal has
          // to agree with it.
          latestEntity: { id: CHAR_ID, st: 16, revision: 9 },
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
        expect(log.some((entry) => entry.result === 'rolled_back')).toBe(true);
      });
      const rolled = (await getLocalDb().syncLog.toArray()).find(
        (entry) => entry.result === 'rolled_back',
      );
      expect(rolled).toMatchObject({ previousValue: 13, newValue: 16 });
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

  it('logs when the server omits an operation outcome and the op starts retrying', async () => {
    await seedCharacter();
    login();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 12,
      humanName: 'ST',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/sync/operations')) {
          return new Response(JSON.stringify({ outcomes: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/sync/cursor')) return cursorResponse();
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const orchestrator = getSyncOrchestrator();
    orchestrator.start();
    try {
      await waitFor(async () => {
        const entry = (await getLocalDb().syncLog.toArray()).find(
          (candidate) => candidate.result === 'retrying',
        );
        expect(entry).toMatchObject({
          direction: 'push',
          entityId: CHAR_ID,
          fieldPath: 'st',
          details: { serverReason: 'no outcome returned', attemptCount: 1 },
        });
      });
    } finally {
      orchestrator.stop();
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

  it('records the before/after values on a successful push', async () => {
    await seedCharacter();
    login();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 12,
      prevValue: 10,
      humanName: 'ST',
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string }>;
        };
        const outcomes = body.operations.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'applied' as const,
          newRevision: 2,
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
        expect(log.some((entry) => entry.result === 'synced')).toBe(true);
      });
      const log = await getLocalDb().syncLog.toArray();
      const synced = log.find((entry) => entry.result === 'synced' && entry.direction === 'push');
      // Without these the log could only say "character patch", which
      // tells the user nothing about what actually changed.
      expect(synced).toMatchObject({ fieldPath: 'st', previousValue: 10, newValue: 12 });
    } finally {
      getSyncOrchestrator().stop();
    }
  });
});

describe('cursor pull sync-log values', () => {
  it('records the field and before/after values actually applied by a downloaded skill patch', async () => {
    await seedCharacter();
    await seedSkill();
    login();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            changes: [
              {
                entityClass: 'character_skill',
                entityId: SKILL_ID,
                command: 'patch',
                revision: 2,
                data: {
                  ...(await getLocalDb().characterSkills.get(SKILL_ID)),
                  points: 4,
                  updatedAt: '2026-01-02T00:00:00.000Z',
                  revision: 2,
                },
              },
            ],
            nextCursor: { character_skill: 2 },
            hasMore: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await getSyncOrchestrator().triggerCursorPull();

    const pulled = (await getLocalDb().syncLog.toArray()).find(
      (entry) => entry.direction === 'pull' && entry.entityId === SKILL_ID,
    );
    expect(pulled).toMatchObject({
      parentId: CHAR_ID,
      fieldPath: 'points',
      previousValue: 2,
      newValue: 4,
      details: { revision: 2, appliedFields: ['points'] },
    });
  });

  it('does not claim a pending local field was changed by a downloaded row', async () => {
    await seedCharacter();
    await seedSkill();
    login();
    await enqueueFieldPatch({
      entityClass: 'character_skill',
      entityId: SKILL_ID,
      characterId: CHAR_ID,
      fieldPath: 'points',
      attemptedValue: 5,
    });

    const serverRow = {
      ...(await getLocalDb().characterSkills.get(SKILL_ID)),
      points: 3,
      notes: 'Changed elsewhere.',
      updatedAt: '2026-01-02T00:00:00.000Z',
      revision: 2,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            changes: [
              {
                entityClass: 'character_skill',
                entityId: SKILL_ID,
                command: 'patch',
                revision: 2,
                data: serverRow,
              },
            ],
            nextCursor: { character_skill: 2 },
            hasMore: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await getSyncOrchestrator().triggerCursorPull();

    expect(await getLocalDb().characterSkills.get(SKILL_ID)).toMatchObject({
      points: 5,
      notes: 'Changed elsewhere.',
    });
    const pulled = (await getLocalDb().syncLog.toArray()).find(
      (entry) => entry.direction === 'pull' && entry.entityId === SKILL_ID,
    );
    expect(pulled).toMatchObject({
      fieldPath: 'notes',
      previousValue: 'Quietly.',
      newValue: 'Changed elsewhere.',
      details: { revision: 2, appliedFields: ['notes'] },
    });
  });
});

describe('whole-cycle failures', () => {
  it('journals a failed pull with its HTTP status and names the reason on the indicator', async () => {
    await seedCharacter();
    login();

    // No outbox rows: the drain loop goes straight to the cursor pull,
    // which is the path that produced a red badge and no toast during
    // the origin outage.
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/sync/cursor')) {
        return new Response('error code: 530', { status: 530 });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    getSyncOrchestrator().start();
    try {
      await waitFor(async () => {
        const log = await getLocalDb().syncLog.toArray();
        expect(log.some((entry) => entry.result === 'failed')).toBe(true);
      });
      const failed = (await getLocalDb().syncLog.toArray()).find((e) => e.result === 'failed');
      expect(failed).toMatchObject({ direction: 'pull' });
      expect(failed?.reason).toContain('530');
      expect(syncStateStore.status.state).toBe('error');
      expect(syncStateStore.status.error?.reason).toContain('530');
    } finally {
      getSyncOrchestrator().stop();
    }
  });

  it('reports a session that vanishes after an ordinary reload', async () => {
    // The common path: `bootstrap:<userId>` already exists, so
    // SyncBootstrapGate never calls bootstrap() and only setCurrentUser
    // seeds the identity. Without that seeding this failure is silent.
    await seedCharacter();
    login();
    const orchestrator = getSyncOrchestrator();
    orchestrator.setCurrentUser(USER_ID);

    const fetchMock = vi.fn().mockImplementation(async () => cursorResponse());
    vi.stubGlobal('fetch', fetchMock);

    orchestrator.start();
    try {
      await waitFor(() => expect(syncStateStore.status.state).toBe('synced'));

      // Something cleared the session underneath us (e.g. a refresh
      // that a proxy error turned into a logout).
      tokenStore.clear();
      orchestrator.triggerDrain();

      // triggerDrain's wake() is dropped when the loop isn't parked in
      // waitForSignal, so the report can be up to one 5s tick away.
      await waitFor(() => expect(syncStateStore.status.state).toBe('error'), { timeout: 8_000 });
      expect(syncStateStore.status.error?.reason).toMatch(/signed out/i);
      const failed = (await getLocalDb().syncLog.toArray()).find((e) => e.result === 'failed');
      expect(failed?.reason).toMatch(/signed out/i);
    } finally {
      orchestrator.stop();
    }
    // Room for the 5s loop tick above.
  }, 20_000);

  it('keeps the download failure visible when the upload succeeded', async () => {
    // The upload empties the outbox, so the fallback refreshIndicator
    // would flip the badge to 'synced' and drop the banner explaining
    // that downloads are still broken.
    await seedCharacter();
    login();
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 12,
      prevValue: 10,
      humanName: 'ST',
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string }>;
        };
        return new Response(
          JSON.stringify({
            outcomes: body.operations.map((op) => ({
              clientOpId: op.clientOpId,
              status: 'applied' as const,
              newRevision: 2,
            })),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/sync/cursor')) return new Response('error code: 530', { status: 530 });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    getSyncOrchestrator().start();
    try {
      await waitFor(() => expect(syncStateStore.status.state).toBe('error'));
      // Give the post-drain fallback every chance to clobber it.
      await new Promise((r) => setTimeout(r, 1_500));
      expect(syncStateStore.status.state).toBe('error');
      expect(syncStateStore.status.error?.reason).toContain('530');
    } finally {
      getSyncOrchestrator().stop();
    }
  }, 20_000);

  it('clears the error reason once a cycle succeeds again', async () => {
    await seedCharacter();
    login();

    let down = true;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/sync/cursor')) {
        if (down) return new Response('error code: 530', { status: 530 });
        return cursorResponse();
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const orchestrator = getSyncOrchestrator();
    orchestrator.start();
    try {
      await waitFor(() => expect(syncStateStore.status.state).toBe('error'));
      down = false;
      orchestrator.triggerDrain();
      // Generous: the store holds every state for a minimum dwell of 1s
      // so transitions stay perceptible, so recovery can't be instant.
      await waitFor(() => expect(syncStateStore.status.state).toBe('synced'), { timeout: 5_000 });
      // A stale reason on a healthy badge would be its own lie.
      expect(syncStateStore.status.error).toBeNull();
    } finally {
      orchestrator.stop();
    }
  });
});

describe('rejection housekeeping without a fresh bootstrap', () => {
  it('replays open rejections on an ordinary authenticated reload', async () => {
    // SyncBootstrapGate skips bootstrap() whenever the bootstrap flag
    // exists -- the common path -- so replay used to never run there,
    // and a persistent rollback toast did not survive the reload it was
    // designed to survive.
    login();
    const db = getLocalDb();
    await db.rejectionToasts.put({
      id: 'rej-open',
      clientOpId: 'rej-open',
      userId: USER_ID,
      entityClass: 'character',
      entityId: CHAR_ID,
      humanName: 'ST',
      reason: 'ST must be <= 20',
      status: 'rejected',
      createdAt: new Date().toISOString(),
    });

    const seen: string[] = [];
    setRejectionNotifier((rec) => seen.push(rec.id));
    try {
      getSyncOrchestrator().setCurrentUser(USER_ID);
      await waitFor(() => expect(seen).toContain('rej-open'));
    } finally {
      setRejectionNotifier(null);
    }
  });

  it('replays when the notifier registers after the user is known', async () => {
    // SyncProvider wires the notifier in a mount effect that can land
    // after the gate sets the user; replaying into a null notifier
    // would silently drop every toast.
    login();
    await getLocalDb().rejectionToasts.put({
      id: 'rej-late',
      clientOpId: 'rej-late',
      userId: USER_ID,
      entityClass: 'character',
      entityId: CHAR_ID,
      humanName: 'DX',
      reason: 'rejected',
      status: 'rejected',
      createdAt: new Date().toISOString(),
    });

    getSyncOrchestrator().setCurrentUser(USER_ID);

    const seen: string[] = [];
    setRejectionNotifier((rec) => seen.push(rec.id));
    try {
      await waitFor(() => expect(seen).toContain('rej-late'));
    } finally {
      setRejectionNotifier(null);
    }
  });

  it('prunes stale rejection records on that same pass', async () => {
    login();
    const db = getLocalDb();
    await db.rejectionToasts.put({
      id: 'rej-ancient',
      clientOpId: 'rej-ancient',
      userId: USER_ID,
      entityClass: 'character',
      entityId: CHAR_ID,
      humanName: 'ST',
      reason: 'newer server revision',
      status: 'rejected',
      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    });

    setRejectionNotifier(() => {});
    try {
      getSyncOrchestrator().setCurrentUser(USER_ID);
      await waitFor(async () => {
        expect((await db.rejectionToasts.get('rej-ancient'))?.dismissedAt).toBeTruthy();
      });
    } finally {
      setRejectionNotifier(null);
    }
  });

  it("never replays another account's rejections", async () => {
    // A session can end without a purge (a refresh-token rejection just
    // clears the tokens), so signing in as someone else must not
    // surface the previous account's toasts and their private labels.
    login();
    await getLocalDb().rejectionToasts.put({
      id: 'rej-other',
      clientOpId: 'rej-other',
      userId: '0193b3c0-f1f0-7000-8000-00000000bbbb',
      entityClass: 'character_skill',
      entityId: 'skill-9',
      humanName: 'skill "Another Account Secret"',
      reason: 'rejected',
      status: 'rejected',
      createdAt: new Date().toISOString(),
    });

    const seen: string[] = [];
    setRejectionNotifier((rec) => seen.push(rec.id));
    try {
      getSyncOrchestrator().setCurrentUser(USER_ID);
      await new Promise((r) => setTimeout(r, 200));
      expect(seen).not.toContain('rej-other');
    } finally {
      setRejectionNotifier(null);
    }
  });
});
