import { describe, expect, it } from 'bun:test';
import { aggregateDrByLocation, effectiveDrByLocation, resolveDr, sumArmorDb } from './armorDr.ts';
import type { ArmorItemRow } from './armorDr.ts';
import { applyDamage } from './injuryCalc.ts';
import { resolveEffects } from './traitEffects.ts';

function item(
  dr: number,
  locations: string[],
  opts: Partial<ArmorItemRow['armor']> = {},
): ArmorItemRow {
  return {
    equipped: true,
    isArmor: true,
    armor: {
      locations,
      dr,
      drCrushing: null,
      typedDr: {},
      flexible: false,
      frontOnly: false,
      backOnly: false,
      db: null,
      notes: null,
      ...opts,
    },
  };
}

describe('aggregateDrByLocation', () => {
  it('includes torso layers at the vitals without double counting explicit coverage', () => {
    const map = aggregateDrByLocation([
      item(4, ['torso'], { typedDr: { imp: 7 } }),
      item(2, ['torso', 'vitals', 'torso']),
      item(1, ['vitals']),
    ]);
    expect(resolveDr('imp', map.get('vitals'))).toBe(10);
    expect(resolveDr('imp', map.get('torso'))).toBe(9);
    expect(applyDamage(12, 'imp', 'vitals', map, '2', 10).injury).toBe(21);
  });
  it('sums DR across equipped armor covering the same location', () => {
    const result = aggregateDrByLocation([item(2, ['torso']), item(3, ['torso', 'arm_left'])]);
    expect(result.get('torso')?.dr).toBe(5);
    expect(result.get('arm_left')?.dr).toBe(3);
  });

  it('skips unequipped or non-armor items', () => {
    const result = aggregateDrByLocation([
      item(4, ['torso']),
      { equipped: false, isArmor: true, armor: item(10, ['torso']).armor },
      { equipped: true, isArmor: false, armor: null },
    ]);
    expect(result.get('torso')?.dr).toBe(4);
  });

  it('tracks crushing DR overrides separately', () => {
    const result = aggregateDrByLocation([
      item(3, ['torso'], { drCrushing: 5 }),
      item(2, ['torso'], { drCrushing: null }),
    ]);
    expect(result.get('torso')?.dr).toBe(5);
    expect(result.get('torso')?.drCrushing).toBe(7);
  });

  it('returns null crushing DR when no item overrides it', () => {
    const result = aggregateDrByLocation([item(3, ['torso'])]);
    expect(result.get('torso')?.drCrushing).toBeNull();
  });

  it('returns an empty map when no equipped armor exists', () => {
    expect(aggregateDrByLocation([]).size).toBe(0);
    expect(aggregateDrByLocation([{ equipped: true, isArmor: false, armor: null }]).size).toBe(0);
  });

  it('sums typed DR overrides across armor pieces on the same location', () => {
    const result = aggregateDrByLocation([
      item(2, ['torso'], { typedDr: { cut: 4 } }),
      item(3, ['torso'], { typedDr: { cut: 2, imp: 10 } }),
    ]);
    expect(result.get('torso')?.dr).toBe(5);
    // cut: 4 + 2 (override wins on both pieces)
    expect(result.get('torso')?.typedDr.cut).toBe(6);
    // imp: 10 (override) + 2 (base dr of the piece without an override)
    expect(result.get('torso')?.typedDr.imp).toBe(12);
    // No override on either piece: base dr of each layer.
    expect(result.get('torso')?.typedDr.burn).toBe(5);
    expect(result.get('torso')?.typedDr.pi).toBe(5);
  });

  it('each layer contributes its override or its base dr to the typed total', () => {
    // The review regression: base DR 4 armor plus DR 2 armor with a
    // cut override must give cut 9, not 5.
    const result = aggregateDrByLocation([
      item(4, ['torso']),
      item(2, ['torso'], { typedDr: { cut: 5 } }),
    ]);
    expect(result.get('torso')?.dr).toBe(6);
    expect(result.get('torso')?.typedDr.cut).toBe(9);
    // imp has no override: both pieces contribute base dr.
    expect(result.get('torso')?.typedDr.imp).toBe(6);
  });

  it('fill typed DR per-location with the computed stack when no armor overrides any type', () => {
    const result = aggregateDrByLocation([item(3, ['torso'])]);
    const entry = result.get('torso');
    expect(entry?.typedDr).toEqual({
      cut: 3,
      imp: 3,
      pi: 3,
      pi_minus: 3,
      pi_plus: 3,
      pi_pp: 3,
      burn: 3,
      corr: 3,
      fat: 3,
      tox: 3,
    });
  });

  it('ignores typed DR on armor pieces not covering a given location', () => {
    const result = aggregateDrByLocation([
      item(2, ['torso'], { typedDr: { cut: 9 } }),
      item(1, ['arm_left']),
    ]);
    // The arm_left piece carries no typed override, so its typed total
    // is just its own base dr.
    expect(result.get('arm_left')?.typedDr.cut).toBe(1);
    expect(result.get('torso')?.typedDr.cut).toBe(9);
  });
});

