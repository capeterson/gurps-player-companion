import { describe, expect, it } from 'bun:test';
import { fixedCalculation } from '../domain/calculation.ts';
import { libraryTraitEffect, traitEffect } from './effects.ts';
import { libraryTraitModifier, traitModifier } from './trait.ts';

describe('traitEffect weapon selectors', () => {
  it('keeps legacy effects backward compatible', () => {
    expect(traitEffect.parse({ target: 'dx', value: 1 })).toEqual({
      target: 'dx',
      value: 1,
      scaling: 'flat',
    });
  });

  it('requires selectors only for weapon targets', () => {
    expect(
      traitEffect.safeParse({ target: 'weapon_attack', value: 1, scaling: 'flat' }).success,
    ).toBe(false);
    expect(
      traitEffect.safeParse({
        target: 'dx',
        value: 1,
        scaling: 'flat',
        weaponSelector: { kind: 'weapon_name', weaponName: 'Broadsword' },
      }).success,
    ).toBe(false);
  });

  it('accepts exact item ids for owned mechanics but rejects them in portable definitions', () => {
    const effect = {
      target: 'weapon_parry',
      value: 1,
      scaling: 'flat',
      weaponSelector: {
        kind: 'inventory_item',
        inventoryItemId: '11111111-1111-4111-8111-111111111111',
      },
    } as const;
    expect(traitEffect.safeParse(effect).success).toBe(true);
    expect(libraryTraitEffect.safeParse(effect).success).toBe(false);
  });

  it('rejects mode restrictions for item-level Parry and Block', () => {
    for (const target of ['weapon_parry', 'weapon_block'] as const) {
      expect(
        traitEffect.safeParse({
          target,
          value: 1,
          scaling: 'flat',
          weaponSelector: { kind: 'weapon_name', weaponName: 'Shield', modeName: 'Bash' },
        }).success,
      ).toBe(false);
    }
  });
});

describe('trait modifier cost requirements', () => {
  const base = { name: 'Accurate', category: 'enhancement', costType: 'percent' } as const;

  it('rejects an omitted fixed cost when no calculation rule is provided', () => {
    expect(traitModifier.safeParse(base).success).toBe(false);
    expect(libraryTraitModifier.safeParse(base).success).toBe(false);
  });

  it('accepts a calculation without a redundant fixed cost and supplies compatibility zero', () => {
    const calculation = fixedCalculation({ modifier: { value: 10, unit: 'percentage' } });
    expect(libraryTraitModifier.parse({ ...base, calculation })).toMatchObject({
      costValue: 0,
      calculation,
    });
  });
});
