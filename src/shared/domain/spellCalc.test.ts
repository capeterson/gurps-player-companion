import { describe, expect, it } from 'bun:test';
import {
  computeSpellLevel,
  costReduction,
  effectiveCastingCost,
  hasMagery,
  mageryLevel,
  totalPowerstoneEnergy,
} from './spellCalc.ts';

describe('mageryLevel', () => {
  it('returns 0 with no traits', () => {
    expect(mageryLevel([])).toBe(0);
  });

  it('reads the level from a Magery trait', () => {
    expect(mageryLevel([{ name: 'Magery', level: 2 }])).toBe(2);
  });

  it('treats null level as 0 (Magery 0)', () => {
    expect(mageryLevel([{ name: 'Magery', level: null }])).toBe(0);
  });

  it('matches case-insensitively and on multi-word names', () => {
    expect(mageryLevel([{ name: 'Magery (Solid!)', level: 3 }])).toBe(3);
    expect(mageryLevel([{ name: 'magery', level: 1 }])).toBe(1);
  });

  it('does not match unrelated traits like Imagery', () => {
    expect(mageryLevel([{ name: 'Imagery', level: 5 }])).toBe(0);
  });

  it('takes the highest of duplicate Magery rows', () => {
    expect(
      mageryLevel([
        { name: 'Magery', level: 1 },
        { name: 'Magery (Solid!)', level: 3 },
      ]),
    ).toBe(3);
  });
});

describe('hasMagery', () => {
  it('returns false with no traits', () => {
    expect(hasMagery([])).toBe(false);
  });

  it('returns true when Magery 0 is present (null level)', () => {
    expect(hasMagery([{ name: 'Magery', level: null }])).toBe(true);
  });

  it('returns false when only non-Magery traits are present', () => {
    expect(hasMagery([{ name: 'High Pain Threshold', level: null }])).toBe(false);
  });
});

describe('computeSpellLevel', () => {
  it('IQ 12, 1 point, Magery 0 → 12 (IQ -2 for H, +1 for 1 pt)', () => {
    // skillOffset('H', 1) = -2; level = 12 + (-2) + 0 = 10
    expect(computeSpellLevel(1, 12, 0)).toBe(10);
  });

  it('IQ 12, 1 point, Magery 1 → 11', () => {
    expect(computeSpellLevel(1, 12, 1)).toBe(11);
  });

  it('IQ 14, 4 points, Magery 2 → 14 + 0 + 2 = 16', () => {
    // skillOffset('H', 4) = 0
    expect(computeSpellLevel(4, 14, 2)).toBe(16);
  });

  it('Magery 3 stacks linearly', () => {
    // skillOffset('H', 1) = -2; 12 - 2 + 3 = 13
    expect(computeSpellLevel(1, 12, 3)).toBe(13);
  });
});

describe('costReduction', () => {
  it('is 0 below skill 15', () => {
    expect(costReduction(10)).toBe(0);
    expect(costReduction(14)).toBe(0);
  });

  it('is 1 at skill 15-19', () => {
    expect(costReduction(15)).toBe(1);
    expect(costReduction(19)).toBe(1);
  });

  it('is 2 at skill 20', () => {
    expect(costReduction(20)).toBe(2);
  });

  it('grows linearly above 20', () => {
    expect(costReduction(25)).toBe(3);
    expect(costReduction(30)).toBe(4);
  });

  it('clamps non-negative even for skills below 10', () => {
    expect(costReduction(5)).toBe(0);
    expect(costReduction(0)).toBe(0);
  });
});

describe('effectiveCastingCost', () => {
  it('keeps a free spell free', () => {
    expect(effectiveCastingCost(0, 25)).toBe(0);
  });

  it('floors a paid spell at 1', () => {
    expect(effectiveCastingCost(1, 30)).toBe(1);
  });

  it('subtracts the discount', () => {
    expect(effectiveCastingCost(4, 15)).toBe(3); // -1
    expect(effectiveCastingCost(4, 20)).toBe(2); // -2
    expect(effectiveCastingCost(4, 25)).toBe(1); // -3 → floor 1
    expect(effectiveCastingCost(4, 30)).toBe(1); // -4 → would be 0, floor 1
  });

  it('passes through unchanged when skill is too low to discount', () => {
    expect(effectiveCastingCost(3, 12)).toBe(3);
  });
});

describe('totalPowerstoneEnergy', () => {
  it('returns 0 with no items', () => {
    expect(totalPowerstoneEnergy([])).toBe(0);
  });

  it('skips non-powerstone items', () => {
    expect(totalPowerstoneEnergy([{ powerstoneData: null }, { powerstoneData: null }])).toBe(0);
  });

  it('sums currentEnergy across stones', () => {
    expect(
      totalPowerstoneEnergy([
        { powerstoneData: { currentEnergy: 3 } },
        { powerstoneData: null },
        { powerstoneData: { currentEnergy: 7 } },
      ]),
    ).toBe(10);
  });
});
