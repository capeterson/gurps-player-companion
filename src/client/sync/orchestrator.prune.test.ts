/**
 * Regression tests for the accessible-set prune (issue: stale local
 * data after access revocation).
 *
 * The server never emits a tombstone to an ex-member -- tombstone
 * queries are scoped to campaigns the viewer *currently* belongs to,
 * so after removal the campaign (and its characters) drop out of the
 * tombstone scope too.  The only signal left is the authoritative
 * `accessible.{characterIds,campaignIds}` set the cursor response now
 * carries on every page; the client prunes local rows that fell out of
 * it.  See `pruneInaccessibleLocally` in orchestrator.ts.
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

const OWNED_CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000d001';
const STALE_CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000d002';
const STALE_CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-00000000dc01';
const SPECULATIVE_CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000d003';

describe('accessible-set prune', () => {
  it('prunes a stale foreign character + all child rows + a stale campaign', async () => {
    const db = getLocalDb();
    await db.characters.bulkPut([
      { id: OWNED_CHAR_ID, ownerId: 'user-1', name: 'Mine', revision: 1 } as never,
      {
        id: STALE_CHAR_ID,
        ownerId: 'user-2',
        campaignId: STALE_CAMPAIGN_ID,
        name: 'No longer visible',
        revision: 1,
      } as never,
    ]);
    await db.campaigns.put({
      id: STALE_CAMPAIGN_ID,
      ownerId: 'user-2',
      name: 'Campaign I got removed from',
      revision: 1,
    } as never);
    await db.characterTraits.put({ id: 't-1', characterId: STALE_CHAR_ID, revision: 1 } as never);
    await db.characterSkills.put({ id: 's-1', characterId: STALE_CHAR_ID, revision: 1 } as never);
    await db.characterSpells.put({ id: 'sp-1', characterId: STALE_CHAR_ID, revision: 1 } as never);
    await db.characterInventory.put({
      id: 'i-1',
      characterId: STALE_CHAR_ID,
      revision: 1,
    } as never);
    await db.characterCombat.put({
      id: 'cs-1',
      characterId: STALE_CHAR_ID,
      currentHp: 10,
      revision: 1,
    } as never);

    loginAs('user-1');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(cursorResponse([], { characterIds: [OWNED_CHAR_ID], campaignIds: [] })),
    );

    await getSyncOrchestrator().triggerCursorPull();

    expect(await db.characters.get(STALE_CHAR_ID)).toBeUndefined();
    expect(await db.campaigns.get(STALE_CAMPAIGN_ID)).toBeUndefined();
    expect(await db.characterTraits.where('characterId').equals(STALE_CHAR_ID).count()).toBe(0);
    expect(await db.characterSkills.where('characterId').equals(STALE_CHAR_ID).count()).toBe(0);
    expect(await db.characterSpells.where('characterId').equals(STALE_CHAR_ID).count()).toBe(0);
    expect(await db.characterInventory.where('characterId').equals(STALE_CHAR_ID).count()).toBe(0);
    expect(await db.characterCombat.get(STALE_CHAR_ID)).toBeUndefined();
    // Still-accessible character is untouched.
    expect(await db.characters.get(OWNED_CHAR_ID)).toBeTruthy();
  });

  it('never prunes a speculative character (revision -1) with a pending outbox create', async () => {
    const db = getLocalDb();
    await db.characters.put({
      id: SPECULATIVE_CHAR_ID,
      ownerId: 'user-1',
      name: 'Not yet acked',
      revision: -1,
    } as never);
    await db.outbox.put({
      clientOpId: 'op-create-1',
      entityClass: 'character',
      entityId: SPECULATIVE_CHAR_ID,
      command: 'create',
      coalesceKey: `${SPECULATIVE_CHAR_ID}|:create`,
      attemptedValue: { name: 'Not yet acked' },
      validationVersion: 1,
      status: 'pending',
      enqueuedAt: new Date().toISOString(),
      attemptCount: 0,
    });

    loginAs('user-1');
    // The server doesn't know about this character yet, so it is
    // (correctly) absent from the accessible set.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(cursorResponse([], { characterIds: [], campaignIds: [] })),
    );

    await getSyncOrchestrator().triggerCursorPull();

    expect(await db.characters.get(SPECULATIVE_CHAR_ID)).toBeTruthy();
  });

  it('prunes nothing when the response omits `accessible` (old server)', async () => {
    const db = getLocalDb();
    await db.characters.put({
      id: STALE_CHAR_ID,
      ownerId: 'user-2',
      campaignId: STALE_CAMPAIGN_ID,
      name: 'Should survive because the server is old',
      revision: 1,
    } as never);
    await db.campaigns.put({
      id: STALE_CAMPAIGN_ID,
      ownerId: 'user-2',
      name: 'Campaign',
      revision: 1,
    } as never);

    loginAs('user-1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cursorResponse([])));

    await getSyncOrchestrator().triggerCursorPull();

    expect(await db.characters.get(STALE_CHAR_ID)).toBeTruthy();
    expect(await db.campaigns.get(STALE_CAMPAIGN_ID)).toBeTruthy();
  });
});
