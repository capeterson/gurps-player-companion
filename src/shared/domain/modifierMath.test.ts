import { describe, expect, it } from 'bun:test';
import {
  type TraitModifier,
  computeLeveledTraitCost,
  computeModifiedCost,
  findGroupConflicts,
} from './modifierMath.ts';

const enh = (name: string, costValue: number, group?: string): TraitModifier => ({
  name,
  category: 'enhancement',
  costType: 'percent',
  costValue,
  ...(group !== undefined ? { group } : {}),
});

const lim = (name: string, costValue: number, group?: string): TraitModifier => ({
  name,
  category: 'limitation',
  costType: 'percent',
  costValue,
  ...(group !== undefined ? { group } : {}),
});

const flat = (name: string, costValue: number): TraitModifier => ({
  name,
  category: 'enhancement',
  costType: 'flat',
  costValue,
});

describe('computeModifiedCost', () => {
  it('no modifiers leaves base unchanged', () => {
    const r = computeModifiedCost(50, []);
    expect(r.total).toBe(50);
    expect(r.percentSum).toBe(0);
    expect(r.flatSum).toBe(0);
  });

  it('+50% enhancement on a 20-pt advantage = 30', () => {
    expect(computeModifiedCost(20, [enh('Area Effect', 50)]).total).toBe(30);
  });

  it('-40% limitation on a 20-pt advantage = 12', () => {
    expect(computeModifiedCost(20, [lim('Mitigator', -40)]).total).toBe(12);
  });

  it('combines percent enhancements and limitations (sum then apply)', () => {
    const r = computeModifiedCost(50, [enh('a', 50), lim('b', -25)]);
    // 50 * (1 + 0.25) = 62.5 → ceil to 63 (round against the character)
    expect(r.total).toBe(63);
  });

  it('clamps the net modifier to -80% (B110)', () => {
    const r = computeModifiedCost(100, [lim('a', -50), lim('b', -50), lim('c', -50)]);
    // sum = -150 → clamped to -80 → 100 * 0.2 = 20
    expect(r.total).toBe(20);
  });

  it('rounds up, against the character, for both signs (B102)', () => {
    expect(computeModifiedCost(10, [enh('+15%', 15)]).total).toBe(12); // 11.5 → 12
    expect(computeModifiedCost(-10, [lim('-25%', -25)]).total).toBe(-7); // -7.5 → -7
  });

  it('adds flat modifiers after percent scaling', () => {
    const r = computeModifiedCost(20, [enh('a', 50), flat('b', 5)]);
    expect(r.total).toBe(35); // 20 * 1.5 = 30 + 5
  });
});

describe('findGroupConflicts', () => {
  it('returns empty when no groups overlap', () => {
    expect(findGroupConflicts([enh('a', 10, 'g1'), enh('b', 10, 'g2')])).toEqual([]);
  });
  it('returns groups with multiple selections', () => {
    expect(findGroupConflicts([enh('a', 10, 'g1'), enh('b', 5, 'g1')])).toEqual(['g1']);
  });
  it('ignores modifiers without a group', () => {
    expect(findGroupConflicts([enh('a', 10), enh('b', 5)])).toEqual([]);
  });
});

describe('computeLeveledTraitCost', () => {
  it('non-leveled trait returns base cost', () => {
    const r = computeLeveledTraitCost({ basePoints: 15 });
    expect(r.leveled).toBe(15);
    expect(r.variantAdjusted).toBe(15);
    expect(r.total).toBe(15);
  });

  it('per-level scaling: Acute Vision 3 at 2/level + base 0 = 6', () => {
    const r = computeLeveledTraitCost({ basePoints: 0, pointsPerLevel: 2, level: 3 });
    expect(r.leveled).toBe(6);
    expect(r.total).toBe(6);
  });

  it('per-level scaling with non-zero base: Magery 3 = 5 + 3*10 = 35', () => {
    const r = computeLeveledTraitCost({ basePoints: 5, pointsPerLevel: 10, level: 3 });
    expect(r.leveled).toBe(35);
    expect(r.total).toBe(35);
  });

  it('variant multiplier rounds up: Damage Resistance 1 (Hardened ×1.2) = ceil(5 * 1.2) = 6', () => {
    const r = computeLeveledTraitCost({
      basePoints: 0,
      pointsPerLevel: 5,
      level: 1,
      variant: { pointCostMultiplier: 1.2 },
    });
    expect(r.leveled).toBe(5);
    expect(r.variantAdjusted).toBe(6);
    expect(r.total).toBe(6);
  });

  it('variant multiplier: DR 5 (Tough Skin ×0.6) = ceil(25 * 0.6) = 15', () => {
    const r = computeLeveledTraitCost({
      basePoints: 0,
      pointsPerLevel: 5,
      level: 5,
      variant: { pointCostMultiplier: 0.6 },
    });
    expect(r.leveled).toBe(25);
    expect(r.variantAdjusted).toBe(15);
    expect(r.total).toBe(15);
  });

  it('variant delta only: Wealth (Filthy Rich) = 0 + 50 flat = 50', () => {
    const r = computeLeveledTraitCost({
      basePoints: 0,
      variant: { pointCostDelta: 50 },
    });
    expect(r.leveled).toBe(0);
    expect(r.variantAdjusted).toBe(50);
    expect(r.total).toBe(50);
  });

  it('variant multiplier then delta: ceil(20 * 1.2) + 5 = 29', () => {
    const r = computeLeveledTraitCost({
      basePoints: 20,
      variant: { pointCostMultiplier: 1.2, pointCostDelta: 5 },
    });
    expect(r.variantAdjusted).toBe(29);
  });

  it('modifiers apply on top of variant-adjusted cost: DR 2 (Hardened ×1.2) (+20% enhancement)', () => {
    const r = computeLeveledTraitCost({
      basePoints: 0,
      pointsPerLevel: 5,
      level: 2,
      variant: { pointCostMultiplier: 1.2 },
      modifiers: [enh('Affects Insubstantial', 20)],
    });
    expect(r.leveled).toBe(10);
    expect(r.variantAdjusted).toBe(12);
    // 12 * (100+20)/100 = 14.4, ceil = 15 (per B102-style round-up rule
    // used by computeModifiedCost / computeTraitCostBreakdown).
    expect(r.total).toBe(15);
  });

  it('disadvantage with negative basePoints scales correctly: Bad Sight -25 with no level/variant', () => {
    const r = computeLeveledTraitCost({ basePoints: -25 });
    expect(r.total).toBe(-25);
  });

  it('disadvantage with mitigator: Bad Sight -25 (Glasses -50%) = -12 (truncated toward zero)', () => {
    const r = computeLeveledTraitCost({
      basePoints: -25,
      modifiers: [lim('Mitigator', -50)],
    });
    // -25 * 0.5 = -12.5, truncate toward zero = -12
    expect(r.total).toBe(-12);
  });

  it('level 0 with pointsPerLevel returns just basePoints', () => {
    const r = computeLeveledTraitCost({ basePoints: 5, pointsPerLevel: 10, level: 0 });
    expect(r.leveled).toBe(5);
    expect(r.total).toBe(5);
  });

  it('null level defaults to 0', () => {
    const r = computeLeveledTraitCost({ basePoints: 5, pointsPerLevel: 10, level: null });
    expect(r.leveled).toBe(5);
  });
});
