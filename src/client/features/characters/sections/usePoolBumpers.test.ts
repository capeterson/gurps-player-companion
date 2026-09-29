import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { getLocalDb } from '../../../db/dexie.ts';
import { tokenStore } from '../../../lib/tokenStore.ts';
import { flashBus } from '../../../sync/flashBus.ts';
import { useCombatPatch } from './useCombatPatch.ts';
import { usePoolBumpers } from './usePoolBumpers.ts';

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000b0b1';
const toastPush = vi.fn();
vi.mock('../../../lib/toast.tsx', () => ({ useToasts: () => ({ push: toastPush }) }));

async function setup(hp = 10, fp = 12, canWrite = true) {
  const character = {
    id: CHAR_ID,
    derived: { hp: 10, fp: 12 },
    combat: { currentHp: hp, currentFp: fp },
  } as unknown as CharacterDetail;
  const db = getLocalDb();
  await db.characterCombat.add({
    id: CHAR_ID,
    characterId: CHAR_ID,
    currentHp: hp,
    currentFp: fp,
    conditions: [],
    maneuver: null,
    posture: 'standing',
    createdAt: '',
    updatedAt: '',
    revision: 1,
  });
  const hook = renderHook(() => usePoolBumpers(character, canWrite, useCombatPatch(character)));
  return { ...hook, db };
}
async function expectPools(hp: number, fp: number) {
  await waitFor(async () =>
    expect(await getLocalDb().characterCombat.get(CHAR_ID)).toMatchObject({
      currentHp: hp,
      currentFp: fp,
    }),
  );
}

