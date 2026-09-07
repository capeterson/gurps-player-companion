import { describe, expect, it } from 'bun:test';
import { magicItemData, powerstoneData, weaponData } from './inventory.ts';

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

describe('weaponData', () => {
  it('defaults alternateModes to [] for a pre-existing weapon without the field', () => {
    expect(weaponData.parse({ damage: 'sw+1 cut' })).toEqual({
      damage: 'sw+1 cut',
      alternateModes: [],
    });
  });

  it('validates and round-trips a weapon with alternate modes', () => {
    const parsed = weaponData.parse({
      damage: 'sw-1 cut',
      reach: '1',
      parry: '0',
      alternateModes: [
        { name: 'Thrust', damage: 'thr imp', reach: '2', parry: '0' },
        { name: 'Thrown', damage: 'thr imp' },
      ],
    });
    expect(parsed.alternateModes).toHaveLength(2);
    expect(parsed.alternateModes[0]).toEqual({
      name: 'Thrust',
      damage: 'thr imp',
      reach: '2',
      parry: '0',
    });
    // An alternate leaving reach/parry unset stays unset (not coerced to the weapon's).
    expect(parsed.alternateModes[1]).toEqual({
      name: 'Thrown',
      damage: 'thr imp',
    });
  });

  it('rejects more than 10 alternate modes', () => {
    const modes = Array.from({ length: 11 }, (_, i) => ({ name: `Mode ${i}`, damage: '1d' }));
    expect(() => weaponData.parse({ alternateModes: modes })).toThrow();
  });

  it('rejects an alternate mode missing its name', () => {
    expect(() => weaponData.parse({ alternateModes: [{ damage: '1d' }] })).toThrow();
  });
});
