import { describe, expect, it } from 'bun:test';
import { type TraitModifier, computeModifiedCost, findGroupConflicts } from './modifierMath.ts';

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