describe('usePoolBumpers', () => {
  it.each([
    { synced: 15, deltas: [-1, -1, -1, -1, -1], expected: 10 },
    { synced: 5, deltas: [1, -1, 1, 1, -1], expected: 6 },
    { synced: 0, deltas: [-5, 1, -1, 3, -2], expected: -4 },
    { synced: -40, deltas: [-5, -5, 1, -1], expected: -50 },
  ])(
    'rebases an ordered HP burst $deltas onto latest synced value $synced',
    async ({ synced, deltas, expected }) => {
      const { result, db } = await setup();
      // This is the value a cursor pull may land while the tooltip is still
      // collecting relative gestures and therefore has no outbox row yet.
      await db.characterCombat.update(CHAR_ID, { currentHp: synced, revision: 2 });
      let committed: number | undefined;
      await act(async () => {
        committed = await result.current.commitHpDeltas(
          deltas.map((delta, index) => ({ delta, at: 1000 + index * 10 })),
        );
      });

      expect(committed).toBe(expected);
      await expectPools(expected, 12);
      expect(await db.outbox.toArray()).toMatchObject([
        { fieldPath: 'currentHp', prevValue: synced, attemptedValue: expected },
      ]);
    },
  );

  it('preserves the two-press soft-cap override when the presses share one debounced burst', async () => {
    const { result, db } = await setup(10, 12);
    let committed: number | undefined;
    await act(async () => {
      committed = await result.current.commitHpDeltas([
        { delta: 1, at: 1000 },
        { delta: 1, at: 1100 },
      ]);
    });

    expect(committed).toBe(11);
    await expectPools(11, 12);
    expect(await db.outbox.toArray()).toMatchObject([
      { fieldPath: 'currentHp', prevValue: 10, attemptedValue: 11 },
    ]);
  });

  it('folds every FP loss in a burst so floor overflow is charged to HP exactly once', async () => {
    const { result, db } = await setup(7, -10);
    let committed: number | undefined;
    await act(async () => {
      committed = await result.current.commitFpDeltas([
        { delta: -1, at: 1000 },
        { delta: -2, at: 1010 },
        { delta: -5, at: 1020 },
      ]);
    });

    expect(committed).toBe(-12);
    await expectPools(-1, -12);
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(2);
    expect(ops.find((op) => op.fieldPath === 'currentFp')).toMatchObject({
      prevValue: -10,
      attemptedValue: -12,
    });
    expect(ops.find((op) => op.fieldPath === 'currentHp')).toMatchObject({
      prevValue: 7,
      attemptedValue: -1,
    });
  });

  it('does not enqueue a net-zero debounced burst', async () => {
    const { result, db } = await setup();
    let committed: number | undefined;
    await act(async () => {
      committed = await result.current.commitHpDeltas([
        { delta: -1, at: 1000 },
        { delta: 1, at: 1010 },
      ]);
    });

    expect(committed).toBe(10);
    await expectPools(10, 12);
    expect(await db.outbox.count()).toBe(0);
  });

  it('compounds rapid taps and reset gestures before React receives a new row', async () => {
    const { result } = await setup();
    act(() => {
      result.current.bumpHp(-1);
      result.current.bumpHp(-1);
      result.current.resetHp();
      result.current.bumpHp(-1);
      result.current.bumpFp(-1);
      result.current.resetFp();
      result.current.bumpFp(-1);
    });
    await expectPools(9, 11);
  });

  it('persists every mashed FP increment immediately and coalesces the network intent', async () => {
    const { result, db } = await setup(10, 9);
    act(() => {
      for (let index = 0; index < 5; index += 1) result.current.bumpFp(1);
    });

    // 9 -> 12, one blocked press at the soft cap, then the explicit
    // second press overrides it. No separate speculative display is involved.
    await expectPools(10, 13);
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      fieldPath: 'currentFp',
      prevValue: 9,
      attemptedValue: 13,
      status: 'pending',
    });
    expect(Date.parse(ops[0]?.nextEarliestAttemptAt ?? '')).toBeGreaterThan(Date.now() - 1);
  });

  it('rebases consecutive absolute slider targets inside their transactions', async () => {
    const { result, db } = await setup(10, 12);
    act(() => {
      result.current.setFp(9);
      result.current.setFp(8);
    });

    await expectPools(10, 8);
    expect(await db.outbox.toArray()).toMatchObject([
      { fieldPath: 'currentFp', prevValue: 12, attemptedValue: 8 },
    ]);
  });

  it('serializes button and slider gestures against the latest durable row', async () => {
    const { result, db } = await setup(10, 12);
    act(() => {
      result.current.bumpFp(-1);
      result.current.setFp(6);
      result.current.bumpFp(1);
    });

    await expectPools(10, 7);
    expect(await db.outbox.toArray()).toMatchObject([
      { fieldPath: 'currentFp', prevValue: 12, attemptedValue: 7 },
    ]);
  });

  it('composes combined fatigue and independent HP changes through stale render snapshots', async () => {
    const { result, db } = await setup(10, 0);
    act(() => {
      result.current.bumpFp(-1);
      result.current.bumpFp(-1);
      result.current.bumpHp(-1);
      result.current.bumpFp(-1);
    });
    await expectPools(6, -3);
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(2);
    expect(new Set(ops.map((op) => op.batchId)).size).toBe(1);
    expect(new Set(ops.map((op) => op.nextEarliestAttemptAt)).size).toBe(1);
  });

  it('soft cap blocks once, then overrides within two seconds using gesture timestamps', async () => {
    const { result, db } = await setup();
    const now = vi.spyOn(Date, 'now').mockReturnValue(10000);
    act(() => result.current.bumpHp(1));
    // Wait until the blocked gesture has actually evaluated.
    await db.transaction('rw', db.characterCombat, db.outbox, () => undefined);
    expect(await db.outbox.count()).toBe(0);
    now.mockReturnValue(11000);
    act(() => result.current.bumpHp(1));
    await expectPools(11, 12);
    now.mockRestore();
  });

  it('blocks again after the override window expires', async () => {
    const { result, db } = await setup();
    const now = vi.spyOn(Date, 'now').mockReturnValue(10000);
    act(() => result.current.bumpHp(1));
    now.mockReturnValue(12500);
    act(() => result.current.bumpHp(1));
    await db.transaction('rw', db.characterCombat, db.outbox, () => undefined);
    expect(await db.outbox.count()).toBe(0);
    await expectPools(10, 12);
    now.mockRestore();
  });

  it('ignores bumps and resets without write access', async () => {
    const { result, db } = await setup(8, 3, false);
    act(() => {
      result.current.bumpHp(-1);
      result.current.bumpFp(-1);
      result.current.resetHp();
      result.current.resetFp();
    });
    await expectPools(8, 3);
    expect(await db.outbox.count()).toBe(0);
  });

  it('clamps HP at automatic death and FP at negative maximum', async () => {
    const { result } = await setup();
    act(() => {
      for (let i = 0; i < 13; i++) result.current.bumpHp(-5);
      for (let i = 0; i < 5; i++) result.current.bumpFp(-5);
    });
    await expectPools(-50, -12);
  });

  it('charges the whole loss below zero even across the FP floor', async () => {
    const { result, db } = await setup(7, -10);
    act(() => result.current.bumpFp(-5));
    await expectPools(2, -12);
    expect(await db.outbox.count()).toBe(2);
    await waitFor(() => expect(result.current.flashHp).toBe(true));
  });

  it('continues charging HP at the FP floor without redundant FP writes', async () => {
    const { result, db } = await setup(7, -12);
    act(() => {
      result.current.bumpFp(-1);
      result.current.bumpFp(-5);
    });
    await expectPools(1, -12);
    expect(await db.outbox.toArray()).toMatchObject([
      { fieldPath: 'currentHp', attemptedValue: 1, prevValue: 7 },
    ]);
  });

  it('retains both pools after a local failure and applies the next gesture to durable values', async () => {
    const { result, db } = await setup(10, 0);
    const add = vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('Disk full'));
    const flash = vi.spyOn(flashBus, 'emit');
    act(() => result.current.bumpFp(-1));
    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(expect.stringMatching(/FP and HP.*Disk full/), {
        kind: 'error',
      }),
    );
    await expectPools(10, 0);
    expect(await db.outbox.count()).toBe(0);
    expect(flash.mock.calls.map((call) => call[0])).toEqual([
      { key: `character_combat:${CHAR_ID}:currentFp`, reason: 'Disk full', visualOnly: true },
      { key: `character_combat:${CHAR_ID}:currentHp`, reason: 'Disk full', visualOnly: true },
    ]);
    add.mockRestore();
    act(() => result.current.bumpFp(-1));
    await expectPools(9, -1);
    flash.mockRestore();
  });
});

