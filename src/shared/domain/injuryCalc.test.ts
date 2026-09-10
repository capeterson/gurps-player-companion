import { describe, expect, it } from 'bun:test';
import type { DrByLocationMap, TypedDrTotals } from './armorDr.ts';
import { effectiveDrByLocation } from './armorDr.ts';
import { applyDamage, parseArmorDivisor, woundingMultiplier } from './injuryCalc.ts';

/**
 * Build a typed-DR total for a fixture entry in the style
 * `aggregateDrByLocation` now emits: every type defaults to the base
 * `dr` (a layer without an override still contributes its base DR) and
 * a provided override replaces it for that single type.
 */
function typedDr(base: number, partial: Partial<TypedDrTotals> = {}): TypedDrTotals {
  return {
    cut: base,
    imp: base,
    pi: base,
    pi_minus: base,
    pi_plus: base,
    pi_pp: base,
    burn: base,
    corr: base,
    fat: base,
    tox: base,
    ...partial,
  };
}

function drMap(
  entries: Record<
    string,
    { dr: number; drCrushing?: number | null; typedDr?: Partial<TypedDrTotals> }
  >,
): DrByLocationMap {
  const map: DrByLocationMap = new Map();
  for (const [loc, v] of Object.entries(entries)) {
    map.set(loc, {
      dr: v.dr,
      drCrushing: v.drCrushing ?? null,
      typedDr: typedDr(v.dr, v.typedDr),
    });
  }
  return map;
}

describe('woundingMultiplier', () => {
  it('uses the B379 base table on the torso', () => {
    expect(woundingMultiplier('cut', 'torso')).toBe(1.5);
    expect(woundingMultiplier('imp', 'torso')).toBe(2);
    expect(woundingMultiplier('pi-', 'torso')).toBe(0.5);
    expect(woundingMultiplier('pi', 'torso')).toBe(1);
    expect(woundingMultiplier('pi+', 'torso')).toBe(1.5);
    expect(woundingMultiplier('pi++', 'torso')).toBe(2);
    expect(woundingMultiplier('cr', 'torso')).toBe(1);
    expect(woundingMultiplier('burn', 'torso')).toBe(1);
  });

  it('defaults unknown/homebrew/untyped damage to x1', () => {
    expect(woundingMultiplier('frostbite', 'torso')).toBe(1);
    expect(woundingMultiplier(null, 'torso')).toBe(1);
  });

  it('applies x4 to skull and eye for everything except toxic', () => {
    expect(woundingMultiplier('cr', 'skull')).toBe(4);
    expect(woundingMultiplier('pi-', 'eye')).toBe(4);
    expect(woundingMultiplier('tox', 'skull')).toBe(1);
  });

  it('applies x3 to vitals for impaling and piercing only', () => {
    expect(woundingMultiplier('imp', 'vitals')).toBe(3);
    expect(woundingMultiplier('pi-', 'vitals')).toBe(3);
    expect(woundingMultiplier('cut', 'vitals')).toBe(1.5);
  });

  it('applies neck overrides (cr x1.5, cut x2)', () => {
    expect(woundingMultiplier('cr', 'neck')).toBe(1.5);
    expect(woundingMultiplier('cut', 'neck')).toBe(2);
    expect(woundingMultiplier('imp', 'neck')).toBe(2);
  });

  it('caps imp/pi+/pi++ at x1 on limbs and extremities', () => {
    expect(woundingMultiplier('imp', 'arm_left')).toBe(1);
    expect(woundingMultiplier('pi++', 'leg_right')).toBe(1);
    expect(woundingMultiplier('pi+', 'hand_left')).toBe(1);
    // cut keeps its base multiplier on a limb (B399 caps only imp/pi+/pi++).
    expect(woundingMultiplier('cut', 'arm_left')).toBe(1.5);
  });

  it('uses the base multiplier for custom locations', () => {
    expect(woundingMultiplier('cut', 'tail')).toBe(1.5);
  });
});

describe('parseArmorDivisor', () => {
  it('parses integers and fractions', () => {
    expect(parseArmorDivisor('2')).toBe(2);
    expect(parseArmorDivisor('10')).toBe(10);
    expect(parseArmorDivisor('0.5')).toBe(0.5);
  });

  it('parses the parenthesized book notation', () => {
    expect(parseArmorDivisor('(2)')).toBe(2);
    expect(parseArmorDivisor('(0.5)')).toBe(0.5);
    expect(parseArmorDivisor(' (10) ')).toBe(10);
  });

  it('returns null for missing or unparseable input', () => {
    expect(parseArmorDivisor(null)).toBeNull();
    expect(parseArmorDivisor(undefined)).toBeNull();
    expect(parseArmorDivisor('')).toBeNull();
    expect(parseArmorDivisor('x')).toBeNull();
    expect(parseArmorDivisor('-2')).toBeNull();
    expect(parseArmorDivisor('0')).toBeNull();
  });
});

