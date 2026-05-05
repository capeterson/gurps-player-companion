import { describe, expect, it } from 'bun:test';
import { bumpPool } from './poolBump.ts';

describe('bumpPool', () => {
  describe('damage', () => {
    it('always applies negative deltas', () => {
      expect(bumpPool(10, -5, 10, null).next).toBe(5);
      expect(bumpPool(0, -3, 10, null).next).toBe(-3);
    });

    it('clears the blocked timer on a damage tick', () => {
      const r = bumpPool(10, -1, 10, 100);
      expect(r.lastBlockedAt).toBeNull();
      expect(r.blocked).toBe(false);
    });
  });

  describe('healing under the cap', () => {
    it('applies positive deltas that stay below max', () => {
      expect(bumpPool(5, 3, 10, null).next).toBe(8);
    });

    it('clamps to max and arms the override on a single overshoot', () => {
      const r = bumpPool(8, 5, 10, null, 1000);
      expect(r.next).toBe(10);
      expect(r.blocked).toBe(true);
      expect(r.lastBlockedAt).toBe(1000);
    });
  });

  describe('healing at or above the cap (double-press override)', () => {
    it('blocks the first attempt at max', () => {
      const r = bumpPool(10, 1, 10, null, 1000);
      expect(r.next).toBe(10);
      expect(r.blocked).toBe(true);
      expect(r.lastBlockedAt).toBe(1000);
    });

    it('allows the second attempt within the window', () => {
      const r = bumpPool(10, 1, 10, 1500, 2000); // 500ms after blocked
      expect(r.next).toBe(11);
      expect(r.blocked).toBe(false);
      expect(r.lastBlockedAt).toBeNull();
    });

    it('blocks again if the second attempt falls outside the window', () => {
      const r = bumpPool(10, 1, 10, 1000, 5000); // 4s after blocked
      expect(r.next).toBe(10);
      expect(r.blocked).toBe(true);
      expect(r.lastBlockedAt).toBe(5000);
    });

    it('uses a configurable window', () => {
      const inside = bumpPool(10, 1, 10, 1000, 2500, 3000);
      expect(inside.next).toBe(11);
      const outside = bumpPool(10, 1, 10, 1000, 5000, 3000);
      expect(outside.next).toBe(10);
    });
  });
});