describe('pool sync burst identity', () => {
  it('keeps one gesture identity when rapid HP changes require separate ordered requests', async () => {
    const { result, db } = await setup();
    await act(async () => {
      await result.current.commitHpDeltas([{ delta: -1, at: 1000 }]);
    });
    const first = (await db.outbox.toArray())[0];
    expect(first?.batchId).toBeTruthy();
    if (!first) throw new Error('Missing first HP operation');
    // A claimed operation cannot be coalesced away, even if a subsequent
    // control event belongs to its explicit burst.
    await db.outbox.update(first.clientOpId, { status: 'in_flight' });
    await act(async () => {
      await result.current.commitHpDeltas([{ delta: -1, at: 1150 }]);
    });
    const entries = await db.outbox.orderBy('enqueuedAt').toArray();
    expect(entries).toHaveLength(2);
    expect(entries.map((op) => op.batchId)).toEqual([first.batchId, first.batchId]);
    expect(entries.map((op) => [op.prevValue, op.attemptedValue])).toEqual([
      [10, 9],
      [9, 8],
    ]);
    expect(entries[1]?.predecessorClientOpId).toBe(first.clientOpId);
    await expectPools(8, 12);
  });

  it('preserves the burst identity and earliest baseline when pending HP taps coalesce', async () => {
    const { result, db } = await setup();
    await act(async () => {
      await result.current.commitHpDeltas([{ delta: -1, at: 1000 }]);
    });
    const first = (await db.outbox.toArray())[0];
    await act(async () => {
      await result.current.commitHpDeltas([{ delta: -1, at: 1100 }]);
    });
    expect(await db.outbox.toArray()).toMatchObject([
      { batchId: first?.batchId, prevValue: 10, attemptedValue: 8, status: 'pending' },
    ]);
  });

  it('separates an HP tap at the debounce boundary and a separately applied injury', async () => {
    const { result, db } = await setup();
    const ids: Array<string | undefined> = [];
    for (const [at, separateGesture] of [
      [1000, false],
      [1200, false],
      [1250, true],
      [1300, false],
    ] as const) {
      await act(async () => {
        await result.current.commitHpDeltas([{ delta: -1, at }], { separateGesture });
      });
      const op = await db.outbox.orderBy('enqueuedAt').last();
      ids.push(op?.batchId);
      if (op) await db.outbox.update(op.clientOpId, { status: 'in_flight' });
    }
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(4);
  });

  it('keeps fatigue HP and FP changes together while separating direct HP gestures', async () => {
    const { result, db } = await setup(10, 0);
    await act(async () => {
      await result.current.commitFpDeltas([{ delta: -1, at: 1000 }]);
    });
    const fatigue = await db.outbox.toArray();
    expect(fatigue.map((op) => op.fieldPath).sort()).toEqual(['currentFp', 'currentHp']);
    expect(new Set(fatigue.map((op) => op.batchId)).size).toBe(1);
    for (const op of fatigue) await db.outbox.update(op.clientOpId, { status: 'in_flight' });
    await act(async () => {
      await result.current.commitHpDeltas([{ delta: -1, at: 1050 }]);
    });
    const last = await db.outbox.orderBy('enqueuedAt').last();
    expect(last?.batchId).not.toBe(fatigue[0]?.batchId);
  });

  it('separates reset and slider interactions from HP steps', async () => {
    const { result, db } = await setup(8, 10);
    const ids: Array<string | undefined> = [];
    const capture = async (hp: number) => {
      await expectPools(hp, 10);
      const op = await db.outbox.orderBy('enqueuedAt').last();
      ids.push(op?.batchId);
      if (op) await db.outbox.update(op.clientOpId, { status: 'in_flight' });
    };
    act(() => result.current.bumpHp(-1));
    await capture(7);
    act(() => result.current.setHp(6));
    await capture(6);
    act(() => result.current.resetHp());
    await capture(10);
    act(() => result.current.bumpHp(-1));
    await capture(9);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(4);
  });

  it('never reuses a preceding login session burst', async () => {
    const tokens = { accessToken: 'test', refreshToken: 'refresh', accessTokenExpiresIn: 3600 };
    tokenStore.write(tokens);
    try {
      const { result, db } = await setup();
      await act(async () => {
        await result.current.commitHpDeltas([{ delta: -1, at: 1000 }]);
      });
      const first = await db.outbox.orderBy('enqueuedAt').last();
      tokenStore.write(tokens); // A new login session, even for the same account.
      await act(async () => {
        await result.current.commitHpDeltas([{ delta: -1, at: 1100 }]);
      });
      expect((await db.outbox.orderBy('enqueuedAt').last())?.batchId).not.toBe(first?.batchId);
    } finally {
      tokenStore.clear();
    }
  });
});
