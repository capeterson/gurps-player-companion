import { describe, expect, it } from 'bun:test';
import { aggregateDrByLocation, resolveDr, sumArmorDb } from './armorDr.ts';
import type { ArmorItemRow } from './armorDr.ts';

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
    expect(result.get('torso')?.drCrushing).toBe(5);
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
