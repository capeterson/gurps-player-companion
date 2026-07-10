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
import { usePoolBumpers } from './usePoolBumpers.ts';

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000b0b1';

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

  it('clamps HP damage at the -4×max death-check floor and FP at -1×max', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePoolBumpers(makeCharacter(10, 12), true, patchCombat));

    act(() => {
      // 11 × -5 = -55 raw, but the floor is -40 (=-4×10).
      for (let i = 0; i < 11; i++) result.current.bumpHp(-5);
    });
    expect(patchCombat).toHaveBeenLastCalledWith('currentHp', -40);

    patchCombat.mockClear();
    act(() => {
      // 5 × -5 = -13 raw from 12, floor is -12 (=-1×12).
      for (let i = 0; i < 5; i++) result.current.bumpFp(-5);
    });
    expect(patchCombat).toHaveBeenLastCalledWith('currentFp', -12);
  });
});
