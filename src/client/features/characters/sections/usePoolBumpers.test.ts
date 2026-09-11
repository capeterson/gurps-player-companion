import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { getLocalDb } from '../../../db/dexie.ts';
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
