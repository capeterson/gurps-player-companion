/**
 * Outbox semantics: the "latest patch wins per (entityId, fieldPath)"
 * rule from AGENTS.md, plus the parallel-different-fields case.
 */

import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import { type OutboxEntry, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { flashBus } from './flashBus.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import {
  MAX_ATTEMPTS,
  backoffMs,
  claimDrainableOps,
  enqueueCreate,
  enqueueDeletes,
  enqueueFieldPatch,
  enqueueFieldPatches,
  readDrainableOps,
  recoverStaleInFlight,
} from './outbox.ts';
import { syncStateStore } from './state.ts';

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

describe('enqueueFieldPatch', () => {
  it('rolls back an entire multi-field gesture when durable queueing fails', async () => {
    await seedCharacter();
    const db = getLocalDb();
    const add = db.outbox.add.bind(db.outbox);
    vi.spyOn(db.outbox, 'add')
      .mockImplementationOnce(add)
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      enqueueFieldPatches([
        {
          entityClass: 'character',
          entityId: CHAR_ID,
          fieldPath: 'st',
          attemptedValue: 12,
        },
        {
          entityClass: 'character',
          entityId: CHAR_ID,
          fieldPath: 'dx',
          attemptedValue: 13,
        },
      ]),
    ).rejects.toThrow('storage unavailable');

    expect(await db.characters.get(CHAR_ID)).toMatchObject({ st: 10, dx: 10 });
    expect(await db.outbox.count()).toBe(0);
  });

  it('rolls back every local delete in a failed bulk-delete gesture', async () => {
    const db = getLocalDb();
    const firstId = '0193b3c0-f1f0-7000-8000-00000000d101';
    const secondId = '0193b3c0-f1f0-7000-8000-00000000d102';
    const rows = [
      { id: firstId, characterId: CHAR_ID, name: 'One', revision: 1 },
      { id: secondId, characterId: CHAR_ID, name: 'Two', revision: 1 },
    ] as never[];
    await db.characterInventory.bulkPut(rows);
    const add = db.outbox.add.bind(db.outbox);
    vi.spyOn(db.outbox, 'add')
      .mockImplementationOnce(add)
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      enqueueDeletes(
        rows.map((row) => ({
          entityClass: 'character_inventory',
          entityId: (row as { id: string }).id,
          characterId: CHAR_ID,
          prevValue: row,
        })),
      ),
    ).rejects.toThrow('storage unavailable');

    expect(await db.characterInventory.bulkGet([firstId, secondId])).toEqual(rows);
    expect(await db.outbox.count()).toBe(0);
  });

  it('rejects mismatched local create declarations atomically', async () => {
    await seedCharacter();
    const entityId = '0193b3c0-f1f0-7000-8000-00000000d003';
    await expect(
      enqueueCreate({
        entityClass: 'character_trait',
        entityId,
        characterId: CHAR_ID,
        attemptedValue: { name: 'Wrong copy', libraryTraitId: CHAR_ID },
        localLibraryMechanics: {
          sourceId: entityId,
          campaignId: null,
          sourceRevision: null,
          effects: [],
        },
      }),
    ).rejects.toThrow('do not match');
    expect(await getLocalDb().characterTraits.get(entityId)).toBeUndefined();
    expect(await getLocalDb().outbox.count()).toBe(0);
  });
  for (const entityClass of ['character_trait', 'character_skill'] as const) {
    it.each(['applied', 'rejected', 'suspended'])(
      `${entityClass}: keeps local-only declarations durably and handles %s sync`,
      async (status) => {
        await seedCharacter();
        const sourceId = '0193b3c0-f1f0-7000-8000-00000000d002';
        const childId = '0193b3c0-f1f0-7000-8000-00000000d003';
        const campaignId = '0193b3c0-f1f0-7000-8000-00000000d004';
        const db = getLocalDb();
        await db.characters.update(CHAR_ID, { campaignId });
        const table = entityClass === 'character_trait' ? db.characterTraits : db.characterSkills;
        const metadata: LibraryMechanics = {
          sourceId,
          campaignId,
          sourceRevision: null,
          effects: [{ target: 'dx', value: 2, scaling: 'flat' }],
        };
        await enqueueCreate({
          entityClass,
          entityId: childId,
          characterId: CHAR_ID,
          humanName: 'Owned rules',
          attemptedValue: {
            characterId: CHAR_ID,
            name: 'Owned',
            points: 2,
            ...(entityClass === 'character_trait'
              ? { kind: 'advantage', libraryTraitId: sourceId }
              : { attribute: 'DX', difficulty: 'A', librarySkillId: sourceId }),
          },
          localLibraryMechanics: metadata,
        });
        const provisional = await table.get(childId);
        expect(provisional?.libraryMechanics).toEqual(metadata);
        db.close();
        await db.open();
        expect((await table.get(childId))?.libraryMechanics).toEqual(metadata);
        expect((await db.outbox.toArray())[0]?.attemptedValue).not.toHaveProperty(
          'libraryMechanics',
        );
        tokenStore.write({
          accessToken: jwtForUser('0193b3c0-f1f0-7000-8000-00000000aaaa'),
          refreshToken: 'r',
          accessTokenExpiresIn: 0,
        });
        const flash = vi.fn();
        const off = flashBus.subscribe(`${entityClass}:${CHAR_ID}:create`, flash);
        const authoritative = { ...metadata, sourceRevision: 7 };
        vi.stubGlobal(
          'fetch',
          vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
            if (url.includes('/sync/operations')) {
              const body = JSON.parse(String(init?.body)) as {
                operations: { clientOpId: string; attemptedValue: unknown }[];
              };
              for (const op of body.operations)
                expect(op.attemptedValue).not.toHaveProperty('libraryMechanics');
              return new Response(
                JSON.stringify({
                  outcomes: body.operations.map((op) => ({
                    clientOpId: op.clientOpId,
                    status,
                    ...(status === 'applied'
                      ? { newRevision: 8 }
                      : { reason: 'Library link rejected' }),
                  })),
                }),
              );
            }
            return new Response(
              JSON.stringify({
                changes:
                  status === 'applied'
                    ? [
                        {
                          entityClass,
                          entityId: childId,
                          command: 'patch',
                          revision: 8,
                          data: { ...provisional, revision: 8, libraryMechanics: authoritative },
                        },
                      ]
                    : [],
                nextCursor: {},
                hasMore: {},
              }),
            );
          }),
        );
        getSyncOrchestrator().start();
        try {
          await waitFor(async () => expect(await db.outbox.count()).toBe(0));
          if (status === 'applied')
            await waitFor(async () =>
              expect((await table.get(childId))?.libraryMechanics).toEqual(authoritative),
            );
          else {
            expect(await table.get(childId)).toBeUndefined();
            expect((await db.rejectionToasts.toArray())[0]?.reason).toContain(
              'Library link rejected',
            );
            await waitFor(() => expect(flash).toHaveBeenCalled());
          }
        } finally {
          getSyncOrchestrator().stop();
          off();
        }
      },
    );
  }
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
  it.each(['rejected', 'conflict', 'suspended'] as const)(
    'preserves later pool edits after an earlier %s pair and repairs rollback anchors',
    async (status) => {
      await seedCharacter();
      const db = getLocalDb();
      await db.characterCombat.put({
        id: CHAR_ID,
        characterId: CHAR_ID,
        currentHp: 10,
        currentFp: 0,
        posture: 'standing',
        conditions: [],
        maneuver: null,
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      tokenStore.write({
        accessToken: jwtForUser('0193b3c0-f1f0-7000-8000-00000000aaaa'),
        refreshToken: 'refresh',
        accessTokenExpiresIn: 3600,
      });
      const patch = (fieldPath: string, attemptedValue: number) => ({
        entityClass: 'character_combat' as const,
        entityId: CHAR_ID,
        fieldPath,
        attemptedValue,
      });
      await enqueueFieldPatches([patch('currentHp', 9), patch('currentFp', -1)]);
      let releaseFirst = () => {};
      let releaseSecond = () => {};
      const first = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const second = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      let requests = 0;
      const response = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if (!url.includes('/sync/operations'))
            return response({ changes: [], nextCursor: {}, hasMore: {} });
          const body = JSON.parse(String(init?.body)) as { operations: OutboxEntry[] };
          requests++;
          await (requests === 1 ? first : second);
          return response({
            outcomes: body.operations.map((op) => ({
              clientOpId: op.clientOpId,
              status,
              reason: 'Pool rejected',
              ...(status === 'conflict'
                ? {
                    latestEntity: {
                      characterId: CHAR_ID,
                      currentHp: 10,
                      currentFp: 0,
                      maneuver: 'do_nothing',
                      revision: 2,
                    },
                  }
                : {}),
            })),
          });
        }),
      );
      getSyncOrchestrator().start();
      try {
        await waitFor(() => expect(requests).toBe(1));
        await enqueueFieldPatches([patch('currentHp', 8), patch('currentFp', -2)]);
        await enqueueFieldPatch(patch('currentHp', 7));
        await enqueueFieldPatch({
          ...patch('currentHp', 7),
          fieldPath: 'maneuver',
          attemptedValue: 'attack',
        });
        releaseFirst();
        await waitFor(() => {
          getSyncOrchestrator().triggerDrain();
          expect(requests).toBe(2);
        });
        expect(await db.characterCombat.get(CHAR_ID)).toMatchObject({
          currentHp: 7,
          currentFp: -2,
          maneuver: 'attack',
        });
        releaseSecond();
        await waitFor(async () => expect(await db.outbox.count()).toBe(0));
        expect(await db.characterCombat.get(CHAR_ID)).toMatchObject({
          currentHp: 10,
          currentFp: 0,
        });
      } finally {
        releaseFirst();
        releaseSecond();
        getSyncOrchestrator().stop();
      }
    },
  );

  it.each(['applied', 'rejected'] as const)(
    'settles both queued fatigue fields with %s outcomes',
    async (status) => {
      await seedCharacter();
      const db = getLocalDb();
      await db.characterCombat.put({
        id: CHAR_ID,
        characterId: CHAR_ID,
        currentHp: 10,
        currentFp: 0,
        posture: 'standing',
        conditions: [],
        maneuver: null,
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      tokenStore.write({
        accessToken: jwtForUser('0193b3c0-f1f0-7000-8000-00000000aaaa'),
        refreshToken: 'refresh',
        accessTokenExpiresIn: 3600,
      });
      const patches = (hp: number, fp: number) =>
        Object.entries({ currentHp: hp, currentFp: fp }).map(([fieldPath, attemptedValue]) => ({
          entityClass: 'character_combat' as const,
          entityId: CHAR_ID,
          fieldPath,
          attemptedValue,
          humanName: fieldPath === 'currentHp' ? 'HP' : 'FP',
        }));
      await enqueueFieldPatches(patches(9, -1));
      await enqueueFieldPatches(patches(8, -2));
      const flash = vi.spyOn(flashBus, 'emit');
      const response = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      let latest: string = syncStateStore.value;
      const off = syncStateStore.subscribe((s) => {
        latest = s;
      });
      let sentStaleCursor = false;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url.includes('/sync/operations')) {
            const body = JSON.parse(String(init?.body)) as { operations: OutboxEntry[] };
            return response({
              outcomes: body.operations.map((op) => ({
                clientOpId: op.clientOpId,
                status,
                newRevision: 2,
                reason: 'Pool rejected',
              })),
            });
          }
          const changes = sentStaleCursor
            ? []
            : [
                {
                  entityClass: 'character_combat',
                  entityId: CHAR_ID,
                  command: 'patch',
                  revision: 2,
                  data: {
                    id: CHAR_ID,
                    characterId: CHAR_ID,
                    currentHp: 10,
                    currentFp: 0,
                    posture: 'kneeling',
                    revision: 2,
                  },
                },
              ];
          sentStaleCursor = true;
          return response({ changes, nextCursor: {}, hasMore: {} });
        }),
      );
      await getSyncOrchestrator().triggerCursorPull();
      expect(await db.characterCombat.get(CHAR_ID)).toMatchObject({
        currentHp: 8,
        currentFp: -2,
        posture: 'kneeling',
      });
      getSyncOrchestrator().start();
      try {
        await waitFor(async () => expect(await db.outbox.count()).toBe(0));
        expect(await db.characterCombat.get(CHAR_ID)).toMatchObject(
          status === 'applied' ? { currentHp: 8, currentFp: -2 } : { currentHp: 10, currentFp: 0 },
        );
        if (status === 'rejected') {
          expect((await db.rejectionToasts.toArray()).map((r) => r.fieldPath).sort()).toEqual([
            'currentFp',
            'currentHp',
          ]);
          expect(flash.mock.calls.map((call) => call[0].key).sort()).toEqual([
            `character_combat:${CHAR_ID}:currentFp`,
            `character_combat:${CHAR_ID}:currentHp`,
          ]);
        }
        await waitFor(() => expect(latest).toBe('synced'), { timeout: 3000 });
      } finally {
        getSyncOrchestrator().stop();
        off();
      }
    },
  );

  it.each(['rejected', 'conflict', 'suspended'] as const)(
    'retains the optimistic edit and retry path when a %s notice cannot be persisted',
    async (status) => {
      await seedCharacter();
      const db = getLocalDb();
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
      const persist = vi.spyOn(db.rejectionToasts, 'put').mockRejectedValue(new Error('Disk full'));
      const flash = vi.spyOn(flashBus, 'emit');
      const response = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if (!url.includes('/sync/operations'))
            return response({ changes: [], nextCursor: {}, hasMore: {} });
          const body = JSON.parse(String(init?.body)) as { operations: OutboxEntry[] };
          return response({
            outcomes: body.operations.map((op) => ({
              clientOpId: op.clientOpId,
              status,
              reason: 'Rejected edit',
              ...(status === 'conflict'
                ? { latestEntity: { id: CHAR_ID, st: 10, revision: 2 } }
                : {}),
            })),
          });
        }),
      );
      getSyncOrchestrator().start();
      try {
        await waitFor(() => expect(persist).toHaveBeenCalled());
        // Wait for the failed transaction to finish before checking recovery state.
        await waitFor(async () => {
          expect((await db.characters.get(CHAR_ID))?.st).toBe(11);
          expect(await db.outbox.count()).toBe(1);
          expect(await db.rejectionToasts.count()).toBe(0);
        });
        expect(flash).not.toHaveBeenCalled();
        persist.mockRestore();
        await waitFor(async () => {
          getSyncOrchestrator().triggerDrain();
          expect(await db.outbox.count()).toBe(0);
        });
        expect((await db.characters.get(CHAR_ID))?.st).toBe(10);
        expect(await db.rejectionToasts.count()).toBe(1);
        await waitFor(() => expect(flash).toHaveBeenCalled());
      } finally {
        getSyncOrchestrator().stop();
      }
    },
  );

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

