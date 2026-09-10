/**
 * usePoolBumpers — the HP/FP bumper state machine shared by combat
 * trackers.  The load-bearing semantics:
 *
 *   1. Rapid taps that land before React re-renders compound against
 *      the latest-intended ref, not the render snapshot — two -1 taps
 *      yield hp-2, never a duplicated hp-1.
 *   2. The soft cap blocks the first +1 at max; a second press within
 *      the 2 s window overrides and lands (bumpPool semantics).
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { flashBus } from '../../../sync/flashBus.ts';
import { usePoolBumpers } from './usePoolBumpers.ts';

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000b0b1';
const toastPush = vi.fn();
vi.mock('../../../lib/toast.tsx', () => ({ useToasts: () => ({ push: toastPush }) }));

/**
 * The hook only reads `combat`, `derived.hp`, `derived.fp`; a focused
 * partial cast keeps the fixture honest about those dependencies.
 */
function makeCharacter(hp = 10, fp = 12): CharacterDetail {
  return {
    id: CHAR_ID,
    derived: { hp, fp },
    combat: null,
  } as unknown as CharacterDetail;
}

describe('usePoolBumpers', () => {
  it('preserves later combined and different-field edits when an earlier local save returns', async () => {
    const pending: Array<() => void> = [];
    const patchCombat = vi
      .fn()
      .mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
    const character = makeCharacter(10, 10);
    character.combat = { currentHp: 10, currentFp: 0 } as CharacterDetail['combat'];
    const { result, rerender } = renderHook(
      ({ current }) => usePoolBumpers(current, true, patchCombat),
      { initialProps: { current: character } },
    );
    act(() => {
      result.current.bumpFp(-1);
      result.current.bumpFp(-1);
      result.current.bumpHp(-1);
    });
    await act(async () => pending[0]?.());
    rerender({
      current: {
        ...character,
        combat: { ...character.combat, currentHp: 9, currentFp: -1 } as CharacterDetail['combat'],
      },
    });
    act(() => result.current.bumpFp(-1));
    expect(patchCombat).toHaveBeenLastCalledWith({ currentHp: 6, currentFp: -3 });
    await act(async () => {
      for (const resolve of pending) resolve();
    });
  });

  it('reports a failed local pool transaction, flashes both fields and restores bumper intent', async () => {
    const patchCombat = vi
      .fn()
      .mockRejectedValueOnce(new Error('Disk full'))
      .mockResolvedValue(undefined);
    const flash = vi.spyOn(flashBus, 'emit');
    const character = makeCharacter(10, 10);
    character.combat = { currentHp: 10, currentFp: 0 } as CharacterDetail['combat'];
    const { result } = renderHook(() => usePoolBumpers(character, true, patchCombat));
    await act(async () => result.current.bumpFp(-1));
    expect(toastPush).toHaveBeenCalledWith(expect.stringMatching(/FP and HP.*Disk full/), {
      kind: 'error',
    });
    expect(flash.mock.calls.map((call) => call[0].key)).toEqual([
      `character_combat:${CHAR_ID}:currentFp`,
      `character_combat:${CHAR_ID}:currentHp`,
    ]);
    act(() => result.current.bumpFp(-1));
    expect(patchCombat).toHaveBeenLastCalledWith({ currentFp: -1, currentHp: 9 });
    flash.mockRestore();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('compounds rapid same-frame -1 taps instead of overwriting (hp-2, not hp-1)', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePoolBumpers(makeCharacter(10, 12), true, patchCombat));

    // Two taps before any re-render: without the latest-intended ref
    // both would read the render-time hp (10) and enqueue 9 twice,
    // silently dropping the second tap.
    act(() => {
      result.current.bumpHp(-1);
      result.current.bumpHp(-1);
    });

    expect(patchCombat).toHaveBeenCalledTimes(2);
    expect(patchCombat).toHaveBeenNthCalledWith(1, 'currentHp', 9);
    expect(patchCombat).toHaveBeenNthCalledWith(2, 'currentHp', 8);
  });

  it('soft cap: +1 at max is blocked on first press, lands on a second press within 2 s', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    // combat: null → hp starts at derived.hp, i.e. already at max.
    const { result } = renderHook(() => usePoolBumpers(makeCharacter(10, 12), true, patchCombat));

    // First press at max: blocked, no patch fires.
    act(() => {
      result.current.bumpHp(+1);
    });
    expect(patchCombat).not.toHaveBeenCalled();

    // Second press 1 s later, inside the 2 s override window: the
    // overflow lands.
    act(() => {
      vi.advanceTimersByTime(1000);
      result.current.bumpHp(+1);
    });
    expect(patchCombat).toHaveBeenCalledTimes(1);
    expect(patchCombat).toHaveBeenCalledWith('currentHp', 11);
  });

  it('soft cap: a second press after the 2 s window has expired is blocked again', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePoolBumpers(makeCharacter(10, 12), true, patchCombat));

    act(() => {
      result.current.bumpHp(+1); // blocked at t=0
      vi.advanceTimersByTime(2500); // window (2000 ms) has lapsed
      result.current.bumpHp(+1); // treated as a fresh first press → blocked
    });
    expect(patchCombat).not.toHaveBeenCalled();
  });

  it('resets update the latest-intended ref first so a racing bump composes on top', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePoolBumpers(makeCharacter(10, 12), true, patchCombat));

    act(() => {
      result.current.bumpHp(-5);
      result.current.resetHp();
      result.current.bumpHp(-1); // must compose against the reset value (10), not 5
    });

    expect(patchCombat).toHaveBeenNthCalledWith(1, 'currentHp', 5);
    expect(patchCombat).toHaveBeenNthCalledWith(2, 'currentHp', 10);
    expect(patchCombat).toHaveBeenNthCalledWith(3, 'currentHp', 9);
  });

  it('ignores bumps when canWrite is false', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePoolBumpers(makeCharacter(10, 12), false, patchCombat));

    act(() => {
      result.current.bumpHp(-1);
      result.current.bumpFp(-1);
    });
    expect(patchCombat).not.toHaveBeenCalled();
  });

  it('clamps HP damage at the -5×max automatic-death floor (B419) and FP at -1×max', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePoolBumpers(makeCharacter(10, 12), true, patchCombat));

    act(() => {
      // 13 × -5 from hp=10 would reach -55 raw, but the floor is -50 (=-5×10).
      for (let i = 0; i < 13; i++) result.current.bumpHp(-5);
    });
    expect(patchCombat).toHaveBeenLastCalledWith('currentHp', -50);

    patchCombat.mockClear();
    act(() => {
      // 5 × -5 = -13 raw from 12, floor is -12 (=-1×12).
      for (let i = 0; i < 5; i++) result.current.bumpFp(-5);
    });
    expect(patchCombat).toHaveBeenLastCalledWith('currentFp', -12);
  });

  it('charges all FP lost below zero and queues both pool changes together', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const character = makeCharacter(10, 12);
    character.combat = { currentHp: 7, currentFp: -10 } as CharacterDetail['combat'];
    const { result } = renderHook(() => usePoolBumpers(character, true, patchCombat));

    act(() => {
      result.current.bumpFp(-5);
    });

    expect(patchCombat).toHaveBeenCalledTimes(1);
    expect(patchCombat).toHaveBeenCalledWith({ currentFp: -12, currentHp: 2 });
    expect(result.current.flashHp).toBe(true);
  });

  it('charges further FP loss at the FP floor to HP without emitting a redundant FP patch', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const character = makeCharacter(10, 12);
    character.combat = { currentHp: 7, currentFp: -12 } as CharacterDetail['combat'];
    const { result } = renderHook(() => usePoolBumpers(character, true, patchCombat));

    act(() => {
      result.current.bumpFp(-1);
      result.current.bumpFp(-5);
    });

    expect(patchCombat).toHaveBeenNthCalledWith(1, 'currentHp', 6);
    expect(patchCombat).toHaveBeenNthCalledWith(2, 'currentHp', 1);
    expect(patchCombat).toHaveBeenCalledTimes(2);
  });
});
