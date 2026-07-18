import { describe, expect, it } from 'bun:test';
import type { DrByLocationMap } from './armorDr.ts';
import { applyDamage, parseArmorDivisor, woundingMultiplier } from './injuryCalc.ts';

function drMap(
  entries: Record<string, { dr: number; drCrushing?: number | null }>,
): DrByLocationMap {
  const map: DrByLocationMap = new Map();
  for (const [loc, v] of Object.entries(entries)) {
    map.set(loc, { dr: v.dr, drCrushing: v.drCrushing ?? null });
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
  it('subtracts DR and applies the wounding multiplier', () => {
    // 12 cut vs torso DR 4: 8 penetrating x 1.5 = 12 injury.
    const result = applyDamage(12, 'cut', 'torso', drMap({ torso: { dr: 4 } }), null);
    expect(result).toEqual({
      drAtLocation: 4,
      effectiveDr: 4,
      penetrating: 8,
      multiplier: 1.5,
      injury: 12,
    });
  });

  it('treats an uncovered location as DR 0', () => {
    const result = applyDamage(5, 'cr', 'face', drMap({ torso: { dr: 6 } }), null);
    expect(result.penetrating).toBe(5);
    expect(result.injury).toBe(5);
  });

  it('honors the crushing DR override for cr damage only', () => {
    const map = drMap({ torso: { dr: 2, drCrushing: 6 } });
    expect(applyDamage(6, 'cr', 'torso', map, null).penetrating).toBe(0);
    expect(applyDamage(6, 'cut', 'torso', map, null).penetrating).toBe(4);
  });

  it('divides DR by an armor divisor, rounding down', () => {
    // DR 5 / (2) = 2 effective.
    const result = applyDamage(6, 'imp', 'torso', drMap({ torso: { dr: 5 } }), '2');
    expect(result.effectiveDr).toBe(2);
    expect(result.penetrating).toBe(4);
    expect(result.injury).toBe(8);
  });

  it('multiplies DR for a fractional divisor like (0.5)', () => {
    const result = applyDamage(6, 'cr', 'torso', drMap({ torso: { dr: 4 } }), '0.5');
    expect(result.effectiveDr).toBe(8);
    expect(result.penetrating).toBe(0);
    expect(result.injury).toBe(0);
  });

  it('floors fractional injury but gives min 1 when anything penetrates', () => {
    // 1 penetrating x 0.5 (pi-) = 0.5 -> floors to 0 -> min 1 (B379).
    const result = applyDamage(1, 'pi-', 'torso', drMap({}), null);
    expect(result.penetrating).toBe(1);
    expect(result.injury).toBe(1);
  });

  it('gives 0 injury when nothing penetrates', () => {
    const result = applyDamage(3, 'cut', 'torso', drMap({ torso: { dr: 5 } }), null);
    expect(result.penetrating).toBe(0);
    expect(result.injury).toBe(0);
  });
});
