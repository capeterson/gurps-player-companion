/**
 * Regression coverage for PR #46 review finding 5: the named-effects
 * add form wrote the raw parsed Speed amount straight into
 * `mods.speedQuarter` (quarter-Speed-point units), so "Speed +1" stored
 * 1 quarter-step (+0.25 Speed) while reading as +1. The fix is two
 * halves:
 *   1. the add form now runs the amount through `scaledIntParser(0.25, …)`
 *      for the Speed axis, converting whole Speed points to quarters
 *      (covered directly against the shared parser below, since that's
 *      the exact function the form's `submitAdd` now calls) -- see
 *      `parsers.test.ts` for the parser's own unit tests, and
 *      `CharacterSheetPage.tsx`'s `submitAdd` for the call site.
 *   2. `formatEffectMods` (the effects-list row renderer) must scale a
 *      `speedQuarter` mod back down by ¼ for display, mirroring
 *      `SecondaryModCell`'s `modScale={0.25}` for the same axis.
 */

import { describe, expect, it } from 'vitest';
import { scaledIntParser } from '../../lib/parsers.ts';
import { formatEffectMods } from './CharacterSheetPage.tsx';

describe('formatEffectMods', () => {
  it('scales a speedQuarter mod back to whole Speed points for display', () => {
    // 4 quarters == +1.00 Speed.
    expect(formatEffectMods({ speedQuarter: 4 })).toBe('Speed +1.00');
  });

  it('scales a negative speedQuarter mod correctly', () => {
    expect(formatEffectMods({ speedQuarter: -2 })).toBe('Speed -0.50');
  });

  it('leaves non-Speed axes unscaled', () => {
    expect(formatEffectMods({ st: 2, ht: -1 })).toBe('ST +2, HT -1');
  });

  it('combines a scaled Speed mod with unscaled axes in one effect', () => {
    expect(formatEffectMods({ st: 3, speedQuarter: 4 })).toBe('ST +3, Speed +1.00');
  });

  it('omits zero and absent axes', () => {
    expect(formatEffectMods({ st: 0, dx: undefined, iq: 5 })).toBe('IQ +5');
  });
});

describe('Speed add-form amount -> quarters conversion (scaledIntParser(0.25, -50, 50))', () => {
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
