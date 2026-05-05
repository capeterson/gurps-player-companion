import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRangeSelect } from './useRangeSelect.ts';

const ev = (mods: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) => ({
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...mods,
});

describe('useRangeSelect', () => {
  it('plain click replaces selection and moves anchor', () => {
    const { result } = renderHook(() => useRangeSelect(['a', 'b', 'c', 'd']));
    act(() => result.current.handleClick('b', ev()));
    expect([...result.current.selectedIds]).toEqual(['b']);
    act(() => result.current.handleClick('c', ev()));
    expect([...result.current.selectedIds]).toEqual(['c']);
  });

  it('cmd-click toggles without moving anchor', () => {
    const { result } = renderHook(() => useRangeSelect(['a', 'b', 'c', 'd']));
    act(() => result.current.handleClick('a', ev()));
    act(() => result.current.handleClick('c', ev({ metaKey: true })));
    expect(new Set(result.current.selectedIds)).toEqual(new Set(['a', 'c']));
    // Toggling off
    act(() => result.current.handleClick('c', ev({ ctrlKey: true })));
    expect(new Set(result.current.selectedIds)).toEqual(new Set(['a']));
  });

  it('shift-click extends selection from the anchor', () => {
    const { result } = renderHook(() => useRangeSelect(['a', 'b', 'c', 'd', 'e']));
    act(() => result.current.handleClick('b', ev()));
    act(() => result.current.handleClick('d', ev({ shiftKey: true })));
    expect(new Set(result.current.selectedIds)).toEqual(new Set(['b', 'c', 'd']));
  });

  it('shift-click works backwards (anchor after target)', () => {
    const { result } = renderHook(() => useRangeSelect(['a', 'b', 'c', 'd', 'e']));
    act(() => result.current.handleClick('d', ev()));
    act(() => result.current.handleClick('a', ev({ shiftKey: true })));
    expect(new Set(result.current.selectedIds)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('clear empties selection and resets anchor', () => {
    const { result } = renderHook(() => useRangeSelect(['a', 'b', 'c']));
    act(() => result.current.handleClick('b', ev()));
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });

  it('ignores ids that are not in the ordered list', () => {
    const { result } = renderHook(() => useRangeSelect(['a', 'b']));
    act(() => result.current.handleClick('z', ev()));
    expect(result.current.count).toBe(0);
  });
});
