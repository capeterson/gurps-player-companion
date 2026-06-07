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
    expect(await db.characters.get('char-fresh')).toMatchObject({ name: 'Fresh', revision: 1 });
    expect(await db.syncMeta.get('bootstrap:user-1')).toBeTruthy();
    expect(await db.syncCursors.get('character')).toMatchObject({ revision: 1 });

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
