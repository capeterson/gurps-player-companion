/**
 * Regression tests for sync self-healing behaviour:
 *
 *   1. Rule S4 — a /sync/cursor pull must never overwrite a field that
 *      has a pending outbox op (this shipped broken once: the outbox
 *      had no `entityId` index, Dexie threw SchemaError, and a
 *      swallowing catch turned the skip into a no-op).
 *   2. The minimal-view sweep must actually delete private child rows
 *      (including combat, whose primary key is `characterId`) without
 *      wedging the pull in an error state.
 *   3. Bootstrap must not write the per-user "bootstrapped" flag when
 *      the pull was skipped (e.g. offline) — otherwise the gate
 *      renders an empty UI that claims to be synced.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import { syncStateStore } from './state.ts';

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

function loginAs(userId: string): void {
  tokenStore.write({
    accessToken: jwtForUser(userId),
    refreshToken: 'refresh',
    accessTokenExpiresIn: 0,
  });
}

function cursorResponse(changes: unknown[]): Response {
  return new Response(JSON.stringify({ changes, nextCursor: {}, hasMore: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  syncStateStore.reset('synced');
  await resetLocalDb();
});

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000c001';

describe('applyServerRow local-intent preservation (rule S4)', () => {
  it('keeps a locally-edited field with a pending outbox op, applies the rest', async () => {
    const db = getLocalDb();
    await db.characters.put({
      id: CHAR_ID,
      ownerId: 'user-1',
      name: 'Local Edit',
      st: 10,
      revision: 1,
    } as never);
    await db.outbox.put({
      clientOpId: 'op-1',
      entityClass: 'character',
      entityId: CHAR_ID,
      command: 'patch',
      coalesceKey: `${CHAR_ID}|name`,
      fieldPath: 'name',
      attemptedValue: 'Local Edit',
      prevValue: 'Old',
      validationVersion: 1,
      status: 'pending',
      enqueuedAt: new Date().toISOString(),
      attemptCount: 0,
    });
    loginAs('user-1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        cursorResponse([
          {
            entityClass: 'character',
            entityId: CHAR_ID,
            command: 'patch',
            revision: 2,
            data: { id: CHAR_ID, ownerId: 'user-1', name: 'Server Name', st: 14, revision: 2 },
          },
        ]),
      ),
    );

    await getSyncOrchestrator().triggerCursorPull();

    const row = await db.characters.get(CHAR_ID);
    // The pending local edit wins until the server formally rejects it…
    expect(row?.name).toBe('Local Edit');
    // …while fields without local intent take the server value.
    expect(row?.st).toBe(14);
    expect(row?.revision).toBe(2);
  });
});

describe('minimal-view sweep', () => {
  it('purges private child rows (incl. combat) for share=false campaigns without erroring', async () => {
    const db = getLocalDb();
    const foreignChar = '0193b3c0-f1f0-7000-8000-00000000c002';
    const campaignId = '0193b3c0-f1f0-7000-8000-00000000ca01';
    await db.characters.put({
      id: foreignChar,
      ownerId: 'user-2',
      campaignId,
      name: 'Someone else',
      revision: 1,
    } as never);
    await db.campaigns.put({
      id: campaignId,
      ownerId: 'user-2',
      name: 'Secret campaign',
      shareCharacterSheets: false,
      revision: 1,
    } as never);
    await db.characterTraits.put({ id: 't-1', characterId: foreignChar, revision: 1 } as never);
    await db.characterSkills.put({ id: 's-1', characterId: foreignChar, revision: 1 } as never);
    await db.characterSpells.put({ id: 'sp-1', characterId: foreignChar, revision: 1 } as never);
    await db.characterInventory.put({ id: 'i-1', characterId: foreignChar, revision: 1 } as never);
    // Combat's pk IS the characterId.
    await db.characterCombat.put({
      id: 'cs-1',
      characterId: foreignChar,
      currentHp: 12,
      revision: 1,
    } as never);
    loginAs('user-1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cursorResponse([])));

    // bootstrap captures the viewer id, then pulls (running the sweep).
    await getSyncOrchestrator().bootstrap('user-1');

    expect(await db.characterTraits.count()).toBe(0);
    expect(await db.characterSkills.count()).toBe(0);
    expect(await db.characterSpells.count()).toBe(0);
    expect(await db.characterInventory.count()).toBe(0);
    expect(await db.characterCombat.count()).toBe(0);
    // The character row itself stays (minimal view still lists it).
    expect(await db.characters.get(foreignChar)).toBeTruthy();
    // Bootstrap completed → flag written.
    expect(await db.syncMeta.get('bootstrap:user-1')).toBeTruthy();
  });

  it('requests the campaign class from /sync/cursor so the sweep has campaign rows', async () => {
    loginAs('user-1');
    const fetchMock = vi.fn().mockResolvedValue(cursorResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await getSyncOrchestrator().triggerCursorPull();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.cursors).toEqual(
      expect.arrayContaining([expect.objectContaining({ entityClass: 'campaign' })]),
    );
  });
});

describe('bootstrap flag honesty', () => {
  it('does not mark the user bootstrapped when the pull is skipped offline', async () => {
    loginAs('user-1');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      await getSyncOrchestrator().bootstrap('user-1');
      expect(await getLocalDb().syncMeta.get('bootstrap:user-1')).toBeUndefined();
    } finally {
      // Remove the own property so the environment's getter is back.
      Reflect.deleteProperty(navigator, 'onLine');
    }
  });
});