describe('effective armor and innate DR', () => {
  const effects = resolveEffects(
    [
      {
        id: 'skin',
        name: 'Skin',
        level: 2,
        libraryEffects: [
          { target: 'dr', value: 5, scaling: 'flat' },
          { target: 'dr', value: 2, scaling: 'per_level', hitLocation: 'skull' },
          { target: 'dr', value: 10, scaling: 'flat', conditionGroup: 'shield' },
        ],
      },
    ],
    [],
    new Set(),
  );
  it('applies global and scaled location DR without globalizing skull protection', () => {
    const map = effectiveDrByLocation([], effects);
    expect(map.get('torso')?.dr).toBe(5);
    expect(map.get('skull')?.dr).toBe(11); // global 5 + scoped 4 + natural 2
    expect(resolveDr('cr', map.get('eye'))).toBe(0);
    expect(applyDamage(6, 'cr', 'torso', map, null, 10).injury).toBe(1);
    expect(applyDamage(12, 'cr', 'skull', map, '2', 10).injury).toBe(28);
  });
  it('layers innate DR with per-type armor overrides before a divisor', () => {
    const armor = [item(2, ['torso'], { typedDr: { cut: 4 }, drCrushing: 1 }), item(3, ['torso'])];
    const map = effectiveDrByLocation(armor, effects);
    expect(resolveDr('cut', map.get('torso'))).toBe(12);
    expect(resolveDr('cr', map.get('torso'))).toBe(9);
    expect(applyDamage(14, 'cut', 'torso', map, '2', 10).injury).toBe(12);
    expect(effectiveDrByLocation([...armor].reverse(), effects)).toEqual(map);
  });
  it('supports explicit eye/custom locations and ignores inactive effects', () => {
    const map = effectiveDrByLocation(
      [],
      [
        { target: 'dr', value: 3, active: true, hitLocation: 'eye' },
        { target: 'dr', value: 4, active: true, hitLocation: 'wing' },
        { target: 'dr', value: 10, active: false },
      ],
    );
    expect(map.get('eye')?.dr).toBe(3);
    expect(map.get('wing')?.dr).toBe(4);
    expect(resolveDr('cr', map.get('torso'))).toBe(0);
  });
});

describe('resolveDr', () => {
  it('returns 0 for an uncovered location', () => {
    expect(resolveDr('cut', undefined)).toBe(0);
  });

  it('uses the base dr when no type-specific override exists', () => {
    const entry = aggregateDrByLocation([item(4, ['torso'])]).get('torso');
    expect(resolveDr('cut', entry)).toBe(4);
    expect(resolveDr('imp', entry)).toBe(4);
    expect(resolveDr(null, entry)).toBe(4);
  });

  it('prefers the typed override over the base dr', () => {
    const entry = aggregateDrByLocation([item(4, ['torso'], { typedDr: { cut: 7 } })]).get('torso');
    expect(resolveDr('cut', entry)).toBe(7);
    expect(resolveDr('imp', entry)).toBe(4);
  });

  it('fallback order is typedDr, then drCrushing for cr, then dr', () => {
    const entry = aggregateDrByLocation([
      item(3, ['torso'], { drCrushing: 8, typedDr: { cut: 5 } }),
    ]).get('torso');
    // typedDr wins for cut.
    expect(resolveDr('cut', entry)).toBe(5);
    // cr has no typed key, so drCrushing applies.
    expect(resolveDr('cr', entry)).toBe(8);
    // Other types fall through to dr.
    expect(resolveDr('imp', entry)).toBe(3);
  });

  it('treats a typed override of 0 as a real override (stops nothing)', () => {
    const entry = aggregateDrByLocation([item(4, ['torso'], { typedDr: { cut: 0 } })])?.get(
      'torso',
    );
    expect(resolveDr('cut', entry)).toBe(0);
  });

  it('is case-insensitive and trims the damage type', () => {
    const entry = aggregateDrByLocation([item(4, ['torso'], { typedDr: { imp: 9 } })])?.get(
      'torso',
    );
    expect(resolveDr('IMP', entry)).toBe(9);
    expect(resolveDr('  imp ', entry)).toBe(9);
  });

  it('maps dialog damage-type spellings to typed keys (pi-, pi+, pi++, cor)', () => {
    const entry = aggregateDrByLocation([
      item(4, ['torso'], {
        typedDr: { pi_minus: 1, pi_plus: 2, pi_pp: 3, corr: 6 },
      }),
    ])?.get('torso');
    expect(resolveDr('pi-', entry)).toBe(1);
    expect(resolveDr('pi+', entry)).toBe(2);
    expect(resolveDr('pi++', entry)).toBe(3);
    expect(resolveDr('cor', entry)).toBe(6);
    // Untyped pi falls back to base dr.
    expect(resolveDr('pi', entry)).toBe(4);
  });
});

