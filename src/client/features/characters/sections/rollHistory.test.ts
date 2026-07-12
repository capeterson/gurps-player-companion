/**
 * rollHistory — per-character roll log persisted to localStorage.
 * Verifies: newest-first ordering, the 100-entry cap dropping the
 * oldest, per-character isolation, and logout clearing.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type RollHistoryEntry,
  __resetRollHistoryForTests,
  clearAllRollHistory,
  pushRoll,
  useRollHistory,
} from './rollHistory.ts';

function entry(id: string, characterId = 'char-1'): RollHistoryEntry {
  return {
    id,
    at: new Date(),
    characterId,
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
    const { result } = renderHook(() => useRollHistory('char-1'));

    act(() => {
      pushRoll(entry('a'));
      pushRoll(entry('b'));
    });

    expect(result.current.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('caps at 100 entries, dropping the oldest', () => {
    const { result } = renderHook(() => useRollHistory('char-1'));

    act(() => {
      for (let i = 0; i < 105; i++) pushRoll(entry(`r${i}`));
    });

    expect(result.current.length).toBe(100);
    expect(result.current[0]?.id).toBe('r104');
    expect(result.current[99]?.id).toBe('r5');
  });

  it('isolates rolls per character', () => {
    const { result: a } = renderHook(() => useRollHistory('char-a'));
    const { result: b } = renderHook(() => useRollHistory('char-b'));

    act(() => {
      pushRoll(entry('a1', 'char-a'));
      pushRoll(entry('b1', 'char-b'));
      pushRoll(entry('a2', 'char-a'));
    });

    expect(a.current.map((r) => r.id)).toEqual(['a2', 'a1']);
    expect(b.current.map((r) => r.id)).toEqual(['b1']);
  });

  it('persists to localStorage across hook instances', () => {
    const { unmount } = renderHook(() => useRollHistory('char-1'));

    act(() => {
      pushRoll(entry('persisted'));
    });
    unmount();

    const { result: again } = renderHook(() => useRollHistory('char-1'));
    expect(again.current.map((r) => r.id)).toEqual(['persisted']);
  });

  it('clearAllRollHistory wipes every character', () => {
    const { result: a } = renderHook(() => useRollHistory('char-a'));
    const { result: b } = renderHook(() => useRollHistory('char-b'));

    act(() => {
      pushRoll(entry('a1', 'char-a'));
      pushRoll(entry('b1', 'char-b'));
      clearAllRollHistory();
    });

    expect(a.current).toEqual([]);
    expect(b.current).toEqual([]);
  });
});
