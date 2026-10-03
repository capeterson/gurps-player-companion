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
  worn: true,
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
          spellLevel: 15,
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
    expect(persisted.damage).toBe('1d+1 cut');
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
          spellLevel: 15,
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
    expect(result.armor).toMatchObject({ dr: 6, typedDr: { cut: 8 }, db: 1 });
    expect(
      result.breakdown.some((line) => line.target === 'db' && line.value === 1 && line.active),
    ).toBe(true);
    expect(result.weightReductionPercent).toBe(30);
  });

  it('only applies Lighten to equipped armor or shields and disables skill effects until equipped', () => {
    const result = resolveItemEnchantments({
      ...base,
      worn: true,
      equipped: false,
      weightReductionPercent: 5,
      enchantments: [
        {
          spellName: 'Burden-Bearing Charm',
          spellLevel: 15,
          mechanics: {
            applicability: 'any',
            effects: [
              { target: 'weight_reduction_percent', value: 20 },
              { target: 'skill', skillName: 'Hiking', value: 2 },
            ],
            levels: [],
            stackingPolicy: { kind: 'stack' },
          },
        },
      ],
    });

    expect(result.weightReductionPercent).toBe(5);
    expect(result.effects).toEqual([]);
    expect(result.breakdown).toMatchObject([
      { target: 'weight_reduction_percent', active: false },
      { target: 'skill', active: false },
    ]);

    const equipped = resolveItemEnchantments({
      ...base,
      worn: true,
      equipped: true,
      enchantments: [
        {
          spellName: 'Burden-Bearing Charm',
          spellLevel: 15,
          mechanics: {
            applicability: 'any',
            effects: [{ target: 'skill', skillName: 'Hiking', value: 2 }],
            levels: [],
            stackingPolicy: { kind: 'stack' },
          },
        },
      ],
    });
    expect(equipped.effects).toMatchObject([{ target: 'skill', skillName: 'Hiking', value: 2 }]);
  });

  it('keeps stashed equipped armor and weapons physically present but suppresses their skill effects', () => {
    const mechanics = {
      applicability: 'any' as const,
      effects: [{ target: 'skill' as const, skillName: 'Broadsword', value: 2 }],
      levels: [],
      stackingPolicy: { kind: 'stack' as const },
    };
    const stashed = resolveItemEnchantments({
      ...base,
      worn: false,
      equipped: true,
      weaponData: weaponData.parse({ damage: 'sw cut' }),
      enchantments: [{ spellName: 'Skill', spellLevel: 15, mechanics }],
    });
    expect(stashed.weaponData?.damage).toBe('sw cut');
    expect(stashed.effects).toEqual([]);
    expect(stashed.breakdown).toMatchObject([
      { target: 'skill', active: false, inactiveReason: 'Item is not equipped or available' },
    ]);
  });

  it('keeps inactive mechanics visible in the breakdown without applying them', () => {
    const result = resolveItemEnchantments({
      ...base,
      weaponData: weaponData.parse({ damage: '1d cut' }),
      enchantments: [
        {
          spellName: 'Dormant Edge',
          spellLevel: 15,
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
        { spellName: 'Fortify I', spellLevel: 15, mechanics: mechanics(1) },
        { spellName: 'Fortify III', spellLevel: 15, mechanics: mechanics(3) },
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

  it('keeps Deflect DB as an independent active contribution without changing physical shield data', () => {
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
      enchantments: [{ spellName: 'Deflect', spellLevel: 15, mechanics }],
    });
    expect(sword.weaponData?.db).toBeUndefined();
    expect(sword.breakdown).toMatchObject([{ target: 'db', value: 5, active: true }]);
    const shield = resolveItemEnchantments({
      ...base,
      equipped: true,
      weaponData: weaponData.parse({ db: 0 }),
      enchantments: [{ spellName: 'Deflect', spellLevel: 15, mechanics }],
    });
    expect(shield.weaponData?.db).toBe(0);
    expect(effectiveWeaponData.parse(shield.weaponData).db).toBe(0);
    expect(shield.breakdown).toMatchObject([{ target: 'db', value: 5, active: true }]);
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
          spellLevel: 15,
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
    expect(result.armor).toMatchObject({ dr: 1001, db: 2 });
    expect(
      result.breakdown.some((line) => line.target === 'db' && line.value === 3 && line.active),
    ).toBe(true);
    expect(effectiveArmorData.parse(result.armor)).toMatchObject({ dr: 1001, db: 2 });
  });

  it('gates item spell effects by Power and campaign mana with an explicit unknown-Power reason', () => {
    const mechanics = {
      applicability: 'armor' as const,
      effects: [{ target: 'dr' as const, value: 1 }],
      levels: [],
      stackingPolicy: { kind: 'stack' as const },
    };
    const item = (spellLevel?: number | null) => ({
      ...base,
      equipped: true,
      isArmor: true,
      armor: armorData.parse({ locations: ['torso'], dr: 4 }),
      enchantments: [
        { spellName: 'Fortify', ...(spellLevel === undefined ? {} : { spellLevel }), mechanics },
      ],
    });
    const ordinary = resolveItemEnchantments(item(15), 'normal');
    expect(ordinary.armor?.dr).toBe(5);
    expect(ordinary.breakdown[0]).toMatchObject({ active: true });

    const lowMana = resolveItemEnchantments(item(15), 'low');
    expect(lowMana.armor?.dr).toBe(4);
    expect(lowMana.breakdown[0]).toMatchObject({
      active: false,
      inactiveReason: expect.stringContaining('Power'),
    });
    const lowManaPower20 = resolveItemEnchantments(item(20), 'low');
    expect(lowManaPower20.armor?.dr).toBe(5);

    const noMana = resolveItemEnchantments(item(30), 'none');
    expect(noMana.armor?.dr).toBe(4);
    expect(noMana.breakdown[0]).toMatchObject({
      active: false,
      inactiveReason: expect.stringContaining('No mana'),
    });

    const unknownPower = resolveItemEnchantments(item(null), 'normal');
    expect(unknownPower.armor?.dr).toBe(4);
    expect(unknownPower.breakdown[0]).toMatchObject({
      active: false,
      inactiveReason: expect.stringContaining('unrecorded'),
    });
  });
});