describe('sumArmorDb', () => {
  it('returns 0 with no equipped armor', () => {
    expect(sumArmorDb([])).toBe(0);
    expect(sumArmorDb([{ equipped: true, isArmor: false, armor: null }])).toBe(0);
  });

  it('sums db across multiple equipped armor pieces', () => {
    const result = sumArmorDb([item(2, ['torso'], { db: 1 }), item(3, ['torso'], { db: 2 })]);
    expect(result).toBe(3);
  });

  it('skips unequipped armor and armor with no db', () => {
    const result = sumArmorDb([
      item(2, ['torso'], { db: 1 }),
      { equipped: false, isArmor: true, armor: item(2, ['torso'], { db: 5 }).armor },
    ]);
    expect(result).toBe(1);
  });

  it('treats db 0 as present (a 0 DB armor addition adds nothing)', () => {
    expect(sumArmorDb([item(2, ['torso'], { db: 0 })])).toBe(0);
  });
});

describe('DR constraints and campaign penetration policy', () => {
  it.each(['2', '3', '5', '10', '100', 'ignore'])(
    'preserves only natural protection against (%s) with the house rule',
    (divisor) => {
      const map = effectiveDrByLocation(
        [item(7, ['skull'], { typedDr: { imp: 9 }, drCrushing: 5 })],
        [{ target: 'dr', value: 3, active: true }],
      );
      const d = divisor === 'ignore' ? Number.POSITIVE_INFINITY : Number(divisor);
      const protectedHit = applyDamage(20, 'imp', 'skull', map, divisor, 30, true);
      expect(protectedHit.effectiveDr).toBe(Math.floor(9 / d) + 5);
      expect(protectedHit.injury).toBe((20 - protectedHit.effectiveDr) * 4);
      expect(applyDamage(20, 'imp', 'skull', map, divisor, 30, false).effectiveDr).toBe(
        Math.floor(14 / d),
      );
      expect(applyDamage(20, 'cr', 'skull', map, divisor, 30, true).effectiveDr).toBe(
        Math.floor(5 / d) + 5,
      );
    },
  );

  it('does not grant natural skull protection against toxic damage', () => {
    const map = effectiveDrByLocation(
      [item(4, ['skull'], { typedDr: { tox: 6 } })],
      [{ target: 'dr', value: 3, active: true }],
    );
    expect(resolveDr('tox', map.get('skull'))).toBe(9);
    expect(applyDamage(12, ' TOX ', 'skull', map, '2', 30, true)).toMatchObject({
      effectiveDr: 6,
      multiplier: 1,
      injury: 6,
    });
    expect(applyDamage(3, 'tox', 'skull', effectiveDrByLocation([]), null, 10).injury).toBe(3);
  });

  it('extends partial torso innate DR to vitals, without applying skull or inactive DR', () => {
    const map = effectiveDrByLocation(
      [],
      [
        { target: 'dr', value: 3, active: true, hitLocation: 'torso' },
        { target: 'dr', value: 1, active: true, hitLocation: 'vitals' },
        { target: 'dr', value: 9, active: false },
      ],
    );
    expect(resolveDr('imp', map.get('vitals'))).toBe(4);
    expect(resolveDr('imp', map.get('torso'))).toBe(3);
    expect(applyDamage(6, 'imp', 'vitals', map, 'ignore', 10, true).injury).toBe(6);
    expect(applyDamage(6, 'imp', 'eye', map, 'ignore', 10, true).injury).toBe(24);
  });

  it('still multiplies all DR for fractional divisors when the house rule is enabled', () => {
    const map = effectiveDrByLocation(
      [item(4, ['skull'])],
      [{ target: 'dr', value: 3, active: true }],
    );
    expect(applyDamage(20, 'cr', 'skull', map, '0.5', 30, true).effectiveDr).toBe(18);
  });
});
