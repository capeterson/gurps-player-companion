import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_STORE_NAMES, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import { syncStateStore } from './state.ts';

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

async function seedEveryStore() {
  const db = getLocalDb();
  await db.characters.put({ id: 'char-1', ownerId: 'user-1', name: 'Old', revision: 9 } as never);
  await db.characterTraits.put({ id: 'trait-1', characterId: 'char-1', revision: 9 } as never);
  await db.characterSkills.put({ id: 'skill-1', characterId: 'char-1', revision: 9 } as never);
  await db.characterSpells.put({ id: 'spell-1', characterId: 'char-1', revision: 9 } as never);
  await db.characterInventory.put({ id: 'item-1', characterId: 'char-1', revision: 9 } as never);
  await db.characterCombat.put({ id: 'combat-1', characterId: 'char-1', revision: 9 } as never);
  await db.campaigns.put({
    id: 'campaign-1',
    ownerId: 'user-1',
    name: 'Old',
    revision: 9,
  } as never);
  await db.outbox.put({
    clientOpId: 'op-1',
    entityClass: 'character',
    entityId: 'char-1',
    command: 'patch',
    coalesceKey: 'char-1|name',
    fieldPath: 'name',
    attemptedValue: 'Unsynced',
    validationVersion: 1,
    status: 'pending',
    enqueuedAt: new Date().toISOString(),
    attemptCount: 0,
  });
  await db.syncCursors.put({ entityClass: 'character', revision: 9 });
  await db.syncMeta.put({ key: 'bootstrap:user-1', value: { bootstrappedAt: 'old' } });
  await db.tombstones.put({
    entityClass: 'character',
    entityId: 'deleted-char',
    revision: 9,
    deletedAt: new Date().toISOString(),
  });
  await db.rejectionToasts.put({
    id: 'rej-1',
    clientOpId: 'op-1',
    entityClass: 'character',
    entityId: 'char-1',
    reason: 'old rejection',
    status: 'rejected',
    createdAt: new Date().toISOString(),
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  syncStateStore.reset('synced');
  await resetLocalDb();
});

describe('SyncOrchestrator.clearLocalAndFullResync', () => {
  it('clears local stores, resets cursors/outbox/rejections, and bootstraps from revision 0', async () => {
    await seedEveryStore();
    tokenStore.write({
      accessToken: jwtForUser('user-1'),
      refreshToken: 'refresh',
      accessTokenExpiresIn: 0,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          changes: [
            {
              entityClass: 'character',
              entityId: 'char-fresh',
              command: 'upsert',
              revision: 1,
              data: { id: 'char-fresh', ownerId: 'user-1', name: 'Fresh', revision: 1 },
            },
          ],
          nextCursor: { character: 1 },
          hasMore: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getSyncOrchestrator().clearLocalAndFullResync('user-1');

    const db = getLocalDb();
    const counts = Object.fromEntries(
      await Promise.all(ALL_STORE_NAMES.map(async (name) => [name, await db[name].count()])),
    );
    expect(counts.characters).toBe(1);
    expect(counts.characterTraits).toBe(0);
    expect(counts.characterSkills).toBe(0);
    expect(counts.characterSpells).toBe(0);
    expect(counts.characterInventory).toBe(0);
    expect(counts.characterCombat).toBe(0);
    expect(counts.campaigns).toBe(0);
    expect(counts.outbox).toBe(0);
    expect(counts.syncCursors).toBe(1);
    expect(counts.syncMeta).toBe(1);
    expect(counts.tombstones).toBe(0);
    expect(counts.rejectionToasts).toBe(0);
    expect(counts.syncLog).toBe(1);
    expect(await db.characters.get('char-fresh')).toMatchObject({ name: 'Fresh', revision: 1 });
    expect(await db.syncMeta.get('bootstrap:user-1')).toBeTruthy();
    expect(await db.syncCursors.get('character')).toMatchObject({ revision: 1 });
    const pullLog = await db.syncLog.toArray();
    expect(pullLog).toEqual([
      expect.objectContaining({ direction: 'pull', result: 'synced', entityId: 'char-fresh' }),
    ]);
    expect(pullLog[0]).not.toHaveProperty('value');

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.cursors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityClass: 'character', sinceRevision: 0 }),
        expect.objectContaining({ entityClass: 'character_trait', sinceRevision: 0 }),
        expect.objectContaining({ entityClass: 'character_skill', sinceRevision: 0 }),
        expect.objectContaining({ entityClass: 'character_spell', sinceRevision: 0 }),
        expect.objectContaining({ entityClass: 'character_inventory', sinceRevision: 0 }),
        expect.objectContaining({ entityClass: 'character_combat', sinceRevision: 0 }),
      ]),
    );
  });
});

