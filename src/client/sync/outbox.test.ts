/**
 * Outbox semantics: the "latest patch wins per (entityId, fieldPath)"
 * rule from AGENTS.md, plus the parallel-different-fields case.
 */

import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuid } from '../../shared/schemas/common.ts';
import type { LibraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import { type OutboxEntry, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { flashBus } from './flashBus.ts';
import { libraryDependencyHeld } from './libraryDependencies.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import {
  MAX_ATTEMPTS,
  backoffMs,
  claimDrainableOps,
  enqueueCreate,
  enqueueDeletes,
  enqueueEntityPatch,
  enqueueFieldPatch,
  enqueueFieldPatches,
  newClientId,
  nextOutboxAttemptDelay,
  readDrainableOps,
  recoverStaleInFlight,
} from './outbox.ts';
import { syncStateStore } from './state.ts';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  syncStateStore.reset('synced');
  vi.useRealTimers();
  await resetLocalDb();
});

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000c001';

describe('newClientId', () => {
  it('returns a valid UUID when randomUUID is available', () => {
    expect(uuid.safeParse(newClientId()).success).toBe(true);
  });

  it('uses random bytes to produce a valid v4 UUID when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
        return bytes;
      },
    });

    expect(newClientId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(uuid.safeParse(newClientId()).success).toBe(true);
  });

  it('still produces a valid v4 UUID when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const id = newClientId();
    expect(id).toBe('80808080-8080-4080-8080-808080808080');
    expect(uuid.safeParse(id).success).toBe(true);
  });
});

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
  it('lets an explicit source choice replace and unblock a retained unmapped library edit', async () => {
    const db = getLocalDb();
    const traitId = '0193b3c0-f1f0-7000-8000-00000000e220';
    const campaignId = '0193b3c0-f1f0-7000-8000-00000000e221';
    const selectedSourceId = '0193b3c0-f1f0-7000-8000-00000000e222';
    await db.campaignLibraryTraits.put({
      id: traitId,
      campaignId,
      name: 'Vision',
      sourceId: null,
      revision: 4,
    } as never);
    await db.outbox.put({
      clientOpId: 'retained-source-edit',
      entityClass: 'campaign_library_trait',
      entityId: traitId,
      parentId: campaignId,
      command: 'patch',
      coalesceKey: `${traitId}|`,
      attemptedValue: { name: 'Old vision', sourceKey: 'unmapped-book' },
      prevValue: { name: 'Vision', sourceId: null },
      validationVersion: 1,
      status: 'pending',
      enqueuedAt: '2026-09-30T00:00:00.000Z',
      attemptCount: 0,
      localSourceMigrationUnknown: true,
      localSourceMigrationIntent: {
        attemptedValue: { name: 'Old vision', sourceKey: 'unmapped-book' },
        prevValue: { name: 'Vision', sourceId: null },
      },
    });

    await enqueueEntityPatch({
      entityClass: 'campaign_library_trait',
      entityId: traitId,
      campaignId,
      attemptedValue: { name: 'Vision revised', sourceId: selectedSourceId },
    });

    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entityClass: 'campaign_library_trait',
      attemptedValue: { name: 'Vision revised', sourceId: selectedSourceId },
      prevValue: { name: 'Vision', sourceId: null },
    });
    expect(queued[0]).not.toHaveProperty('fieldPath');
    expect(queued[0]).not.toHaveProperty('localSourceMigrationUnknown');
    expect(queued[0]).not.toHaveProperty('localSourceMigrationIntent');
    expect((await readDrainableOps(50)).map((op) => op.attemptedValue)).toEqual([
      { name: 'Vision revised', sourceId: selectedSourceId },
    ]);
    expect(await db.campaignLibraryTraits.get(traitId)).toMatchObject({
      sourceId: selectedSourceId,
    });
  });

  it('serializes mixed whole-entry and overlapping field patches without coalescing across the boundary', async () => {
    const db = getLocalDb();
    const traitId = '0193b3c0-f1f0-7000-8000-00000000e201';
    await db.characterTraits.put({
      id: traitId,
      characterId: CHAR_ID,
      name: 'Alertness',
      points: 5,
      notes: 'old note',
      revision: 3,
    } as never);

    await enqueueEntityPatch({
      entityClass: 'character_trait',
      entityId: traitId,
      characterId: CHAR_ID,
      attemptedValue: { points: 6, notes: 'whole edit' },
    });
    await enqueueFieldPatch({
      entityClass: 'character_trait',
      entityId: traitId,
      characterId: CHAR_ID,
      fieldPath: 'points',
      attemptedValue: 7,
    });
    await enqueueFieldPatch({
      entityClass: 'character_trait',
      entityId: traitId,
      characterId: CHAR_ID,
      fieldPath: 'notes',
      attemptedValue: 'independent note',
    });

    const ops = await db.outbox.orderBy('enqueuedAt').toArray();
    expect(ops).toHaveLength(3);
    expect(ops.map((op) => op.fieldPath)).toEqual([undefined, 'points', 'notes']);
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([ops[0]?.clientOpId]);
    const wholePatch = ops[0];
    if (!wholePatch) throw new Error('whole-entry patch missing');
    await db.outbox.delete(wholePatch.clientOpId);
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([
      ops[1]?.clientOpId,
      ops[2]?.clientOpId,
    ]);
    expect((await db.characterTraits.get(traitId))?.points).toBe(7);
    expect((await db.characterTraits.get(traitId))?.notes).toBe('independent note');
  });

  it('keeps a preceding field edit as a dependency of a later whole-entry patch', async () => {
    const db = getLocalDb();
    const itemId = '0193b3c0-f1f0-7000-8000-00000000e202';
    await db.characterInventory.put({
      id: itemId,
      characterId: CHAR_ID,
      name: 'Rations',
      quantity: 2,
      notes: 'old note',
      revision: 4,
    } as never);

    await enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId: itemId,
      characterId: CHAR_ID,
      fieldPath: 'quantity',
      attemptedValue: 3,
    });
    await enqueueEntityPatch({
      entityClass: 'character_inventory',
      entityId: itemId,
      characterId: CHAR_ID,
      attemptedValue: { quantity: 4, notes: 'whole edit' },
    });

    const ops = await db.outbox.orderBy('enqueuedAt').toArray();
    expect(ops).toHaveLength(2);
    expect(ops[0]?.fieldPath).toBe('quantity');
    expect(ops[1]?.fieldPath).toBeUndefined();
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([ops[0]?.clientOpId]);
    expect(ops[1]?.prevValue).toMatchObject({ quantity: 3 });
  });

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
        })),
      ),
    ).rejects.toThrow('storage unavailable');

    expect(await db.characterInventory.bulkGet([firstId, secondId])).toEqual(rows);
    expect(await db.outbox.count()).toBe(0);
  });

  it('captures the raw local inventory row for delete rollback', async () => {
    const db = getLocalDb();
    const entityId = '0193b3c0-f1f0-7000-8000-00000000d103';
    const row = {
      id: entityId,
      characterId: CHAR_ID,
      name: 'Fortified mail',
      revision: 1,
      armor: { dr: 3, locations: ['torso'] },
      enchantments: [{ spellName: 'Fortify', mechanics: { effects: [] } }],
    };
    await db.characterInventory.put(row as never);

    await enqueueDeletes([{ entityClass: 'character_inventory', entityId, characterId: CHAR_ID }]);

    expect(await db.characterInventory.get(entityId)).toBeUndefined();
    expect((await db.outbox.toArray())[0]?.prevValue).toEqual(row);
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

  it('refreshes the network debounce deadline when a same-field patch coalesces', async () => {
    await seedCharacter();
    const firstDeadline = '2099-01-01T00:00:00.100Z';
    const secondDeadline = '2099-01-01T00:00:00.200Z';
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 11,
      nextEarliestAttemptAt: firstDeadline,
    });
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 12,
      nextEarliestAttemptAt: secondDeadline,
    });

    expect(await getLocalDb().outbox.toArray()).toMatchObject([
      { attemptedValue: 12, prevValue: 10, nextEarliestAttemptAt: secondDeadline },
    ]);
  });

  it('retains delivery-uncertain retries as predecessors of newer intent', async () => {
    await seedCharacter();
    const db = getLocalDb();
    await db.characters.update(CHAR_ID, { st: 11 });
    await db.outbox.put(
      opRow({
        clientOpId: 'uncertain-first',
        attemptedValue: 11,
        prevValue: 10,
        status: 'transient_retry',
        deliveryUncertain: true,
        nextEarliestAttemptAt: '2099-01-01T00:00:00.000Z',
      }),
    );

    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 12,
    });

    const rows = await db.outbox.toArray();
    const newer = rows.find((row) => row.clientOpId !== 'uncertain-first');
    expect(rows).toHaveLength(2);
    expect(newer).toMatchObject({
      attemptedValue: 12,
      prevValue: 11,
      predecessorClientOpId: 'uncertain-first',
    });
    expect(await readDrainableOps(50)).toEqual([]);
    await db.outbox.delete('uncertain-first');
    expect((await readDrainableOps(50)).map((row) => row.clientOpId)).toEqual([newer?.clientOpId]);
  });

  it('coalesces a server-confirmed transient retry because it cannot have applied', async () => {
    await seedCharacter();
    const db = getLocalDb();
    await db.characters.update(CHAR_ID, { st: 11 });
    await db.outbox.put(
      opRow({
        clientOpId: 'confirmed-transient',
        attemptedValue: 11,
        prevValue: 10,
        status: 'transient_retry',
        deliveryUncertain: false,
      }),
    );

    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 12,
    });

    expect(await db.outbox.toArray()).toMatchObject([
      { attemptedValue: 12, prevValue: 10, predecessorClientOpId: undefined },
    ]);
  });

  it('follows predecessor ancestry for the confirmed rollback baseline', async () => {
    await seedCharacter();
    const db = getLocalDb();
    await db.characters.update(CHAR_ID, { st: 12 });
    const sameTime = '2026-01-01T00:00:00.000Z';
    await db.outbox.bulkPut([
      opRow({
        clientOpId: 'z-root',
        attemptedValue: 11,
        prevValue: 10,
        status: 'transient_retry',
        deliveryUncertain: false,
        enqueuedAt: sameTime,
      }),
      opRow({
        clientOpId: 'a-successor',
        attemptedValue: 12,
        prevValue: 11,
        predecessorClientOpId: 'z-root',
        enqueuedAt: sameTime,
      }),
    ]);

    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHAR_ID,
      fieldPath: 'st',
      attemptedValue: 13,
    });

    const [survivor] = await db.outbox.toArray();
    expect(survivor).toMatchObject({ attemptedValue: 13, prevValue: 10 });

    tokenStore.write({
      accessToken: jwtForUser('0193b3c0-f1f0-7000-8000-00000000aaaa'),
      refreshToken: 'refresh',
      accessTokenExpiresIn: 3600,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.includes('/sync/operations')) {
          return new Response(JSON.stringify({ changes: [], nextCursor: {}, hasMore: {} }));
        }
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string }>;
        };
        return new Response(
          JSON.stringify({
            outcomes: body.operations.map((operation) => ({
              clientOpId: operation.clientOpId,
              status: 'rejected',
              reason: 'test rejection',
            })),
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const orchestrator = getSyncOrchestrator();
    orchestrator.start();
    try {
      await waitFor(async () => expect(await db.outbox.count()).toBe(0));
      expect((await db.characters.get(CHAR_ID))?.st).toBe(10);
    } finally {
      orchestrator.stop();
    }
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
      // Advance display dwell timers while leaving IndexedDB's asynchronous
      // tasks (setImmediate) and the clock real.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await getSyncOrchestrator().triggerCursorPull();
      expect(await db.characterCombat.get(CHAR_ID)).toMatchObject({
        currentHp: 8,
        currentFp: -2,
        posture: 'kneeling',
      });
      getSyncOrchestrator().start();
      try {
        await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
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
        await vi.advanceTimersByTimeAsync(1000);
        expect(latest).toBe('synced');
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

    // Track the actual initial state too: a fast drain can remain synced
    // throughout the minimum dwell window without emitting a transition.
    let latest: string = syncStateStore.value;
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

function createRow(overrides: Partial<OutboxEntry> & Pick<OutboxEntry, 'clientOpId'>): OutboxEntry {
  return opRow({
    ...overrides,
    command: 'create',
    coalesceKey: `${overrides.entityId}|:create`,
    fieldPath: undefined,
  });
}

describe('readDrainableOps', () => {
  const TRAIT_ID = '0193b3c0-f1f0-7000-8000-00000000e001';
  const future = new Date(Date.now() + 60_000).toISOString();

  it('reports the nearest strictly-future debounce deadline', async () => {
    const db = getLocalDb();
    const now = Date.now();
    await db.outbox.bulkPut([
      opRow({
        clientOpId: 'later',
        nextEarliestAttemptAt: new Date(now + 500).toISOString(),
      }),
      opRow({
        clientOpId: 'sooner',
        coalesceKey: `${CHAR_ID}|dx`,
        fieldPath: 'dx',
        nextEarliestAttemptAt: new Date(now + 200).toISOString(),
      }),
    ]);

    expect(await nextOutboxAttemptDelay(now)).toBe(200);
    expect(await readDrainableOps(50)).toEqual([]);
  });

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

  it('holds a source-qualified modifier create while its source create backs off', async () => {
    const db = getLocalDb();
    const campaignId = '0193b3c0-f1f0-7000-8000-00000000e104';
    const sourceId = '0193b3c0-f1f0-7000-8000-00000000e105';
    const modifierId = '0193b3c0-f1f0-7000-8000-00000000e106';
    const otherCampaignId = '0193b3c0-f1f0-7000-8000-00000000e107';
    const independentId = '0193b3c0-f1f0-7000-8000-00000000e10a';
    const coreSourceId = '0193b3c0-f1f0-7000-8000-00000000e116';
    await db.outbox.bulkPut([
      createRow({
        clientOpId: 'source-create',
        entityClass: 'campaign_library_source',
        entityId: sourceId,
        parentId: campaignId,
        attemptedValue: { name: 'Addon rules', abbreviation: 'AR', priority: 100 },
        status: 'transient_retry',
        nextEarliestAttemptAt: future,
        enqueuedAt: '2026-01-01T00:00:00.000Z',
      }),
      createRow({
        clientOpId: 'trait-create',
        entityClass: 'campaign_library_trait',
        entityId: '0193b3c0-f1f0-7000-8000-00000000e115',
        parentId: campaignId,
        attemptedValue: {
          name: 'Acute Vision',
          key: 'acute-vision',
          sourceId: coreSourceId,
          kind: 'advantage',
        },
        status: 'transient_retry',
        nextEarliestAttemptAt: future,
        enqueuedAt: '2026-01-01T00:00:00.500Z',
      }),
      createRow({
        clientOpId: 'modifier-create',
        entityClass: 'campaign_library_modifier',
        entityId: modifierId,
        parentId: campaignId,
        attemptedValue: {
          name: 'Fine',
          key: 'fine',
          sourceId,
          calculation: {
            version: 1,
            inputs: [],
            tables: [],
            nodes: [
              {
                id: 'cost',
                op: 'call',
                reference: {
                  section: 'traits',
                  key: 'acute-vision',
                  sourceId: coreSourceId,
                  kind: 'advantage',
                },
                output: 'points',
                arguments: {},
              },
            ],
            outputs: [],
          },
        },
        enqueuedAt: '2026-01-01T00:00:01.000Z',
      }),
      createRow({
        clientOpId: 'independent-create',
        entityClass: 'campaign_library_item',
        entityId: independentId,
        parentId: campaignId,
        attemptedValue: { name: 'Rope', key: 'rope' },
        enqueuedAt: '2026-01-01T00:00:02.000Z',
      }),
      createRow({
        clientOpId: 'other-campaign-create',
        entityClass: 'campaign_library_item',
        entityId: '0193b3c0-f1f0-7000-8000-00000000e10b',
        parentId: otherCampaignId,
        attemptedValue: { name: 'Other source', key: 'other-source' },
        enqueuedAt: '2026-01-01T00:00:03.000Z',
      }),
    ]);

    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([
      'independent-create',
      'other-campaign-create',
    ]);
    await db.outbox.delete('source-create');
    const remaining = await db.outbox.toArray();
    const modifier = remaining.find((op) => op.clientOpId === 'modifier-create');
    if (!modifier) throw new Error('modifier create missing');
    expect(libraryDependencyHeld(modifier, remaining, campaignId)).toBe(true);
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([
      'independent-create',
      'other-campaign-create',
    ]);
    await db.outbox.delete('trait-create');
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([
      'modifier-create',
      'independent-create',
      'other-campaign-create',
    ]);
  });

  it('holds a character inventory create until its referenced library item is acknowledged', async () => {
    const db = getLocalDb();
    const campaignId = '0193b3c0-f1f0-7000-8000-00000000e107';
    const libraryItemId = '0193b3c0-f1f0-7000-8000-00000000e108';
    const inventoryId = '0193b3c0-f1f0-7000-8000-00000000e109';
    await db.outbox.bulkPut([
      createRow({
        clientOpId: 'library-item-create',
        entityClass: 'campaign_library_item',
        entityId: libraryItemId,
        parentId: campaignId,
        attemptedValue: { name: 'Training sword', key: 'training-sword' },
        enqueuedAt: '2026-01-01T00:00:00.000Z',
      }),
      createRow({
        clientOpId: 'inventory-create',
        entityClass: 'character_inventory',
        entityId: inventoryId,
        parentId: CHAR_ID,
        attemptedValue: { name: 'Training sword', libraryItemId },
        enqueuedAt: '2026-01-01T00:00:01.000Z',
      }),
    ]);

    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([
      'library-item-create',
    ]);
    await db.outbox.delete('library-item-create');
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(['inventory-create']);
  });

  it('holds a snapshot copy until its earlier library pricing edit is acknowledged', async () => {
    const db = getLocalDb();
    const campaignId = '0193b3c0-f1f0-7000-8000-00000000e10c';
    const traitId = '0193b3c0-f1f0-7000-8000-00000000e10d';
    const copyId = '0193b3c0-f1f0-7000-8000-00000000e10e';
    await seedCharacter();
    await db.characters.update(CHAR_ID, { campaignId });
    await db.outbox.bulkPut([
      opRow({
        clientOpId: 'trait-rule-edit',
        entityClass: 'campaign_library_trait',
        entityId: traitId,
        command: 'patch',
        coalesceKey: `${traitId}|entry`,
        fieldPath: undefined,
        parentId: campaignId,
        attemptedValue: {
          name: 'Night Vision',
          key: 'night-vision',
          sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
        },
        prevValue: {
          name: 'Night Vision',
          key: 'night-vision',
          sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
        },
        status: 'transient_retry',
        nextEarliestAttemptAt: future,
        enqueuedAt: '2026-01-01T00:00:00.000Z',
      }),
      createRow({
        clientOpId: 'trait-snapshot-create',
        entityClass: 'character_trait',
        entityId: copyId,
        parentId: CHAR_ID,
        localRequiredCampaignId: campaignId,
        attemptedValue: {
          name: 'Night Vision',
          libraryTraitId: traitId,
          pricingResolution: {
            definitionId: traitId,
            reference: {
              section: 'traits',
              key: 'night-vision',
              sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
              kind: 'advantage',
            },
          },
        },
        enqueuedAt: '2026-01-01T00:00:01.000Z',
      }),
    ]);

    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([]);
    await db.outbox.delete('trait-rule-edit');
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([
      'trait-snapshot-create',
    ]);
  });

  it('holds a library definition delete until a prior edit removes its rule reference', async () => {
    const db = getLocalDb();
    const campaignId = '0193b3c0-f1f0-7000-8000-00000000e10f';
    const traitId = '0193b3c0-f1f0-7000-8000-00000000e110';
    const modifierId = '0193b3c0-f1f0-7000-8000-00000000e111';
    await db.outbox.bulkPut([
      opRow({
        clientOpId: 'remove-rule-reference',
        entityClass: 'campaign_library_trait',
        entityId: traitId,
        command: 'patch',
        coalesceKey: `${traitId}|entry`,
        fieldPath: undefined,
        parentId: campaignId,
        prevValue: {
          name: 'Night Vision',
          key: 'night-vision',
          sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
          calculation: {
            version: 1,
            inputs: [],
            tables: [],
            nodes: [
              {
                id: 'modifier',
                op: 'call',
                reference: {
                  section: 'modifiers',
                  key: 'accurate',
                  sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
                },
                output: 'modifier',
                arguments: {},
              },
            ],
            outputs: [],
          },
        },
        attemptedValue: {
          name: 'Night Vision',
          key: 'night-vision',
          sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
          calculation: null,
        },
        status: 'transient_retry',
        nextEarliestAttemptAt: future,
        enqueuedAt: '2026-01-01T00:00:00.000Z',
      }),
      opRow({
        clientOpId: 'delete-modifier',
        entityClass: 'campaign_library_modifier',
        entityId: modifierId,
        command: 'delete',
        coalesceKey: `${modifierId}|:delete`,
        fieldPath: undefined,
        parentId: campaignId,
        prevValue: {
          name: 'Accurate',
          key: 'accurate',
          sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
        },
        enqueuedAt: '2026-01-01T00:00:01.000Z',
      }),
    ]);

    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([]);
    await db.outbox.delete('remove-rule-reference');
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(['delete-modifier']);
  });

  it('breaks same-millisecond advisory rule dependencies deterministically', async () => {
    const db = getLocalDb();
    const campaignId = '0193b3c0-f1f0-7000-8000-00000000e112';
    const sameInstant = '2026-01-01T00:00:00.000Z';
    const call = (section: 'traits' | 'modifiers', key: string) => ({
      version: 1,
      inputs: [],
      tables: [],
      nodes: [
        {
          id: 'other',
          op: 'call',
          reference: {
            section,
            key,
            sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
            ...(section === 'traits' ? { kind: 'advantage' } : {}),
          },
          output: section === 'traits' ? 'points' : 'modifier',
          arguments: {},
        },
      ],
      outputs: [],
    });
    await db.outbox.bulkPut([
      opRow({
        clientOpId: 'patch-a',
        entityClass: 'campaign_library_trait',
        entityId: '0193b3c0-f1f0-7000-8000-00000000e113',
        coalesceKey: 'alpha|entry',
        fieldPath: undefined,
        parentId: campaignId,
        prevValue: {
          name: 'Alpha',
          key: 'alpha',
          sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
          kind: 'advantage',
        },
        attemptedValue: {
          name: 'Alpha',
          key: 'alpha',
          sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
          kind: 'advantage',
          calculation: call('modifiers', 'beta'),
        },
        enqueuedAt: sameInstant,
      }),
      opRow({
        clientOpId: 'patch-b',
        entityClass: 'campaign_library_modifier',
        entityId: '0193b3c0-f1f0-7000-8000-00000000e114',
        coalesceKey: 'beta|entry',
        fieldPath: undefined,
        parentId: campaignId,
        prevValue: {
          name: 'Beta',
          key: 'beta',
          sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
          kind: 'advantage',
        },
        attemptedValue: {
          name: 'Beta',
          key: 'beta',
          sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
          kind: 'advantage',
          applicability: {
            traits: [
              {
                section: 'traits',
                key: 'alpha',
                sourceId: '0193b3c0-f1f0-7000-8000-00000000e116',
                kind: 'advantage',
              },
            ],
          },
        },
        enqueuedAt: sameInstant,
      }),
    ]);

    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(['patch-a']);
  });
});

describe('claimDrainableOps', () => {
  it('leaves a source migration with unknown provenance queued and unclaimed', async () => {
    const db = getLocalDb();
    await db.outbox.put(
      opRow({
        clientOpId: 'unknown-source-reference',
        entityClass: 'campaign_library_trait',
        entityId: '0193b3c0-f1f0-7000-8000-00000000e120',
        command: 'patch',
        fieldPath: 'sourceId',
        parentId: '0193b3c0-f1f0-7000-8000-00000000e121',
        attemptedValue: 'unmapped legacy source',
        prevValue: null,
        localSourceMigrationUnknown: true,
        localSourceMigrationIntent: {
          attemptedValue: 'unmapped legacy source',
          prevValue: null,
        },
      }),
    );

    expect(await claimDrainableOps(50)).toEqual([]);
    expect(await db.outbox.get('unknown-source-reference')).toMatchObject({
      status: 'pending',
      attemptedValue: 'unmapped legacy source',
      localSourceMigrationUnknown: true,
    });
  });

  it('normalizes a legacy uncertain retry ahead of its pending successor', async () => {
    const db = getLocalDb();
    await db.outbox.bulkPut([
      opRow({
        clientOpId: 'legacy-retry',
        attemptedValue: 11,
        status: 'transient_retry',
        deliveryUncertain: undefined,
        // The wall clock moved backward before the successor was queued.
        enqueuedAt: '2026-01-01T00:00:02.000Z',
      }),
      opRow({
        clientOpId: 'legacy-successor',
        attemptedValue: 12,
        prevValue: 11,
        enqueuedAt: '2026-01-01T00:00:01.000Z',
      }),
    ]);

    expect((await claimDrainableOps(50)).map((row) => row.clientOpId)).toEqual(['legacy-retry']);
    expect(await db.outbox.get('legacy-retry')).toMatchObject({
      status: 'in_flight',
      deliveryUncertain: true,
    });
    expect(await db.outbox.get('legacy-successor')).toMatchObject({
      status: 'pending',
      predecessorClientOpId: 'legacy-retry',
    });
  });

  it('chains a legacy successor behind an interrupted in-flight send', async () => {
    const db = getLocalDb();
    await db.outbox.bulkPut([
      opRow({
        clientOpId: 'legacy-flight',
        attemptedValue: 11,
        status: 'in_flight',
        enqueuedAt: '2026-01-01T00:00:00.000Z',
      }),
      opRow({
        clientOpId: 'legacy-after-flight',
        attemptedValue: 12,
        prevValue: 11,
        enqueuedAt: '2026-01-01T00:00:01.000Z',
      }),
    ]);

    await recoverStaleInFlight();
    expect((await claimDrainableOps(50)).map((row) => row.clientOpId)).toEqual(['legacy-flight']);
    expect(await db.outbox.get('legacy-after-flight')).toMatchObject({
      predecessorClientOpId: 'legacy-flight',
    });
  });

  it('repairs malformed fallback operation and batch ids before retrying them', async () => {
    const db = getLocalDb();
    const firstBrokenId = '9543da4e-2312-41-8-9543da4e2312';
    const secondBrokenId = 'abcdef12-3456-47-8-abcdef123456';
    const brokenBatchId = 'deadbeef-cafe-4a-8-deadbeefcafe';
    const future = new Date(Date.now() + 60_000).toISOString();
    await db.outbox.bulkPut([
      opRow({
        clientOpId: firstBrokenId,
        batchId: brokenBatchId,
        status: 'transient_retry',
        attemptCount: 6,
        nextEarliestAttemptAt: future,
        serverReason: 'validation_error',
        lastError: { message: 'Invalid uuid' },
      }),
      opRow({
        clientOpId: secondBrokenId,
        batchId: brokenBatchId,
        coalesceKey: `${CHAR_ID}|dx`,
        fieldPath: 'dx',
        attemptedValue: 12,
        status: 'transient_retry',
        attemptCount: 6,
        nextEarliestAttemptAt: future,
        serverReason: 'validation_error',
      }),
    ]);

    const claimed = await claimDrainableOps(50);

    expect(claimed).toHaveLength(2);
    expect(claimed.every((op) => uuid.safeParse(op.clientOpId).success)).toBe(true);
    expect(claimed.every((op) => uuid.safeParse(op.batchId).success)).toBe(true);
    expect(new Set(claimed.map((op) => op.batchId)).size).toBe(1);
    expect(claimed.map((op) => op.clientOpId)).not.toContain(firstBrokenId);
    expect(claimed.map((op) => op.clientOpId)).not.toContain(secondBrokenId);
    expect(claimed.every((op) => op.attemptCount === 0)).toBe(true);
    expect(await db.outbox.get(firstBrokenId)).toBeUndefined();
    expect(await db.outbox.get(secondBrokenId)).toBeUndefined();
    const repaired = await db.outbox.toArray();
    expect(repaired.every((op) => op.status === 'in_flight')).toBe(true);
    expect(repaired.every((op) => op.attemptCount === 1)).toBe(true);
    expect(repaired.every((op) => op.serverReason === undefined)).toBe(true);
    expect(repaired.every((op) => op.nextEarliestAttemptAt === undefined)).toBe(true);
  });

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
  it('re-promotes orphaned in_flight rows as delivery-uncertain retries', async () => {
    const db = getLocalDb();
    await db.outbox.put(opRow({ clientOpId: 'op-stale', status: 'in_flight', attemptCount: 2 }));
    const recovered = await recoverStaleInFlight();
    expect(recovered).toBe(1);
    const row = await db.outbox.get('op-stale');
    expect(row?.status).toBe('transient_retry');
    expect(row?.deliveryUncertain).toBe(true);
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
