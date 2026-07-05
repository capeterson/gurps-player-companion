import { describe, expect, it } from 'bun:test';
import { computeTraitCost } from './traitCost.ts';

describe('computeTraitCost', () => {
  it('returns base when no modifiers are applied', () => {
    expect(computeTraitCost(10, [])).toBe(10);
  });

  it('applies a single percent modifier (Math.ceil)', () => {
    expect(computeTraitCost(10, [{ costType: 'percent', costValue: 50 }])).toBe(15);
    expect(computeTraitCost(10, [{ costType: 'percent', costValue: 25 }])).toBe(13); // ceil(12.5)
  });

  it('sums percentages before applying (B102 rule)', () => {
    expect(
      computeTraitCost(10, [
        { costType: 'percent', costValue: 50 },
        { costType: 'percent', costValue: -50 },
      ]),
    ).toBe(10);
  });

  it('applies flat modifiers after the percent multiplier', () => {
    expect(computeTraitCost(10, [{ costType: 'flat', costValue: 5 }])).toBe(15);
  });

  it('combines percent and flat correctly', () => {
    expect(
      computeTraitCost(10, [
        { costType: 'percent', costValue: 50 },
        { costType: 'flat', costValue: 5 },
      ]),
    ).toBe(20); // ceil(15) + 5
  });

  it('handles negative bases (limitations on disadvantages)', () => {
    expect(computeTraitCost(-20, [{ costType: 'percent', costValue: -50 }])).toBe(-10);
  });

  it('rounds up (against the character) for both signs — B102', () => {
    expect(computeTraitCost(10, [{ costType: 'percent', costValue: 15 }])).toBe(12); // 11.5 → 12
    expect(computeTraitCost(-10, [{ costType: 'percent', costValue: -25 }])).toBe(-7); // -7.5 → -7
  });

  it('clamps the net percent at -80% (B110 limitation floor)', () => {
    expect(computeTraitCost(10, [{ costType: 'percent', costValue: -100 }])).toBe(2);
    expect(
      computeTraitCost(10, [
        { costType: 'percent', costValue: -50 },
        { costType: 'percent', costValue: -50 },
      ]),
    ).toBe(2);
    // Enhancements pull the net back above the floor before clamping.
    expect(
      computeTraitCost(10, [
        { costType: 'percent', costValue: -100 },
        { costType: 'percent', costValue: 40 },
      ]),
    ).toBe(4); // net -60%, no clamp
  });

  it('avoids float error at the clamp boundary', () => {
    // 20 * 0.2 must be exactly 4, not 3.999... truncated later.
    expect(computeTraitCost(20, [{ costType: 'percent', costValue: -80 }])).toBe(4);
  });
});
