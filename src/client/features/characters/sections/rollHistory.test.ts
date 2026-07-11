/**
 * rollHistory — the ephemeral (never persisted) session roll log.
 * Verifies the two load-bearing contracts: newest-first ordering and
 * the 20-entry cap dropping the oldest roll.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type RollHistoryEntry,
  __resetRollHistoryForTests,
  pushRoll,
  useRollHistory,
} from './rollHistory.ts';

function entry(id: string): RollHistoryEntry {
  return {
    id,
    at: new Date(),
    characterId: 'char-1',
    label: 'Dodge',
    target: 10,
    dice: [1, 2, 3],
    total: 6,
    margin: 4,
    crit: null,
  };
}

describe('rollHistory', () => {
  beforeEach(() => {
    __resetRollHistoryForTests();
  });

  it('returns pushed rolls newest first', () => {
    const { result } = renderHook(() => useRollHistory());

    act(() => {
      pushRoll(entry('a'));
      pushRoll(entry('b'));
    });

    expect(result.current.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('caps at 20 entries, dropping the oldest', () => {
    const { result } = renderHook(() => useRollHistory());

    act(() => {
      for (let i = 0; i < 25; i++) pushRoll(entry(`r${i}`));
    });

    expect(result.current.length).toBe(20);
    // Newest (r24) first, oldest surviving (r5) last — r0-r4 dropped.
    expect(result.current[0]?.id).toBe('r24');
    expect(result.current[19]?.id).toBe('r5');
  });
});
