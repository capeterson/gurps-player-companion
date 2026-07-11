/**
 * useTempEffects — the temporary-effects list state machine shared by
 * the Attributes/Secondary panels and the effects list. Load-bearing
 * semantics mirrored from useConditionsToggle.test.ts and outbox.test.ts:
 *
 *   1. A mutation writes the local Dexie row AND enqueues exactly one
 *      outbox patch carrying the raw new array (S2/S3).
 *   2. Two rapid mutations compose against the latest-intended ref, not
 *      the same render-time `character.tempEffects` snapshot — the
 *      second sees the first's just-enqueued result.
 *   3. A server rejection reverts Dexie to the pre-mutation array,
 *      persists a rejection toast, and fires the flashBus event keyed
 *      `character:<id>:tempEffects` (AGENTS.md S5).
 *   4. clearAll enqueues a single `[]` patch.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDetail, TempEffect } from '../../../../shared/schemas/character.ts';
import { getLocalDb, resetLocalDb } from '../../../db/dexie.ts';
import { tokenStore } from '../../../lib/tokenStore.ts';
import { flashBus } from '../../../sync/flashBus.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from '../../../sync/orchestrator.ts';
import { useTempEffects } from './useTempEffects.ts';

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000d001';

function makeCharacter(tempEffects: TempEffect[] = []): CharacterDetail {
  return { id: CHAR_ID, tempEffects } as unknown as CharacterDetail;
}

async function seedCharacter(tempEffects: TempEffect[] = []) {
  const db = getLocalDb();
  await db.characters.put({
    id: CHAR_ID,
    ownerId: 'owner-1',
    campaignId: null,
    name: 'Test',
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
    tempEffects,
    dismissedWarnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
  } as never);
}

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  await resetLocalDb();
});

describe('useTempEffects', () => {
  it('addEffect writes Dexie + enqueues one patch with the raw array', async () => {
    await seedCharacter([]);
    const { result } = renderHook(() => useTempEffects(makeCharacter([]), true));

    await act(async () => {
      await result.current.addEffect('Might', { st: 2 });
    });

    const row = await getLocalDb().characters.get(CHAR_ID);
    expect(row?.tempEffects).toEqual([{ id: expect.any(String), name: 'Might', mods: { st: 2 } }]);

    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.entityClass).toBe('character');
    expect(ops[0]?.fieldPath).toBe('tempEffects');
    expect(ops[0]?.attemptedValue).toEqual(row?.tempEffects);
  });

  it('two rapid mutations compose — the second sees the first result, not the stale prop', async () => {
    await seedCharacter([]);
    const { result } = renderHook(() => useTempEffects(makeCharacter([]), true));

    // Both calls fire before either's Dexie transaction settles — without
    // the latest-intended ref, both would compose against the same
    // (empty) render-time array and the outbox's same-field coalescing
    // (S3) would drop the first.
    await act(async () => {
      const p1 = result.current.addEffect('Might', { st: 2 });
      const p2 = result.current.setManualAxis('ht', 1);
      await Promise.all([p1, p2]);
    });

    const row = await getLocalDb().characters.get(CHAR_ID);
    expect(row?.tempEffects).toHaveLength(2);
    expect(row?.tempEffects?.some((e) => e.name === 'Might')).toBe(true);
    expect(row?.tempEffects?.some((e) => e.id === 'manual')).toBe(true);

    // Only one outbox row survives (coalesced), and it carries BOTH effects.
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.attemptedValue).toEqual(row?.tempEffects);
  });

  it('clearAll enqueues a single [] patch', async () => {
    const existing: TempEffect[] = [{ id: 'e1', name: 'Might', mods: { st: 2 } }];
    await seedCharacter(existing);
    const { result } = renderHook(() => useTempEffects(makeCharacter(existing), true));

    await act(async () => {
      await result.current.clearAll();
    });

    const row = await getLocalDb().characters.get(CHAR_ID);
    expect(row?.tempEffects).toEqual([]);
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.attemptedValue).toEqual([]);
  });

  it('ignores mutations when canWrite is false', async () => {
    await seedCharacter([]);
    const { result } = renderHook(() => useTempEffects(makeCharacter([]), false));

    await act(async () => {
      await result.current.addEffect('Might', { st: 2 });
    });

    expect(await getLocalDb().outbox.count()).toBe(0);
  });

  it('server rejection reverts Dexie, persists a rejection toast, and fires the flash event', async () => {
    await seedCharacter([]);
    tokenStore.write({
      accessToken: jwtForUser('owner-1'),
      refreshToken: 'refresh',
      accessTokenExpiresIn: 3600,
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string }>;
        };
        const outcomes = body.operations.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'rejected' as const,
          reason: 'temporary effects rejected in test',
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

    const flashEvents: string[] = [];
    const unsubscribe = flashBus.subscribe(
      'character:0193b3c0-f1f0-7000-8000-00000000d001:tempEffects',
      (e) => {
        flashEvents.push(e.reason);
      },
    );

    const { result } = renderHook(() => useTempEffects(makeCharacter([]), true));

    getSyncOrchestrator().start();
    await act(async () => {
      await result.current.addEffect('Might', { st: 2 });
    });

    // Wait for the orchestrator to drain the op, hear back "rejected",
    // and roll the local row back to its pre-mutation value ([]).
    await waitFor(async () => {
      const row = await getLocalDb().characters.get(CHAR_ID);
      expect(row?.tempEffects).toEqual([]);
    });

    await waitFor(async () => {
      const toasts = await getLocalDb().rejectionToasts.toArray();
      expect(toasts).toHaveLength(1);
      expect(toasts[0]?.entityClass).toBe('character');
      expect(toasts[0]?.fieldPath).toBe('tempEffects');
      expect(toasts[0]?.reason).toBe('temporary effects rejected in test');
    });

    await waitFor(() => {
      expect(flashEvents).toContain('temporary effects rejected in test');
    });

    getSyncOrchestrator().stop();
    unsubscribe();
  });
});