describe('character_language / character_technique outbox lifecycle (S11)', () => {
  const LANG_ID = '0193b3c0-f1f0-7000-8000-00000000d011';
  const TECH_ID = '0193b3c0-f1f0-7000-8000-00000000d012';
  const USER_ID = '0193b3c0-f1f0-7000-8000-00000000d0aa';

  async function seedCharWithRows() {
    const db = getLocalDb();
    await db.characters.put({
      id: CHAR_ID,
      ownerId: USER_ID,
      campaignId: null,
      name: 'Test',
      st: 10,
      dx: 10,
      iq: 10,
      ht: 10,
      revision: 1,
    } as never);
    await db.characterLanguages.put({
      id: LANG_ID,
      characterId: CHAR_ID,
      name: 'Cathrian',
      spokenFluency: 'native',
      writtenFluency: 'none',
      points: 0,
      notes: null,
      libraryLanguageId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 5,
    } as never);
    await db.characterTechniques.put({
      id: TECH_ID,
      characterId: CHAR_ID,
      name: 'Combat Riding',
      defaultSkillName: 'Riding (Equines)',
      difficulty: 'H',
      points: 0,
      defaultModifier: 0,
      maxLevel: null,
      notes: null,
      libraryTechniqueId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 9,
    } as never);
  }

  function login() {
    tokenStore.write({
      accessToken: jwtForUser(USER_ID),
      refreshToken: 'r',
      accessTokenExpiresIn: 0,
    });
  }

  it('same-field language patches coalesce; the latest wins and prevValue is the original', async () => {
    await seedCharWithRows();
    await enqueueFieldPatch({
      entityClass: 'character_language',
      entityId: LANG_ID,
      fieldPath: 'spokenFluency',
      attemptedValue: 'broken',
    });
    await enqueueFieldPatch({
      entityClass: 'character_language',
      entityId: LANG_ID,
      fieldPath: 'spokenFluency',
      attemptedValue: 'accented',
    });
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.attemptedValue).toBe('accented');
    expect(ops[0]?.prevValue).toBe('native'); // original, not 'broken'
    expect((await getLocalDb().characterLanguages.get(LANG_ID))?.spokenFluency).toBe('accented');
  });

  it('different-field technique patches stay independent and both land locally', async () => {
    await seedCharWithRows();
    await enqueueFieldPatch({
      entityClass: 'character_technique',
      entityId: TECH_ID,
      fieldPath: 'defaultModifier',
      attemptedValue: -7,
    });
    await enqueueFieldPatch({
      entityClass: 'character_technique',
      entityId: TECH_ID,
      fieldPath: 'points',
      attemptedValue: 2,
    });
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(2);
    const row = await getLocalDb().characterTechniques.get(TECH_ID);
    expect(row?.defaultModifier).toBe(-7);
    expect(row?.points).toBe(2);
  });

  it('a language create drains, applies server-side, and the indicator returns to synced', async () => {
    await seedCharacter();
    login();
    const langId = '0193b3c0-f1f0-7000-8000-00000000d013';
    await enqueueCreate({
      entityClass: 'character_language',
      entityId: langId,
      characterId: CHAR_ID,
      humanName: 'language',
      attemptedValue: {
        name: 'Elvish',
        spokenFluency: 'native',
        writtenFluency: 'none',
        points: 0,
      },
    });
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string }>;
        };
        const outcomes = body.operations.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'applied' as const,
          newRevision: 6,
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

    // The indicator store has no getter; subscribe and track the latest
    // committed state (commit defers 'synced' by MIN_DWELL_MS).
    let latest: string | null = null;
    const off = syncStateStore.subscribe((s) => {
      latest = s;
    });

    getSyncOrchestrator().start();
    try {
      await waitFor(async () => {
        const row = await getLocalDb().characterLanguages.get(langId);
        expect(row?.revision).toBe(6);
      });
      await waitFor(
        () => {
          expect(latest).toBe('synced');
        },
        { timeout: 3000 },
      );
      expect(await getLocalDb().rejectionToasts.count()).toBe(0);
      expect(await getLocalDb().outbox.count()).toBe(0);
    } finally {
      getSyncOrchestrator().stop();
      off();
    }
  });

  it('a rejected technique patch rolls back, persists a toast record, and emits a flash', async () => {
    await seedCharWithRows();
    login();
    await enqueueFieldPatch({
      entityClass: 'character_technique',
      entityId: TECH_ID,
      fieldPath: 'defaultModifier',
      attemptedValue: -7,
    });
    // Subscribe before the drain so the async rollback event is captured.
    const flashKey = `character_technique:${TECH_ID}:defaultModifier`;
    const flashListener = vi.fn();
    const off = flashBus.subscribe(flashKey, flashListener);
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string; entityId: string }>;
        };
        const outcomes = body.operations.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'rejected' as const,
          reason: 'defaultModifier rejected in test',
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
        // Rolled back to the pre-edit value…
        const row = await getLocalDb().characterTechniques.get(TECH_ID);
        expect(row?.defaultModifier).toBe(0);
      });
      // …the durable rejection record exists for the toast…
      const recs = await getLocalDb().rejectionToasts.toArray();
      expect(
        recs.some(
          (r) => r.entityClass === 'character_technique' && r.fieldPath === 'defaultModifier',
        ),
      ).toBe(true);
      // …and the flash bus fired the row-level/field flash event.
      await waitFor(() => expect(flashListener).toHaveBeenCalled());
    } finally {
      getSyncOrchestrator().stop();
      off();
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

  it('holds inventory children and reparent patches until their container create settles', async () => {
    const db = getLocalDb();
    const containerId = '0193b3c0-f1f0-7000-8000-00000000e101';
    const childId = '0193b3c0-f1f0-7000-8000-00000000e102';
    await db.outbox.bulkPut([
      opRow({
        clientOpId: 'container-create',
        entityClass: 'character_inventory',
        entityId: containerId,
        command: 'create',
        coalesceKey: `${containerId}|:create`,
        fieldPath: undefined,
        parentId: CHAR_ID,
        attemptedValue: { name: 'Bag', isContainer: true, parentId: null },
        enqueuedAt: '2026-01-01T00:00:00.000Z',
      }),
      opRow({
        clientOpId: 'child-create',
        entityClass: 'character_inventory',
        entityId: childId,
        command: 'create',
        coalesceKey: `${childId}|:create`,
        fieldPath: undefined,
        parentId: CHAR_ID,
        attemptedValue: { name: 'Rations', parentId: containerId },
        enqueuedAt: '2026-01-01T00:00:01.000Z',
      }),
      opRow({
        clientOpId: 'reparent',
        entityClass: 'character_inventory',
        entityId: '0193b3c0-f1f0-7000-8000-00000000e103',
        coalesceKey: '0193b3c0-f1f0-7000-8000-00000000e103|parentId',
        fieldPath: 'parentId',
        parentId: CHAR_ID,
        attemptedValue: containerId,
        enqueuedAt: '2026-01-01T00:00:02.000Z',
      }),
    ]);

    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(['container-create']);
    await db.outbox.delete('container-create');
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([
      'child-create',
      'reparent',
    ]);
  });
});

describe('claimDrainableOps', () => {
  it('atomically gives a pending operation to only one concurrent drain', async () => {
    const db = getLocalDb();
    await db.outbox.put(opRow({ clientOpId: 'claim-once' }));

    const claims = await Promise.all([claimDrainableOps(50), claimDrainableOps(50)]);
    expect(claims.flat().map((op) => op.clientOpId)).toEqual(['claim-once']);
    expect((await db.outbox.get('claim-once'))?.status).toBe('in_flight');
    expect((await db.outbox.get('claim-once'))?.attemptCount).toBe(1);
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
