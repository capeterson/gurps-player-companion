import { describe, expect, it } from 'bun:test';
import {
  type ArmorData,
  armorData,
  effectiveArmorData,
  effectiveWeaponData,
  weaponData,
} from '../schemas/inventory.ts';
import { resolveItemEnchantments } from './itemEnchantments.ts';

const base = {
  id: 'item-1',
  name: 'Test item',
  worn: false,
  equipped: false,
  isArmor: false,
  armor: null,
  weaponData: null,
  weightReductionPercent: 0,
  enchantments: [],
};

describe('resolveItemEnchantments', () => {
  it('preserves legacy note-only enchantments without mechanical changes', () => {
    const result = resolveItemEnchantments({
      ...base,
      enchantments: [{ spellName: 'Cornucopia', notes: 'Legacy record' }],
    });
    expect(result.effects).toEqual([]);
    expect(result.breakdown).toEqual([]);
  });

  it('emits equipped weapon modifiers once and keeps the persisted base block intact', () => {
    const persisted = weaponData.parse({ damage: '1d+1 cut', ranged: { acc: 2 } });
    const result = resolveItemEnchantments({
      ...base,
      equipped: true,
      weaponData: persisted,
      enchantments: [
        {
          spellName: 'Keen Edge',
          mechanics: {
            applicability: 'weapon',
            effects: [
              { target: 'weapon_attack', value: 1 },
              { target: 'weapon_accuracy', value: 2 },
              { target: 'weapon_damage', value: 3 },
              { target: 'armor_divisor', value: 2 },
            ],
            levels: [],
            stackingPolicy: { kind: 'stack' },
          },
        },
      ],
    });

    expect(result.weaponData).toEqual(persisted);
    expect(result.weaponData).not.toBe(persisted);
    expect(result.effects.map(({ target, value }) => ({ target, value }))).toEqual([
      { target: 'weapon_attack', value: 1 },
      { target: 'weapon_accuracy', value: 2 },
      { target: 'weapon_damage', value: 3 },
    ]);
    expect(result.armorDivisor).toBe(2);
  });

  it('applies worn armor DR/DB and weight effects, including a selected level', () => {
    const result = resolveItemEnchantments({
      ...base,
      worn: true,
      equipped: true,
      isArmor: true,
      armor: armorData.parse({ dr: 3, typedDr: { cut: 5 }, db: 1 }),
      weightReductionPercent: 10,
      enchantments: [
        {
          spellName: 'Fortified',
          level: 2,
          mechanics: {
            applicability: 'armor',
            effects: [
              { target: 'dr', value: 1 },
              { target: 'db', value: 1 },
              { target: 'weight_reduction_percent', value: 20 },
            ],
            levels: [{ level: 2, effects: [{ target: 'dr', value: 2 }] }],
            stackingPolicy: { kind: 'stack' },
          },
        },
      ],
    });
    expect(result.armor).toMatchObject({ dr: 6, typedDr: { cut: 8 }, db: 2 });
    expect(result.weightReductionPercent).toBe(30);
  });

  it('keeps inactive mechanics visible in the breakdown without applying them', () => {
    const result = resolveItemEnchantments({
      ...base,
      weaponData: weaponData.parse({ damage: '1d cut' }),
      enchantments: [
        {
          spellName: 'Dormant Edge',
          mechanics: {
            applicability: 'weapon',
            effects: [{ target: 'weapon_attack', value: 5 }],
            levels: [],
            stackingPolicy: { kind: 'stack' },
          },
        },
      ],
    });
    expect(result.effects).toEqual([]);
    expect(result.breakdown).toMatchObject([{ active: false, suppressedByStacking: false }]);
  });

  it('uses only the highest value for effects sharing a highest-only stacking key', () => {
    const mechanics = (value: number) => ({
      applicability: 'armor' as const,
      effects: [{ target: 'dr' as const, value }],
      levels: [],
      stackingPolicy: { kind: 'highest' as const, key: 'fortify' },
    });
    const result = resolveItemEnchantments({
      ...base,
      worn: true,
      equipped: true,
      isArmor: true,
      armor: armorData.parse({ dr: 2 }),
      enchantments: [
        { spellName: 'Fortify I', mechanics: mechanics(1) },
        { spellName: 'Fortify III', mechanics: mechanics(3) },
      ],
    });
    expect(result.armor?.dr).toBe(5);
    expect(result.breakdown.map((entry) => entry.suppressedByStacking)).toEqual([true, false]);
  });

  it('normalizes legacy armor that predates typed DR', () => {
    const result = resolveItemEnchantments({
      ...base,
      equipped: true,
      isArmor: true,
      armor: {
        locations: ['torso'],
        dr: 3,
        flexible: false,
        frontOnly: false,
        backOnly: false,
      } as ArmorData,
    });
    expect(result.armor).toMatchObject({ dr: 3, typedDr: {} });
  });

  it('does not turn an ordinary weapon into a shield, but boosts an existing shield', () => {
    const mechanics = {
      applicability: 'any' as const,
      effects: [{ target: 'db' as const, value: 5 }],
      levels: [],
      stackingPolicy: { kind: 'stack' as const },
    };
    const sword = resolveItemEnchantments({
      ...base,
      equipped: true,
      weaponData: weaponData.parse({ damage: '1d cut' }),
      enchantments: [{ spellName: 'Deflect', mechanics }],
    });
    expect(sword.weaponData?.db).toBeUndefined();
    const shield = resolveItemEnchantments({
      ...base,
      equipped: true,
      weaponData: weaponData.parse({ db: 0 }),
      enchantments: [{ spellName: 'Deflect', mechanics }],
    });
    expect(shield.weaponData?.db).toBe(5);
    expect(effectiveWeaponData.parse(shield.weaponData).db).toBe(5);
  });

  it('allows valid base-plus-effect totals beyond persistence authoring caps', () => {
    const result = resolveItemEnchantments({
      ...base,
      equipped: true,
      isArmor: true,
      armor: armorData.parse({ dr: 1000, db: 2 }),
      enchantments: [
        {
          spellName: 'Greater Fortify',
          mechanics: {
            applicability: 'armor',
            effects: [
              { target: 'dr', value: 1 },
              { target: 'db', value: 3 },
            ],
            levels: [],
            stackingPolicy: { kind: 'stack' },
          },
        },
      ],
    });
    expect(result.armor).toMatchObject({ dr: 1001, db: 5 });
    expect(effectiveArmorData.parse(result.armor)).toMatchObject({ dr: 1001, db: 5 });
  });
});
