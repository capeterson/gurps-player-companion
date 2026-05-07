import { describe, expect, it } from 'bun:test';
import { magicItemData, powerstoneData } from './inventory.ts';

describe('powerstoneData', () => {
  it('accepts a valid stone', () => {
    expect(powerstoneData.parse({ maxEnergy: 5, currentEnergy: 3 })).toEqual({
      maxEnergy: 5,
      currentEnergy: 3,
    });
  });

  it('accepts current === max (full stone)', () => {
    expect(() => powerstoneData.parse({ maxEnergy: 5, currentEnergy: 5 })).not.toThrow();
  });

  it('rejects current > max', () => {
    // The independent bounds (currentEnergy ≤ 100) used to let a 5-cap
    // stone arrive with currentEnergy=100; the cross-field refinement
    // catches it now.
    expect(() => powerstoneData.parse({ maxEnergy: 5, currentEnergy: 100 })).toThrow();
    expect(() => powerstoneData.parse({ maxEnergy: 5, currentEnergy: 6 })).toThrow();
  });
});

describe('magicItemData', () => {
  it('accepts a charged item with current ≤ max', () => {
    expect(() =>
      magicItemData.parse({
        spellName: 'Fireball',
        spellSkillLevel: 15,
        mode: 'charged',
        chargesMax: 10,
        chargesCurrent: 7,
      }),
    ).not.toThrow();
  });

  it('rejects chargesCurrent > chargesMax', () => {
    expect(() =>
      magicItemData.parse({
        spellName: 'Fireball',
        spellSkillLevel: 15,
        mode: 'charged',
        chargesMax: 10,
        chargesCurrent: 999,
      }),
    ).toThrow();
  });

  it('accepts powered/continuous items without charge fields', () => {
    expect(() =>
      magicItemData.parse({
        spellName: 'Light',
        spellSkillLevel: 12,
        mode: 'continuous',
      }),
    ).not.toThrow();
    expect(() =>
      magicItemData.parse({
        spellName: 'Major Healing',
        spellSkillLevel: 18,
        mode: 'powered',
        energyCost: 4,
      }),
    ).not.toThrow();
  });
});
