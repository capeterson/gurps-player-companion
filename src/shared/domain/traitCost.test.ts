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
});
