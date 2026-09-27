import { describe, expect, it } from 'bun:test';
import { rangedRange } from '../schemas/inventory.ts';
import {
  formatRangedRange,
  rangeBandsThrough,
  rangePenaltyForYards,
  resolveRangedRange,
  upgradeLegacyRange,
  upgradeLegacyWeaponRanges,
} from './rangedRange.ts';

describe('structured weapon Range', () => {
  it('requires a positive Max and 1/2D no greater than Max', () => {
    expect(() =>
      rangedRange.parse({ kind: 'fixed', halfDamageYards: 100, maxYards: 150 }),
    ).not.toThrow();
    expect(() => rangedRange.parse('100/150')).toThrow();
    expect(() =>
      rangedRange.parse({ kind: 'fixed', halfDamageYards: 160, maxYards: 150 }),
    ).toThrow();
    expect(() =>
      rangedRange.parse({ kind: 'fixed', halfDamageYards: null, maxYards: 0 }),
    ).toThrow();
  });

  it('resolves ST multipliers from the specified strength source', () => {
    const bow = {
      kind: 'st_multiplier',
      halfDamageFactor: 10,
      maxFactor: 15,
      strengthSource: 'weapon',
    } as const;
    expect(resolveRangedRange(bow, 14, 10)).toEqual({
      halfDamageYards: 100,
      maxYards: 150,
      minimumYards: null,
    });
    expect(resolveRangedRange({ ...bow, strengthSource: 'wielder' }, 14, 10)?.maxYards).toBe(210);
    expect(resolveRangedRange(bow, 14, null)).toBeNull();
    expect(formatRangedRange(bow)).toBe('×10/×15 ST');
  });

  it('uses B550 bands through the exact weapon Max', () => {
    expect(rangePenaltyForYards(2)).toBe(0);
    expect(rangePenaltyForYards(3)).toBe(-1);
    expect(rangePenaltyForYards(30)).toBe(-7);
    expect(rangePenaltyForYards(150)).toBe(-11);
    expect(rangeBandsThrough(175).at(-1)).toEqual({ maxYards: 175, penalty: -12 });
    expect(rangeBandsThrough(10).at(-1)).toEqual({ maxYards: 10, penalty: -4 });
  });

  it('upgrades old notation once and preserves unknown text for repair', () => {
    expect(upgradeLegacyRange('100/150')).toEqual({
      kind: 'fixed',
      halfDamageYards: 100,
      maxYards: 150,
    });
    expect(upgradeLegacyRange('x10/x15', 'weapon')).toEqual({
      kind: 'st_multiplier',
      halfDamageFactor: 10,
      maxFactor: 15,
      strengthSource: 'weapon',
    });
    expect(upgradeLegacyRange('special')).toEqual({ kind: 'legacy', notation: 'special' });
    expect(upgradeLegacyRange('  ')).toBeNull();
    const value = upgradeLegacyWeaponRanges({
      skill: 'Bow',
      ranged: { range: 'x10/x15' },
      modes: [{ skill: 'Guns (Pistol)', ranged: { range: '100/150' } }],
    });
    expect(value.ranged.range as unknown).toEqual(upgradeLegacyRange('x10/x15', 'weapon'));
    expect(value.modes[0]?.ranged.range as unknown).toEqual(upgradeLegacyRange('100/150'));
  });
});