describe('applyDamage', () => {
  it.each([
    [10, 'arm_left', 5, 5, false],
    [10, 'arm_left', 6, 6, false],
    [10, 'arm_left', 20, 6, true],
    [10, 'hand_left', 4, 4, false],
    [10, 'hand_left', 20, 4, true],
    [11, 'leg_right', 20, 6, true],
    [11, 'foot_right', 20, 4, true],
    [12, 'arm_right', 20, 7, true],
    [10, 'torso', 20, 20, false],
    [10, 'eye', 20, 80, false],
    [10, 'skull', 20, 72, false],
  ] as const)(
    'caps HP%s %s injury from %s to %s while preserving destruction evidence',
    (hp, loc, damage, injury, destroyed) => {
      const result = applyDamage(damage, 'cr', loc, effectiveDrByLocation([]), null, hp);
      expect(result.injury).toBe(injury);
      expect(result.destroyed).toBe(destroyed);
      expect(result.preCapInjury).toBe(loc === 'eye' ? 80 : loc === 'skull' ? 72 : damage);
    },
  );

  it.each(['imp', 'pi+', 'pi++'])(
    'caps %s limb injury after armor and limb wounding multiplier',
    (type) => {
      const result = applyDamage(20, type, 'arm_left', drMap({ arm_left: { dr: 4 } }), null, 10);
      expect(result.multiplier).toBe(1);
      expect(result.preCapInjury).toBe(16);
      expect(result.injury).toBe(6);
      expect(result.crippled).toBe(true);
      expect(result.destroyed).toBe(true);
    },
  );

  it('subtracts DR and applies the wounding multiplier', () => {
    // 12 cut vs torso DR 4: 8 penetrating x 1.5 = 12 injury.
    const result = applyDamage(12, 'cut', 'torso', drMap({ torso: { dr: 4 } }), null, 10);
    expect(result).toEqual({
      drAtLocation: 4,
      effectiveDr: 4,
      penetrating: 8,
      multiplier: 1.5,
      injury: 12,
      preCapInjury: 12,
      cripplingThreshold: null,
      crippled: false,
      destroyed: false,
    });
  });

  it('treats an uncovered location as DR 0', () => {
    const result = applyDamage(5, 'cr', 'face', drMap({ torso: { dr: 6 } }), null, 10);
    expect(result.penetrating).toBe(5);
    expect(result.injury).toBe(5);
  });

  it('honors the crushing DR override for cr damage only', () => {
    const map = drMap({ torso: { dr: 2, drCrushing: 6 } });
    expect(applyDamage(6, 'cr', 'torso', map, null, 10).penetrating).toBe(0);
    expect(applyDamage(6, 'cut', 'torso', map, null, 10).penetrating).toBe(4);
  });

  it('honors the typed DR override for the matching damage type', () => {
    const map = drMap({ torso: { dr: 2, typedDr: { cut: 6 } } });
    // 6 cut vs typed DR 6: fully stopped.
    expect(applyDamage(6, 'cut', 'torso', map, null, 10).penetrating).toBe(0);
    expect(applyDamage(6, 'cut', 'torso', map, null, 10).drAtLocation).toBe(6);
    // Another type falls through to the base dr.
    expect(applyDamage(6, 'imp', 'torso', map, null, 10).penetrating).toBe(4);
  });

  it('typed override beats the crushing override for cr-adjacent types', () => {
    const map = drMap({ torso: { dr: 2, drCrushing: 6, typedDr: { cut: 1 } } });
    // cut uses typedDr (drCrushing is reserved for cr).
    expect(applyDamage(6, 'cut', 'torso', map, null, 10).penetrating).toBe(5);
    // cr still uses the crushing override since typedDr has no cr key.
    expect(applyDamage(6, 'cr', 'torso', map, null, 10).penetrating).toBe(0);
  });

  it('applies the armor divisor against typed DR', () => {
    const map = drMap({ torso: { dr: 10, typedDr: { imp: 8 } } });
    // DR 8 imp / (2) = 4 effective; 10 imp -> 6 penetrating x2 = 12 injury.
    const result = applyDamage(10, 'imp', 'torso', map, '2', 10);
    expect(result.effectiveDr).toBe(4);
    expect(result.penetrating).toBe(6);
    expect(result.injury).toBe(12);
  });

  it('divides DR by an armor divisor, rounding down', () => {
    // DR 5 / (2) = 2 effective.
    const result = applyDamage(6, 'imp', 'torso', drMap({ torso: { dr: 5 } }), '2', 10);
    expect(result.effectiveDr).toBe(2);
    expect(result.penetrating).toBe(4);
    expect(result.injury).toBe(8);
  });

  it('multiplies DR for a fractional divisor like (0.5)', () => {
    const result = applyDamage(6, 'cr', 'torso', drMap({ torso: { dr: 4 } }), '0.5', 10);
    expect(result.effectiveDr).toBe(8);
    expect(result.penetrating).toBe(0);
    expect(result.injury).toBe(0);
  });

  it('floors fractional injury but gives min 1 when anything penetrates', () => {
    // 1 penetrating x 0.5 (pi-) = 0.5 -> floors to 0 -> min 1 (B379).
    const result = applyDamage(1, 'pi-', 'torso', drMap({}), null, 10);
    expect(result.penetrating).toBe(1);
    expect(result.injury).toBe(1);
  });

  it('gives 0 injury when nothing penetrates', () => {
    const result = applyDamage(3, 'cut', 'torso', drMap({ torso: { dr: 5 } }), null, 10);
    expect(result.penetrating).toBe(0);
    expect(result.injury).toBe(0);
  });

  it('adds the skull natural DR 2 even when unarmored (B400)', () => {
    // 2 cr to a bare skull: fully stopped by the natural DR 2.
    const result = applyDamage(2, 'cr', 'skull', effectiveDrByLocation([]), null, 10);
    expect(result.drAtLocation).toBe(2);
    expect(result.penetrating).toBe(0);
    expect(result.injury).toBe(0);
  });

  it('stacks the skull natural DR 2 with helmet armor', () => {
    // Helmet DR 4 + natural 2 = 6; 10 imp -> 4 penetrating x4 (skull) = 16.
    const map = effectiveDrByLocation(
      [],
      [{ target: 'dr', value: 4, active: true, hitLocation: 'skull' }],
    );
    const result = applyDamage(10, 'imp', 'skull', map, null, 10);
    expect(result.drAtLocation).toBe(6);
    expect(result.penetrating).toBe(4);
    expect(result.injury).toBe(16);
  });
});
