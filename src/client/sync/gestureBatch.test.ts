import { describe, expect, it } from 'vitest';
import { createGestureBatcher } from './gestureBatch.ts';

function batcher() {
  let id = 0;
  return createGestureBatcher(200, () => `gesture-${++id}`);
}

describe('explicit incremental gesture batches', () => {
  it('extends one burst by interaction time and starts another exactly at the debounce boundary', () => {
    const batches = batcher();
    expect(batches.next('session:character', 'hp-step', 1000)).toBe('gesture-1');
    expect(batches.next('session:character', 'hp-step', 1199)).toBe('gesture-1');
    expect(batches.next('session:character', 'hp-step', 1398)).toBe('gesture-1');
    expect(batches.next('session:character', 'hp-step', 1598)).toBe('gesture-2');
  });

  it('never joins different controls, characters, or accounts', () => {
    const batches = batcher();
    const ids = [
      batches.next('session:a', 'hp-step', 1000),
      batches.next('session:a', 'fp-step', 1010),
      batches.next('session:a', 'hp-step', 1020),
      batches.next('session:a', 'hp-slider', 1030),
      batches.next('session:b', 'hp-slider', 1040),
      batches.next('other-session:b', 'hp-slider', 1050),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps reset and damage applications separate from the surrounding adjustment bursts', () => {
    const batches = batcher();
    const before = batches.next('session:a', 'hp-step', 1000);
    const damage = batches.next('session:a', 'hp-step', 1010, true);
    const after = batches.next('session:a', 'hp-step', 1020);
    const reset = batches.next('session:a', 'hp-reset', 1030, true);
    const afterReset = batches.next('session:a', 'hp-step', 1040);
    expect(new Set([before, damage, after, reset, afterReset]).size).toBe(5);
  });

  it('starts a new burst when the wall clock moves backward', () => {
    const batches = batcher();
    expect(batches.next('session:a', 'hp-step', 1000)).not.toBe(
      batches.next('session:a', 'hp-step', 999),
    );
  });
});
