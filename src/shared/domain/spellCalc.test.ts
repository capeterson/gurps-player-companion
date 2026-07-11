import { describe, expect, it } from 'bun:test';
import type { TraitOut } from '../schemas/trait.ts';
import {
  canCastInMana,
  characterCanCast,
  computeSpellLevel,
  costReduction,
  effectiveCastingCost,
  effectiveMaintenanceCost,
  hasMagery,
  isFreeCastingMana,
  mageryLevel,
  manaSkillModifier,
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

  it('falls back to a level embedded in the name when level is null', () => {
    expect(mageryLevel([{ name: 'Magery 3', level: null }])).toBe(3);
    expect(mageryLevel([{ name: 'magery 2 (One College)', level: null }])).toBe(2);
  });

  it('prefers the explicit level column over the name', () => {
    expect(mageryLevel([{ name: 'Magery 3', level: 1 }])).toBe(1);
  });

  it('name without a number still reads as Magery 0', () => {
    expect(mageryLevel([{ name: 'Magery (Dance)', level: null }])).toBe(0);
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
  it('0 points has no level — spells have no default in GURPS', () => {
    expect(computeSpellLevel(0, 12, 3)).toBeNull();
  });

  it('IQ 12, 1 point, Magery 0 → 10 (IQ/H at 1 pt is IQ-2)', () => {
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

  it('Very Hard spells compute one lower than Hard', () => {
    // skillOffset('VH', 1) = -3; 12 - 3 + 1 = 10
    expect(computeSpellLevel(1, 12, 1, 'VH')).toBe(10);
    expect(computeSpellLevel(1, 12, 1, 'H')).toBe(11);
  });

  it('difficulty defaults to Hard', () => {
    expect(computeSpellLevel(4, 14, 2)).toBe(computeSpellLevel(4, 14, 2, 'H'));
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

  it('discounts a 1-point spell to free at skill 15 (B236)', () => {
    expect(effectiveCastingCost(1, 14)).toBe(1);
    expect(effectiveCastingCost(1, 15)).toBe(0);
    expect(effectiveCastingCost(1, 30)).toBe(0);
  });

  it('subtracts the discount, flooring at 0', () => {
    expect(effectiveCastingCost(4, 15)).toBe(3); // -1
    expect(effectiveCastingCost(4, 20)).toBe(2); // -2
    expect(effectiveCastingCost(4, 25)).toBe(1); // -3
    expect(effectiveCastingCost(4, 30)).toBe(0); // -4 → free
    expect(effectiveCastingCost(4, 35)).toBe(0); // -5 → still 0, never negative
  });

  it('passes through unchanged when skill is too low to discount', () => {
    expect(effectiveCastingCost(3, 12)).toBe(3);
  });
});

describe('effectiveMaintenanceCost', () => {
  it('passes null through (spell is not sustainable)', () => {
    expect(effectiveMaintenanceCost(null, 20)).toBeNull();
  });

  it('applies the same skill discount as casting (B236)', () => {
    expect(effectiveMaintenanceCost(2, 14)).toBe(2);
    expect(effectiveMaintenanceCost(2, 15)).toBe(1);
    expect(effectiveMaintenanceCost(2, 20)).toBe(0); // free to maintain
    expect(effectiveMaintenanceCost(2, 30)).toBe(0);
  });

  it('keeps a zero maintenance at zero', () => {
    expect(effectiveMaintenanceCost(0, 10)).toBe(0);
  });
});

describe('mana levels (B235)', () => {
  it('low mana is -5 to skill; every other level is unmodified', () => {
    expect(manaSkillModifier('low')).toBe(-5);
    for (const m of ['none', 'normal', 'high', 'very_high'] as const) {
      expect(manaSkillModifier(m)).toBe(0);
    }
  });

  it('nobody casts in no mana; anyone casts in high+; otherwise Magery gates', () => {
    expect(canCastInMana(true, 'none')).toBe(false);
    expect(canCastInMana(false, 'high')).toBe(true);
    expect(canCastInMana(false, 'very_high')).toBe(true);
    expect(canCastInMana(false, 'normal')).toBe(false);
    expect(canCastInMana(true, 'normal')).toBe(true);
    expect(canCastInMana(false, 'low')).toBe(false);
    expect(canCastInMana(true, 'low')).toBe(true);
  });

  it('only very high mana makes casting free', () => {
    expect(isFreeCastingMana('very_high')).toBe(true);
    expect(isFreeCastingMana('high')).toBe(false);
    expect(isFreeCastingMana('normal')).toBe(false);
  });
});

/** Minimal-but-fully-typed TraitOut fixture — only `name`/`level` matter here. */
function makeTrait(name: string, level: number | null = null): TraitOut {
  return {
    id: 'trait-1',
    characterId: 'char-1',
    kind: 'advantage',
    name,
    points: 0,
    level,
    variantName: null,
    notes: null,
    modifiers: [],
    libraryTraitId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('characterCanCast', () => {
  it('holds casting entirely while manaLevelKnown is false, even in high mana', () => {
    expect(characterCanCast({ traits: [], manaLevel: 'high', manaLevelKnown: false })).toBe(false);
  });

  it('delegates to canCastInMana + hasMagery once manaLevelKnown is true', () => {
    expect(characterCanCast({ traits: [], manaLevel: 'normal', manaLevelKnown: true })).toBe(false);
    expect(
      characterCanCast({
        traits: [makeTrait('Magery')],
        manaLevel: 'normal',
        manaLevelKnown: true,
      }),
    ).toBe(true);
    expect(characterCanCast({ traits: [], manaLevel: 'high', manaLevelKnown: true })).toBe(true);
    expect(characterCanCast({ traits: [], manaLevel: 'none', manaLevelKnown: true })).toBe(false);
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
