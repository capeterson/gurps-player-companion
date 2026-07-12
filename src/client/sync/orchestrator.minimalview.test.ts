/**
 * Regression tests for the local share-gate sweep
 * (`enforceMinimalViewLocally` in orchestrator.ts).
 *
 * Background (see docs/specs/campaign-content-sharing.md):
 *   The server's `projectCharacterRow` ships only identity fields for a
 *   minimal-view character on the sync cursor. But the cursor only
 *   re-emits a row when the character's own revision advances — flipping
 *   `shareCharacterSheets=false` bumps the *campaign* row, not every
 *   member character row, so the cursor does NOT automatically repull
 *   every masked character with the new projection.
 *
 *   The local sweep is the client half of the gate: after every cursor
 *   pull it rewrites every minimal character's row down to identity-only
 *   fields AND drops its child rows (traits / skills / spells / inventory
 *   / combat). Without the row rewrite, stale `st=15 / hpMod=2 /
 *   tempEffects=[real buffs]` cached while the viewer had full access
 *   stay readable in IndexedDB — and `useCharacterDetail` /
 *   `buildCharacterDetail` would keep deriving real HP/FP/derived from
 *   them, which is the leak this sweep exists to close.
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

function cursorResponse(
  changes: unknown[],
  accessible?: { characterIds: string[]; campaignIds: string[] },
): Response {
  const body: Record<string, unknown> = { changes, nextCursor: {}, hasMore: {} };
  if (accessible) body.accessible = accessible;
  return new Response(JSON.stringify(body), {
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

const VIEWER_ID = 'user-viewer';
const OWNER_ID = 'user-owner';
const CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-00000000dc01';
const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000d001';

/**
 * A character row as it would be synced BEFORE the share flip — with
 * real stats, mods, temp effects, and dismissed warnings.
 */
