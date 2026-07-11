/**
 * useTempEffects — the temporary-effects state machine shared by
 * the Attributes/Secondary panels. Load-bearing semantics mirrored
 * from useConditionsToggle.test.ts and outbox.test.ts:
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

import { act, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDetail, TempEffect } from '../../../../shared/schemas/character.ts';
import { getLocalDb, resetLocalDb } from '../../../db/dexie.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { tokenStore } from '../../../lib/tokenStore.ts';
import { flashBus } from '../../../sync/flashBus.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from '../../../sync/orchestrator.ts';
import { useTempEffects } from './useTempEffects.ts';

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000d001';

// useTempEffects calls useToasts(), so every renderHook call needs a
// ToastProvider in the tree.
function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

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
  it('setManualAxis writes Dexie + enqueues one patch with the raw array', async () => {
    await seedCharacter([]);
    const { result } = renderHook(() => useTempEffects(makeCharacter([]), true), { wrapper });

    await act(async () => {
      await result.current.setManualAxis('st', 2);
    });

    const row = await getLocalDb().characters.get(CHAR_ID);
    expect(row?.tempEffects).toEqual([
      { id: 'manual', name: 'Manual adjustment', mods: { st: 2 } },
    ]);

    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.entityClass).toBe('character');
    expect(ops[0]?.fieldPath).toBe('tempEffects');
    expect(ops[0]?.attemptedValue).toEqual(row?.tempEffects);
  });

  it('two rapid setManualAxis calls compose — the second sees the first result, not the stale prop', async () => {
    await seedCharacter([]);
    const { result } = renderHook(() => useTempEffects(makeCharacter([]), true), { wrapper });

    // Both calls fire before either's Dexie transaction settles — without
    // the latest-intended ref, both would compose against the same
    // (empty) render-time array and the outbox's same-field coalescing
    // (S3) would drop the first.
    await act(async () => {
      const p1 = result.current.setManualAxis('st', 2);
      const p2 = result.current.setManualAxis('ht', 1);
      await Promise.all([p1, p2]);
    });

    const row = await getLocalDb().characters.get(CHAR_ID);
    expect(row?.tempEffects).toEqual([
      { id: 'manual', name: 'Manual adjustment', mods: { st: 2, ht: 1 } },
    ]);

    // Only one outbox row survives (coalesced), and it carries BOTH axes.
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.attemptedValue).toEqual(row?.tempEffects);
  });

  it('clearAll enqueues a single [] patch', async () => {
    const existing: TempEffect[] = [{ id: 'manual', name: 'Manual adjustment', mods: { st: 2 } }];
    await seedCharacter(existing);
    const { result } = renderHook(() => useTempEffects(makeCharacter(existing), true), { wrapper });

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
    const { result } = renderHook(() => useTempEffects(makeCharacter([]), false), { wrapper });

    await act(async () => {
      await result.current.setManualAxis('st', 2);
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

    const { result } = renderHook(() => useTempEffects(makeCharacter([]), true), { wrapper });

    getSyncOrchestrator().start();
    await act(async () => {
      await result.current.setManualAxis('st', 2);
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

  it('rejects an over-cap setManualAxis locally: no Dexie write, no outbox row, toast fired', async () => {
    // Validate in the shared commit path before ANY local write. A
    // legacy named effect at st:30 plus a manual st:30 would make the
    // combined st total 60 > 50, exercising the "combined X modifier"
    // message path in describeTempEffectsFailure.
    const existing: TempEffect[] = [{ id: 'e1', name: 'Potion', mods: { st: 30 } }];
    await seedCharacter(existing);
    const { result } = renderHook(() => useTempEffects(makeCharacter(existing), true), {
      wrapper,
    });

    const flashEvents: string[] = [];
    const unsubscribe = flashBus.subscribe(
      'character:0193b3c0-f1f0-7000-8000-00000000d001:tempEffects',
      (e) => {
        flashEvents.push(e.reason);
      },
    );

    await act(async () => {
      await result.current.setManualAxis('st', 30);
    });

    expect(await getLocalDb().characters.get(CHAR_ID)).toMatchObject({ tempEffects: existing });
    expect(await getLocalDb().outbox.count()).toBe(0);
    expect(
      screen.getByText(/Couldn't save temporary effects — exceed the ±50 cap for ST/),
    ).toBeInTheDocument();
    expect(flashEvents).toContain('exceed the ±50 cap for ST');

    unsubscribe();
  });
});
