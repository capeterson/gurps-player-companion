/**
 * useConditionsToggle — the conditions-array toggle state machine
 * used by the Combat tab's PoolsCard. The load-bearing semantics:
 *
 *   1. Rapid taps that land before React re-renders compose against
 *      the latest-intended ref, not the render snapshot — two taps
 *      from an empty array (Stunned, then Bleeding) must both survive
 *      even though the outbox coalesces same-field patches.
 *   2. Legacy Capitalized entries ('Stunned') still round-trip through
 *      the normalized snake_case toggle.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { useConditionsToggle } from './useConditionsToggle.ts';

function makeCharacter(conditions: string[] = []): CharacterDetail {
  return {
    id: 'char-1',
    combat: { conditions },
  } as unknown as CharacterDetail;
}

describe('useConditionsToggle', () => {
  it('two rapid toggles from empty both land — final patch has BOTH conditions', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useConditionsToggle(makeCharacter([]), true, patchCombat));

    // Without the latest-intended ref, both taps would compute
    // toggleCondition against the same render-time empty array and
    // enqueue ['stunned'] then ['bleeding'] — the outbox coalesces
    // same-field patches (S3), so the second patch would overwrite the
    // first and 'stunned' would be silently dropped.
    act(() => {
      result.current.toggle('stunned');
      result.current.toggle('bleeding');
    });

    expect(patchCombat).toHaveBeenCalledTimes(2);
    expect(patchCombat).toHaveBeenNthCalledWith(1, 'conditions', ['stunned']);
    expect(patchCombat).toHaveBeenNthCalledWith(2, 'conditions', ['stunned', 'bleeding']);
  });

  it('legacy Capitalized condition still round-trips (toggling it off clears it)', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useConditionsToggle(makeCharacter(['Stunned']), true, patchCombat),
    );

    act(() => {
      result.current.toggle('stunned');
    });

    expect(patchCombat).toHaveBeenCalledWith('conditions', []);
  });

  it('ignores toggles when canWrite is false', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useConditionsToggle(makeCharacter([]), false, patchCombat));

    act(() => {
      result.current.toggle('stunned');
    });

    expect(patchCombat).not.toHaveBeenCalled();
  });

  it('resyncs the ref from a new server-confirmed conditions array', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ character }) => useConditionsToggle(character, true, patchCombat),
      { initialProps: { character: makeCharacter([]) } },
    );

    act(() => {
      result.current.toggle('stunned');
    });
    expect(patchCombat).toHaveBeenLastCalledWith('conditions', ['stunned']);

    // Dexie surfaces the confirmed row (e.g. remote change merged in).
    rerender({ character: makeCharacter(['stunned', 'prone']) });

    act(() => {
      result.current.toggle('bleeding');
    });
    // Composes on top of the resynced array, not the earlier local ref.
    expect(patchCombat).toHaveBeenLastCalledWith('conditions', ['stunned', 'prone', 'bleeding']);
  });
});
