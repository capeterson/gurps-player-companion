/**
 * Regression coverage for the temp-effects Speed axis, which is stored
 * in quarter-Speed-point units (`mods.speedQuarter`), so "Speed +1" must
 * store 4 quarters while reading back as +1.00. The inline add form that
 * originally mishandled this has been removed (the per-stat ✦ popovers
 * are now the single add path); the scaling invariant still holds for
 * the `scaledIntParser(0.25, …)` parser the population path depends on.
 * See `parsers.test.ts` for the parser's own unit tests.
 */

import { describe, expect, it } from 'vitest';
import { scaledIntParser } from '../../lib/parsers.ts';

describe('Speed temp-mod amount -> quarters conversion (scaledIntParser(0.25, -50, 50))', () => {
  const parseSpeedAmount = scaledIntParser(0.25, -50, 50);

  it('converts a whole Speed point to 4 quarters', () => {
    expect(parseSpeedAmount('1')).toBe(4);
  });

  it('converts a quarter-step decimal to 1 quarter', () => {
    expect(parseSpeedAmount('0.25')).toBe(1);
  });

  it('converts a negative whole Speed point to -4 quarters', () => {
    expect(parseSpeedAmount('-1')).toBe(-4);
  });

  it('rejects an amount that is not an exact quarter-step', () => {
    expect(() => parseSpeedAmount('0.1')).toThrow(/multiple of 0.25/);
  });
});
