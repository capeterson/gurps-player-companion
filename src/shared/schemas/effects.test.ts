import { describe, expect, it } from 'bun:test';
import { libraryTraitEffect, traitEffect } from './effects.ts';

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
