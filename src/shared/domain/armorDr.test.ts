import { describe, expect, it } from 'bun:test';
import {
  aggregateDrByLocation,
  armorLayerStacks,
  armorLayering,
  describeArmorLayerStacks,
  effectiveDrByLocation,
  layeredArmorDrContributions,
  resolveArmorDb,
  resolveDr,
} from './armorDr.ts';
import type { ArmorItemRow } from './armorDr.ts';
import { applyDamage } from './injuryCalc.ts';
import { resolveItemEnchantments } from './itemEnchantments.ts';
import { resolveEffects } from './traitEffects.ts';

function item(
  dr: number,
  locations: string[],
  opts: Partial<ArmorItemRow['armor']> = {},
): ArmorItemRow {
  return {
    id: `armor-${dr}-${locations.join('-')}`,
    name: `Armor ${dr}`,
    worn: true,
    quantity: 1,
    equipped: true,
    isArmor: true,
    armor: {
      locations,
      dr,
      drCrushing: null,
      typedDr: {},
      flexible: true,
      concealable: true,
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
    ]);
    expect(resolveDr('imp', map.get('vitals'))).toBe(9);
    expect(resolveDr('imp', map.get('torso'))).toBe(9);
    expect(applyDamage(12, 'imp', 'vitals', map, '2', 10).injury).toBe(24);
  });
  it('sums DR across equipped armor covering the same location', () => {
    const result = aggregateDrByLocation([item(2, ['torso']), item(3, ['torso', 'arm_left'])]);
    expect(result.get('torso')?.dr).toBe(5);
    expect(result.get('arm_left')?.dr).toBe(3);
  });

  it('excludes stashed and zero-quantity armor even when the row remains equipped', () => {
    const carried = { ...item(2, ['torso']), worn: true, quantity: 1 };
    const stashed = { ...item(8, ['torso']), id: 'stashed', worn: false, quantity: 1 };
    const depleted = { ...item(5, ['torso']), id: 'depleted', worn: true, quantity: 0 };
    expect(aggregateDrByLocation([carried, stashed, depleted]).get('torso')?.dr).toBe(2);
  });

  it('allows one rigid outer layer over one flexible concealable inner layer and applies DX penalty', () => {
    const outer = item(4, ['torso'], { flexible: false });
    const inner = item(2, ['torso'], { flexible: true, concealable: true });
    const result = armorLayering([outer, inner]);
    expect(result).toEqual({ dxPenalty: 1, invalidLocations: [] });
    expect(aggregateDrByLocation([outer, inner]).get('torso')?.dr).toBe(6);
  });

  it('flags illegal rigid overlap and excludes DR at the invalid location', () => {
    const layers = [
      item(4, ['torso'], { flexible: false }),
      item(3, ['torso'], { flexible: false }),
    ];
    expect(armorLayering(layers).invalidLocations).toContain('torso');
    expect(aggregateDrByLocation(layers).has('torso')).toBe(false);
  });

  it('flags a third layer and does not penalize valid head layering', () => {
    const threeTorsoLayers = [
      item(4, ['torso'], { flexible: false }),
      item(3, ['torso'], { flexible: true, concealable: true }),
      item(2, ['torso']),
    ];
    expect(armorLayering(threeTorsoLayers).invalidLocations).toContain('torso');
    const headLayers = [
      item(4, ['skull']),
      item(2, ['skull'], { flexible: true, concealable: true }),
    ];
    expect(armorLayering(headLayers)).toEqual({ dxPenalty: 0, invalidLocations: [] });
  });

  it('names the conflicting layers, groups independent conflicts, and explains three-layer stacks', () => {
    const layers = [
      { ...item(4, ['torso'], { flexible: false }), id: 'vest', name: 'Brigandine vest' },
      { ...item(3, ['torso'], { flexible: false }), id: 'shirt', name: 'Mail shirt' },
      { ...item(2, ['arm_left'], { flexible: false }), id: 'vambrace', name: 'Iron vambrace' },
      { ...item(1, ['arm_left'], { flexible: false }), id: 'sleeve', name: 'Padded sleeve' },
      { ...item(1, ['leg_right'], { flexible: false }), id: 'greave', name: 'Right greave' },
      { ...item(1, ['leg_right'], { flexible: false }), id: 'hose', name: 'Wool hose' },
      { ...item(1, ['eye'], { flexible: false }), id: 'visor', name: 'Eye visor' },
      { ...item(1, ['eye'], { flexible: false }), id: 'goggle', name: 'Goggles' },
      { ...item(1, ['tail_feathers'], { flexible: false }), id: 'tail1', name: 'Tail guard' },
      { ...item(1, ['tail_feathers'], { flexible: false }), id: 'tail2', name: 'Tail wrap' },
    ];
    const descriptions = describeArmorLayerStacks(
      armorLayerStacks(layers).filter((stack) => stack.invalid),
    );
    expect(descriptions).toContain(
      '“Brigandine vest”, “Mail shirt” at Torso, Vitals: an inner layer must be flexible and concealable.',
    );
    expect(descriptions).toContain(
      '“Iron vambrace”, “Padded sleeve” at Left Arm: an inner layer must be flexible and concealable.',
    );
    expect(descriptions).toContain(
      '“Right greave”, “Wool hose” at Right Leg: an inner layer must be flexible and concealable.',
    );
    expect(descriptions).toContain(
      '“Eye visor”, “Goggles” at Eyes: an inner layer must be flexible and concealable.',
    );
    expect(descriptions).toContain(
      '“Tail guard”, “Tail wrap” at Tail Feathers: an inner layer must be flexible and concealable.',
    );

    const threeLayers = [
      { ...item(4, ['torso'], { flexible: false }), id: 'outer', name: 'Outer plate' },
      { ...item(3, ['torso'], { flexible: true, concealable: true }), id: 'middle', name: 'Mail' },
      {
        ...item(2, ['torso'], { flexible: true, concealable: true }),
        id: 'inner',
        name: 'Gambeson',
      },
    ];
    expect(
      describeArmorLayerStacks(armorLayerStacks(threeLayers).filter((stack) => stack.invalid)),
    ).toContain(
      '“Outer plate”, “Mail”, “Gambeson” at Torso, Vitals: at most two layers may overlap.',
    );
  });

  it('does not combine disjoint facings or unavailable inventory into a conflict', () => {
    const front = {
      ...item(4, ['torso'], { frontOnly: true, flexible: false }),
      id: 'front',
      name: 'Front plate',
    };
    const back = {
      ...item(3, ['torso'], { backOnly: true, flexible: false }),
      id: 'back',
      name: 'Back plate',
    };
    const stashed = {
      ...item(9, ['torso'], { flexible: false }),
      id: 'stashed',
      name: 'Stashed plate',
      worn: false,
    };
    const depleted = {
      ...item(7, ['torso'], { flexible: false }),
      id: 'depleted',
      name: 'Broken plate',
      quantity: 0,
    };
    const unequipped = {
      ...item(6, ['torso'], { flexible: false }),
      id: 'unequipped',
      name: 'Loose plate',
      equipped: false,
    };

    expect(armorLayering([front, back]).invalidLocations).toEqual([]);
    expect(
      armorLayering([front, back, stashed, depleted, unequipped], 'front').invalidLocations,
    ).toEqual([]);
    expect(
      armorLayering([front, back, stashed, depleted, unequipped], 'back').invalidLocations,
    ).toEqual([]);
    expect(
      aggregateDrByLocation([front, back, stashed, depleted, unequipped], 'front').get('torso')?.dr,
    ).toBe(4);
    expect(
      aggregateDrByLocation([front, back, stashed, depleted, unequipped], 'back').get('torso')?.dr,
    ).toBe(3);
  });

  it('filters directional DR for front, back, and side facings', () => {
    const layers = [
      item(2, ['torso'], { frontOnly: true, flexible: false }),
      item(3, ['torso'], { backOnly: true, flexible: false }),
      item(4, ['torso'], { flexible: true, concealable: true }),
    ];

    expect(aggregateDrByLocation(layers, 'front').get('torso')?.dr).toBe(6);
    expect(aggregateDrByLocation(layers, 'back').get('torso')?.dr).toBe(7);
    expect(aggregateDrByLocation(layers, 'left').get('torso')?.dr).toBe(4);
    expect(aggregateDrByLocation(layers, 'right').get('torso')?.dr).toBe(4);
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

  it('applies the highest Fortify once per covered location across armor layers', () => {
    const coif = {
      ...item(7, ['skull'], { drCrushing: 7, typedDr: { cut: 5 } }),
      id: 'coif',
      name: 'Coif',
      baseArmor: item(4, ['skull'], { drCrushing: 4, typedDr: { cut: 2 } }).armor,
      enchantmentBreakdown: [
        {
          sourceName: 'Coif: Fortify',
          target: 'dr' as const,
          value: 3,
          active: true,
          stackingKey: 'fortify',
          suppressedByStacking: false,
        },
      ],
    };
    const hat = {
      ...item(5, ['skull']),
      id: 'hat',
      name: 'Hat',
      baseArmor: item(2, ['skull']).armor,
      enchantmentBreakdown: [
        {
          sourceName: 'Hat: Fortify',
          target: 'dr' as const,
          value: 3,
          active: true,
          stackingKey: 'fortify',
          suppressedByStacking: false,
        },
      ],
    };
    const boots = {
      ...item(5, ['foot_left']),
      id: 'boots',
      name: 'Boots',
      baseArmor: item(3, ['foot_left']).armor,
      enchantmentBreakdown: [
        {
          sourceName: 'Boots: Fortify',
          target: 'dr' as const,
          value: 2,
          active: true,
          stackingKey: 'fortify',
          suppressedByStacking: false,
        },
      ],
    };

    const map = aggregateDrByLocation([hat, boots, coif]);
    expect(map.get('skull')).toMatchObject({ dr: 9, drCrushing: 9 });
    expect(map.get('skull')?.typedDr.cut).toBe(7);
    expect(map.get('foot_left')?.dr).toBe(5);
    expect(aggregateDrByLocation([coif, boots, hat])).toEqual(map);
    expect(layeredArmorDrContributions([hat, coif], 'skull')).toMatchObject([
      { sourceName: 'Hat: Fortify', status: 'suppressed', winnerName: 'Coif: Fortify' },
      { sourceName: 'Coif: Fortify', status: 'winning' },
    ]);
  });

  it('does not let a higher inactive Fortify suppress an equipped layer', () => {
    const active = {
      ...item(3, ['torso']),
      baseArmor: item(1, ['torso']).armor,
      enchantmentBreakdown: [
        {
          sourceName: 'Active: Fortify',
          target: 'dr' as const,
          value: 2,
          active: true,
          stackingKey: 'fortify',
          suppressedByStacking: false,
        },
      ],
    };
    const inactive = {
      ...item(6, ['torso']),
      id: 'inactive',
      baseArmor: item(1, ['torso']).armor,
      enchantmentBreakdown: [
        {
          sourceName: 'Inactive: Fortify',
          target: 'dr' as const,
          value: 5,
          active: false,
          stackingKey: 'fortify',
          suppressedByStacking: false,
        },
      ],
    };

    expect(aggregateDrByLocation([active, inactive]).get('torso')?.dr).toBe(4);
  });

  it('preserves item-local suppression for duplicate highest-only enchantments', () => {
    const baseArmor = item(2, ['torso']).armor;
    if (!baseArmor) throw new Error('missing armor fixture');
    const mechanics = {
      applicability: 'armor' as const,
      effects: [{ target: 'dr' as const, value: 3 }],
      levels: [],
      stackingPolicy: { kind: 'highest' as const, key: 'fortify' },
    };
    const resolved = resolveItemEnchantments({
      id: 'duplicate-fortify',
      name: 'Duplicate Fortify',
      worn: true,
      equipped: true,
      isArmor: true,
      armor: baseArmor,
      weaponData: null,
      weightReductionPercent: 0,
      enchantments: [
        { spellName: 'Fortify', spellLevel: 15, mechanics },
        { spellName: 'Fortify', spellLevel: 15, mechanics },
      ],
    });

    expect(resolved.armor?.dr).toBe(5);
    expect(
      aggregateDrByLocation([
        {
          id: 'duplicate-fortify',
          name: 'Duplicate Fortify',
          equipped: true,
          isArmor: true,
          armor: resolved.armor,
          baseArmor,
          enchantmentBreakdown: resolved.breakdown,
        },
      ]).get('torso')?.dr,
    ).toBe(5);
  });

  it('keeps effective armor when a partial payload has no enchantment breakdown', () => {
    const effective = item(5, ['torso']);
    const partial = {
      ...effective,
      baseArmor: item(2, ['torso']).armor,
    };

    expect(aggregateDrByLocation([partial]).get('torso')?.dr).toBe(5);
  });

  it('does not call an undecomposable legacy layer suppressed by a current layer', () => {
    const legacy = {
      ...item(6, ['torso']),
      id: 'legacy',
      name: 'Legacy armor',
      enchantmentBreakdown: [
        {
          sourceName: 'Legacy armor: Fortify',
          target: 'dr' as const,
          value: 5,
          active: true,
          stackingKey: 'fortify',
          suppressedByStacking: false,
        },
      ],
    };
    const current = {
      ...item(4, ['torso']),
      id: 'current',
      name: 'Current armor',
      baseArmor: item(1, ['torso']).armor,
      enchantmentBreakdown: [
        {
          sourceName: 'Current armor: Fortify',
          target: 'dr' as const,
          value: 3,
          active: true,
          stackingKey: 'fortify',
          suppressedByStacking: false,
        },
      ],
    };

    expect(layeredArmorDrContributions([legacy, current], 'torso')).toMatchObject([
      { sourceName: 'Legacy armor: Fortify', status: 'applied' },
      { sourceName: 'Current armor: Fortify', status: 'applied' },
    ]);
    expect(aggregateDrByLocation([legacy, current]).get('torso')?.dr).toBe(10);
  });

  it('retains item-local suppression labels on an undecomposable legacy layer', () => {
    const legacy = {
      ...item(5, ['torso']),
      id: 'legacy-duplicates',
      name: 'Legacy duplicates',
      enchantmentBreakdown: [
        {
          sourceName: 'Legacy duplicates: Fortify I',
          target: 'dr' as const,
          value: 1,
          active: true,
          stackingKey: 'fortify',
          suppressedByStacking: true,
        },
        {
          sourceName: 'Legacy duplicates: Fortify III',
          target: 'dr' as const,
          value: 3,
          active: true,
          stackingKey: 'fortify',
          suppressedByStacking: false,
        },
      ],
    };

    expect(layeredArmorDrContributions([legacy], 'torso')).toMatchObject([
      {
        sourceName: 'Legacy duplicates: Fortify I',
        status: 'suppressed',
        winnerName: 'Legacy duplicates: Fortify III',
      },
      { sourceName: 'Legacy duplicates: Fortify III', status: 'applied' },
    ]);
    expect(aggregateDrByLocation([legacy]).get('torso')?.dr).toBe(5);
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

describe('resolveArmorDb', () => {
  it('returns no source with no covering equipped armor', () => {
    expect(resolveArmorDb([], 'torso')).toBeNull();
    expect(resolveArmorDb([{ equipped: true, isArmor: false, armor: null }], 'torso')).toBeNull();
  });

  it('uses the highest equipped armor DB once, independently of location', () => {
    const torso1 = item(2, ['torso'], { db: 1 });
    const torso3 = { ...item(3, ['torso'], { db: 3 }), id: 'torso-3', name: 'Deflect Plate' };
    const head2 = { ...item(1, ['skull'], { db: 2 }), id: 'head-2', name: 'Deflect Helm' };
    expect(resolveArmorDb([torso1, torso3, head2], 'torso')).toEqual({
      db: 3,
      itemId: 'torso-3',
      itemName: 'Deflect Plate',
    });
    expect(resolveArmorDb([torso1, torso3, head2], 'skull')?.db).toBe(3);
  });

  it('skips stashed, unequipped, zero-quantity, non-armor, and zero DB items', () => {
    const result = resolveArmorDb(
      [
        item(2, ['torso'], { db: 1 }),
        { equipped: false, isArmor: true, armor: item(2, ['torso'], { db: 5 }).armor },
        { ...item(2, ['skull'], { db: 8 }), id: 'stashed', worn: false },
        { ...item(2, ['skull'], { db: 7 }), id: 'zero', quantity: 0 },
        { equipped: true, isArmor: false, armor: item(2, ['skull'], { db: 6 }).armor },
        item(2, ['torso'], { db: 0 }),
      ],
      'torso',
    );
    expect(result?.db).toBe(1);
  });

  it('ignores hit location/facing and deterministically breaks equal maxima', () => {
    const back = { ...item(2, ['torso'], { db: 3, backOnly: true }), id: 'b', name: 'Back' };
    const frontZ = { ...item(2, ['torso'], { db: 3, frontOnly: true }), id: 'z', name: 'Front Z' };
    const frontA = { ...item(2, ['torso'], { db: 3, frontOnly: true }), id: 'a', name: 'Front A' };
    for (const facing of ['front', 'back', 'left', 'right'] as const) {
      expect(resolveArmorDb([frontZ, back, frontA], 'torso', facing)?.itemId).toBe('a');
    }
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