function realCharacterRow() {
  return {
    id: CHAR_ID,
    ownerId: OWNER_ID,
    campaignId: CAMPAIGN_ID,
    name: 'Secretly Buffed',
    playerName: 'Alice',
    height: null,
    weight: null,
    age: null,
    appearance: null,
    techLevel: null,
    st: 17,
    dx: 14,
    iq: 13,
    ht: 12,
    hpMod: 3,
    willMod: 1,
    perMod: 2,
    fpMod: 1,
    speedQuarterMod: 0,
    moveMod: 0,
    tempEffects: [{ id: 'e1', name: 'Might', mods: { st: 4 } }],
    dismissedWarnings: ['over-buffed'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 5,
  };
}

function shareOffCampaignRow() {
  return {
    id: CAMPAIGN_ID,
    name: 'Hidden Campaign',
    ownerId: OWNER_ID,
    shareCharacterSheets: false,
    revision: 10,
  };
}

describe('enforceMinimalViewLocally — character row rewrite', () => {
  it('blanks private fields on a minimal character row after a cursor pull, while preserving identity fields', async () => {
    const db = getLocalDb();
    await db.characters.put(realCharacterRow() as never);
    await db.campaigns.put(shareOffCampaignRow() as never);
    // Real child rows cached before the share flip — the sweep must
    // drop these too so derived state can't be reconstructed locally.
    await db.characterTraits.put({ id: 't-1', characterId: CHAR_ID, revision: 1 } as never);
    await db.characterCombat.put({
      id: 'cs-1',
      characterId: CHAR_ID,
      currentHp: 3,
      currentFp: 7,
      revision: 1,
    } as never);

    loginAs(VIEWER_ID);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          cursorResponse([], { characterIds: [CHAR_ID], campaignIds: [CAMPAIGN_ID] }),
        ),
    );

    // `bootstrap(userId)` is what captures `currentUserId` on the
    // orchestrator — without it `enforceMinimalViewLocally` early-
    // returns. `triggerCursorPull` alone doesn't set it.
    await getSyncOrchestrator().bootstrap(VIEWER_ID);

    const row = await db.characters.get(CHAR_ID);
    expect(row).toBeDefined();
    // Identity fields preserved.
    expect(row?.id).toBe(CHAR_ID);
    expect(row?.ownerId).toBe(OWNER_ID);
    expect(row?.campaignId).toBe(CAMPAIGN_ID);
    expect(row?.name).toBe('Secretly Buffed');
    expect(row?.playerName).toBe('Alice');
    // Private fields blanked to safe schema defaults — NOT the real
    // values cached before the share flip.
    expect(row?.st).toBe(10);
    expect(row?.dx).toBe(10);
    expect(row?.iq).toBe(10);
    expect(row?.ht).toBe(10);
    expect(row?.hpMod).toBe(0);
    expect(row?.willMod).toBe(0);
    expect(row?.perMod).toBe(0);
    expect(row?.fpMod).toBe(0);
    expect(row?.speedQuarterMod).toBe(0);
    expect(row?.moveMod).toBe(0);
    expect(row?.tempEffects).toEqual([]);
    expect(row?.dismissedWarnings).toEqual([]);
    // Child rows also dropped.
    expect(await db.characterTraits.where('characterId').equals(CHAR_ID).count()).toBe(0);
    expect(await db.characterCombat.get(CHAR_ID)).toBeUndefined();
  });

  it('leaves the row untouched when the viewer is the character owner', async () => {
    const db = getLocalDb();
    await db.characters.put(realCharacterRow() as never);
    await db.campaigns.put(shareOffCampaignRow() as never);
    await db.characterTraits.put({ id: 't-1', characterId: CHAR_ID, revision: 1 } as never);

    loginAs(OWNER_ID);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          cursorResponse([], { characterIds: [CHAR_ID], campaignIds: [CAMPAIGN_ID] }),
        ),
    );

    await getSyncOrchestrator().bootstrap(OWNER_ID);

    const row = await db.characters.get(CHAR_ID);
    // Owner's real stats and effects are preserved — the share gate
    // short-circuits for the owner.
    expect(row?.st).toBe(17);
    expect(row?.tempEffects).toEqual([{ id: 'e1', name: 'Might', mods: { st: 4 } }]);
    expect(await db.characterTraits.where('characterId').equals(CHAR_ID).count()).toBe(1);
  });

  it('leaves the row untouched when the campaign has shareCharacterSheets=true', async () => {
    const db = getLocalDb();
    await db.characters.put(realCharacterRow() as never);
    await db.campaigns.put({ ...shareOffCampaignRow(), shareCharacterSheets: true } as never);
    await db.characterTraits.put({ id: 't-1', characterId: CHAR_ID, revision: 1 } as never);

    loginAs(VIEWER_ID);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          cursorResponse([], { characterIds: [CHAR_ID], campaignIds: [CAMPAIGN_ID] }),
        ),
    );

    await getSyncOrchestrator().bootstrap(VIEWER_ID);

    const row = await db.characters.get(CHAR_ID);
    // Sharing is on, so the viewer is a full member — real values and
    // child rows stay.
    expect(row?.st).toBe(17);
    expect(row?.tempEffects).toEqual([{ id: 'e1', name: 'Might', mods: { st: 4 } }]);
    expect(await db.characterTraits.where('characterId').equals(CHAR_ID).count()).toBe(1);
  });

  it('rehydrates a previously masked row when access returns to full', async () => {
    const db = getLocalDb();
    await db.characters.put({
      ...realCharacterRow(),
      st: 10,
      tempEffects: [],
      minimalViewMasked: true,
    } as never);
    await db.campaigns.put({ ...shareOffCampaignRow(), shareCharacterSheets: true } as never);
    await db.syncCursors.bulkPut([
      { entityClass: 'character', revision: 99 },
      { entityClass: 'character_trait', revision: 99 },
    ]);

    loginAs(VIEWER_ID);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        cursorResponse([], { characterIds: [CHAR_ID], campaignIds: [CAMPAIGN_ID] }),
      )
      .mockResolvedValueOnce(
        cursorResponse(
          [
            {
              entityClass: 'character',
              entityId: CHAR_ID,
              command: 'upsert',
              revision: 5,
              data: realCharacterRow(),
            },
            {
              entityClass: 'character_trait',
              entityId: 't-1',
              command: 'upsert',
              revision: 1,
              data: { id: 't-1', characterId: CHAR_ID, name: 'Recovered', revision: 1 },
            },
          ],
          { characterIds: [CHAR_ID], campaignIds: [CAMPAIGN_ID] },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await getSyncOrchestrator().bootstrap(VIEWER_ID);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      cursors: Array<{ entityClass: string; sinceRevision: number }>;
    };
    expect(
      secondRequest.cursors
        .filter(({ entityClass }) => entityClass.startsWith('character'))
        .every(({ sinceRevision }) => sinceRevision === 0),
    ).toBe(true);
    expect(await db.characters.get(CHAR_ID)).toMatchObject({
      st: 17,
      tempEffects: [{ id: 'e1', name: 'Might', mods: { st: 4 } }],
      minimalViewMasked: false,
    });
    expect(await db.characterTraits.get('t-1')).toMatchObject({ name: 'Recovered' });
  });
});
