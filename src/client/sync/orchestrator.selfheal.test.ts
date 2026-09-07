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

  it('keeps a pending fluency edit on a language against a stale server row', async () => {
    const db = getLocalDb();
    const langId = '0193b3c0-f1f0-7000-8000-00000000d001';
    await db.characters.put({
      id: CHAR_ID,
      ownerId: 'user-1',
      name: 'Local',
      revision: 1,
    } as never);
    await db.characterLanguages.put({
      id: langId,
      characterId: CHAR_ID,
      name: 'Cathrian',
      // The pending edit already optimized the local row to its intent.
      spokenFluency: 'accented',
      writtenFluency: 'none',
      points: 0,
      notes: null,
      libraryLanguageId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 3,
    } as never);
    await db.outbox.put({
      clientOpId: 'lang-op',
      entityClass: 'character_language',
      entityId: langId,
      command: 'patch',
      coalesceKey: `${langId}|spokenFluency`,
      fieldPath: 'spokenFluency',
      attemptedValue: 'accented',
      prevValue: 'native',
      baseRevision: 3,
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
            entityClass: 'character_language',
            entityId: langId,
            command: 'patch',
            revision: 4,
            // The server's newer row still says the OLD fluency (another
            // device, no knowledge of this client's pending edit).
            data: {
              id: langId,
              characterId: CHAR_ID,
              name: 'Cathrian',
              spokenFluency: 'native',
              writtenFluency: 'broken',
              points: 1,
              notes: null,
              libraryLanguageId: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:01.000Z',
              revision: 4,
            },
          },
        ]),
      ),
    );

    await getSyncOrchestrator().triggerCursorPull();

    const row = await db.characterLanguages.get(langId);
    // S4: the pending spoken-fluency edit is preserved…
    expect(row?.spokenFluency).toBe('accented');
    // …while other fields (and the revision) take the server values.
    expect(row?.writtenFluency).toBe('broken');
    expect(row?.points).toBe(1);
    expect(row?.revision).toBe(4);
  });

  it('keeps a pending default-modifier edit on a technique against a stale server row', async () => {
    const db = getLocalDb();
    const techId = '0193b3c0-f1f0-7000-8000-00000000d002';
    await db.characters.put({
      id: CHAR_ID,
      ownerId: 'user-1',
      name: 'Local',
      revision: 1,
    } as never);
    await db.characterTechniques.put({
      id: techId,
      characterId: CHAR_ID,
      name: 'Combat Riding',
      defaultSkillName: 'Riding (Equines)',
      difficulty: 'H',
      points: 0,
      // The pending edit already optimized the local row to its intent.
      defaultModifier: -7,
      maxLevel: null,
      notes: null,
      libraryTechniqueId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 7,
    } as never);
    await db.outbox.put({
      clientOpId: 'tech-op',
      entityClass: 'character_technique',
      entityId: techId,
      command: 'patch',
      coalesceKey: `${techId}|defaultModifier`,
      fieldPath: 'defaultModifier',
      attemptedValue: -7,
      prevValue: 0,
      baseRevision: 7,
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
            entityClass: 'character_technique',
            entityId: techId,
            command: 'patch',
            revision: 8,
            data: {
              id: techId,
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
              updatedAt: '2026-01-01T00:00:01.000Z',
              revision: 8,
            },
          },
        ]),
      ),
    );

    await getSyncOrchestrator().triggerCursorPull();

    const row = await db.characterTechniques.get(techId);
    expect(row?.defaultModifier).toBe(-7);
    expect(row?.name).toBe('Combat Riding');
    expect(row?.revision).toBe(8);
  });
});

describe('queued whole-entity deletes', () => {
  it.each(['pending', 'in_flight', 'transient_retry'] as const)(
    'does not resurrect a locally deleted row during a cursor pull while its %s delete is queued',
    async (status) => {
      const db = getLocalDb();
      await db.outbox.put({
        clientOpId: `delete-${status}`,
        entityClass: 'character',
        entityId: CHAR_ID,
        command: 'delete',
        coalesceKey: `${CHAR_ID}|`,
        attemptedValue: null,
        prevValue: { id: CHAR_ID, ownerId: 'user-1', name: 'Locally deleted', revision: 1 },
        validationVersion: 1,
        status,
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
              data: { id: CHAR_ID, ownerId: 'user-1', name: 'Server copy', revision: 2 },
            },
          ]),
        ),
      );

      await getSyncOrchestrator().triggerCursorPull();

      expect(await db.characters.get(CHAR_ID)).toBeUndefined();
    },
  );

  it('does not resurrect a locally deleted row while bootstrap rehydrates from a zero cursor', async () => {
    const db = getLocalDb();
    await db.outbox.put({
      clientOpId: 'delete-during-bootstrap',
      entityClass: 'character',
      entityId: CHAR_ID,
      command: 'delete',
      coalesceKey: `${CHAR_ID}|`,
      attemptedValue: null,
      prevValue: { id: CHAR_ID, ownerId: 'user-1', name: 'Locally deleted', revision: 1 },
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
            data: { id: CHAR_ID, ownerId: 'user-1', name: 'Server copy', revision: 2 },
          },
        ]),
      ),
    );

    await getSyncOrchestrator().bootstrap('user-1');

    expect(await db.characters.get(CHAR_ID)).toBeUndefined();
    expect(await db.syncMeta.get('bootstrap:user-1')).toBeTruthy();
  });

  it('allows an explicit conflict-bypass to reinsert a deleted row', async () => {
    const db = getLocalDb();
    await db.outbox.put({
      clientOpId: 'delete-conflict-bypass',
      entityClass: 'character',
      entityId: CHAR_ID,
      command: 'delete',
      coalesceKey: `${CHAR_ID}|`,
      attemptedValue: null,
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
            data: { id: CHAR_ID, ownerId: 'user-1', name: 'Server copy', revision: 2 },
          },
        ]),
      ),
    );

    // A stale-base/conflict reconciliation deliberately bypasses queued intent.
    await (
      getSyncOrchestrator() as unknown as {
        applyServerRow(
          entityClass: string,
          row: Record<string, unknown>,
          opts: { ignoreOutboxConflict: boolean },
        ): Promise<void>;
      }
    ).applyServerRow(
      'character',
      { id: CHAR_ID, ownerId: 'user-1', name: 'Conflict winner', revision: 3 },
      { ignoreOutboxConflict: true },
    );

    expect((await db.characters.get(CHAR_ID))?.name).toBe('Conflict winner');
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