describe('SyncOrchestrator.revertFailedOperation', () => {
  it('restores a failed patch and records the explicit local revert', async () => {
    const db = getLocalDb();
    await db.characters.put({
      id: 'char-1',
      ownerId: 'user-1',
      name: 'Local',
      revision: 1,
    } as never);
    await db.outbox.put({
      clientOpId: 'op-revert',
      entityClass: 'character',
      entityId: 'char-1',
      command: 'patch',
      coalesceKey: 'char-1|name',
      fieldPath: 'name',
      attemptedValue: 'Local',
      prevValue: 'Server',
      validationVersion: 1,
      status: 'transient_retry',
      enqueuedAt: new Date().toISOString(),
      attemptCount: 4,
      lastError: { status: 503 },
    });

    await getSyncOrchestrator().revertFailedOperation('op-revert');

    expect(await db.characters.get('char-1')).toMatchObject({ name: 'Server' });
    expect(await db.outbox.get('op-revert')).toBeUndefined();
    expect(await db.syncLog.toArray()).toEqual([
      expect.objectContaining({ direction: 'local', result: 'reverted', entityId: 'char-1' }),
    ]);
  });

  it('removes a speculative create when it is reverted', async () => {
    const db = getLocalDb();
    await db.characters.put({
      id: 'char-new',
      ownerId: 'user-1',
      name: 'Local',
      revision: -1,
    } as never);
    await db.characterTraits.put({
      id: 'trait-new',
      characterId: 'char-new',
      kind: 'advantage',
      name: 'Local trait',
      points: 1,
      revision: -1,
    } as never);
    await db.outbox.put({
      clientOpId: 'create-revert',
      entityClass: 'character',
      entityId: 'char-new',
      command: 'create',
      coalesceKey: 'char-new|',
      attemptedValue: {},
      validationVersion: 1,
      status: 'transient_retry',
      enqueuedAt: new Date().toISOString(),
      attemptCount: 4,
    });
    await db.outbox.put({
      clientOpId: 'trait-create',
      entityClass: 'character_trait',
      entityId: 'trait-new',
      command: 'create',
      coalesceKey: 'trait-new|',
      attemptedValue: { name: 'Local trait' },
      parentId: 'char-new',
      validationVersion: 1,
      status: 'pending',
      enqueuedAt: new Date(Date.now() + 1).toISOString(),
      attemptCount: 0,
    });

    await getSyncOrchestrator().revertFailedOperation('create-revert');

    expect(await db.characters.get('char-new')).toBeUndefined();
    expect(await db.characterTraits.get('trait-new')).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps a newer same-field edit and repairs its rollback anchor', async () => {
    const db = getLocalDb();
    await db.characters.put({
      id: 'char-1',
      ownerId: 'user-1',
      name: 'Newest local',
      revision: 1,
    } as never);
    await db.outbox.bulkPut([
      {
        clientOpId: 'old-failure',
        entityClass: 'character',
        entityId: 'char-1',
        command: 'patch',
        coalesceKey: 'char-1|name',
        fieldPath: 'name',
        attemptedValue: 'Older local',
        prevValue: 'Server',
        baseRevision: 1,
        validationVersion: 1,
        status: 'transient_retry',
        enqueuedAt: '2026-01-01T00:00:00.000Z',
        attemptCount: 4,
      },
      {
        clientOpId: 'newer-edit',
        entityClass: 'character',
        entityId: 'char-1',
        command: 'patch',
        coalesceKey: 'char-1|name',
        fieldPath: 'name',
        attemptedValue: 'Newest local',
        prevValue: 'Older local',
        baseRevision: 1,
        validationVersion: 1,
        status: 'pending',
        enqueuedAt: '2026-01-01T00:00:01.000Z',
        attemptCount: 0,
      },
    ]);

    const result = await getSyncOrchestrator().revertFailedOperation('old-failure');

    expect(result.preservedNewerEdit).toBe(true);
    expect(await db.characters.get('char-1')).toMatchObject({ name: 'Newest local' });
    expect(await db.outbox.get('old-failure')).toBeUndefined();
    expect(await db.outbox.get('newer-edit')).toMatchObject({
      attemptedValue: 'Newest local',
      prevValue: 'Server',
    });
  });

  it('reinserts an optimistically deleted row when it is reverted', async () => {
    const db = getLocalDb();
    const previous = { id: 'char-old', ownerId: 'user-1', name: 'Restored', revision: 2 };
    await db.outbox.put({
      clientOpId: 'delete-revert',
      entityClass: 'character',
      entityId: 'char-old',
      command: 'delete',
      coalesceKey: 'char-old|',
      attemptedValue: null,
      prevValue: previous,
      validationVersion: 1,
      status: 'transient_retry',
      enqueuedAt: new Date().toISOString(),
      attemptCount: 4,
    });

    await getSyncOrchestrator().revertFailedOperation('delete-revert');

    expect(await db.characters.get('char-old')).toMatchObject({ name: 'Restored', revision: 2 });
  });
});
