import { describe, expect, it } from 'bun:test';
import { activeEffectDefinitionCreate } from '../schemas/activeEffects.ts';
import { type LibraryYamlDoc, libraryTraitCreate } from '../schemas/campaignLibrary.ts';
import { characterCreate } from '../schemas/character.ts';
import { libraryRaceOut } from '../schemas/race.ts';
import { emitLibraryYaml, parseLibraryYaml } from '../yaml/library.ts';
import { instantiateEffect } from './activeEffects.ts';
import { aggregateDrByLocation } from './armorDr.ts';
import {
  type CharacterDetailInput,
  buildCharacterDetail,
  buildSpellOut,
} from './characterDetail.ts';
import { pickShield, resolveWeaponSkill, skillDisplayName } from './defenseCalc.ts';
import { resolveRaceSelection } from './race.ts';
import { characterCanCast, characterMagicTraits, hasMagery } from './spellCalc.ts';

it('disables campaign active effects and conditional modifiers by default while keeping manual boosts', () => {
  const timestamp = '2026-09-10T00:00:00.000Z';
  const activeDefinition = activeEffectDefinitionCreate.parse({
    name: 'Battle draught',
    stacking: { kind: 'additive', key: 'battle-draught' },
    effects: [
      {
        target: 'st',
        value: 2,
        conditionGroup: 'focused',
        conditionLabel: 'Focused',
      },
    ],
    capabilities: [{ kind: 'sense', key: 'true_sight', label: 'True Sight' }],
  });
  const instance = instantiateEffect(activeDefinition, 'active-instance', timestamp);
  const campaign = {
    pointTarget: null,
    disadvantageCap: null,
    quirkCap: null,
    experimentalActiveEffects: false,
  };
  const input: CharacterDetailInput = {
    character: {
      ...characterCreate.parse({
        name: 'Gated hero',
        tempEffects: [{ id: 'manual', name: 'Manual boost', mods: { st: 5 } }],
      }),
      id: 'character',
      ownerId: 'owner',
      campaignId: 'campaign',
      height: null,
      weight: null,
      age: null,
      birthdate: null,
      appearance: null,
      dismissedWarnings: [],
      activeEffects: [instance],
      activeConditionGroups: ['focused'],
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    traits: [
      {
        id: 'trait',
        characterId: 'character',
        name: 'Focused stance',
        kind: 'advantage',
        points: 1,
        level: 1,
        notes: null,
        libraryTraitId: null,
        modifiers: [],
        libraryEffects: [
          {
            target: 'st',
            value: 2,
            scaling: 'flat',
            conditionGroup: 'focused',
            conditionLabel: 'Focused',
          },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    skills: [],
    spells: [],
    languages: [],
    techniques: [],
    inventory: [],
    combat: null,
    campaign,
  };

  const disabled = buildCharacterDetail(input);
  expect(disabled.derived.effectiveSt).toBe(15);
  expect(disabled.activeEffects).toHaveLength(1);
  expect(disabled.capabilities).toEqual([]);

  const enabled = buildCharacterDetail({
    ...input,
    campaign: { ...campaign, experimentalActiveEffects: true },
  });
  expect(enabled.derived.effectiveSt).toBe(19);
  expect(enabled.capabilities[0]?.capability.label).toBe('True Sight');

  const disabledAgain = buildCharacterDetail({
    ...input,
    campaign: { ...campaign, experimentalActiveEffects: false },
  });
  expect(disabledAgain.derived.effectiveSt).toBe(15);
  expect(disabledAgain.activeEffects).toHaveLength(1);
});

it('carries YAML damage declarations through the full character builder', () => {
  const library = parseLibraryYaml(
    emitLibraryYaml({
      traits: [
        libraryTraitCreate.parse({
          name: 'Striking',
          kind: 'advantage',
          effects: [
            { target: 'damage_thrust', value: 1 },
            { target: 'damage_swing', value: 2 },
          ],
        }) as unknown as LibraryYamlDoc['library']['traits'][number],
      ],
      skills: [],
      spells: [],
      items: [],
      languages: [],
      techniques: [],
      styles: [],
    }),
  ).library;
  const timestamp = '2026-09-10T00:00:00.000Z';
  const detail = buildCharacterDetail({
    character: {
      ...characterCreate.parse({
        name: 'Warrior',
        tempEffects: [{ id: 'might', name: 'Might', mods: { st: 5 } }],
      }),
      id: 'character',
      ownerId: 'owner',
      campaignId: null,
      height: null,
      weight: null,
      age: null,
      birthdate: null,
      appearance: null,
      dismissedWarnings: [],
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    traits: [
      {
        id: 'trait',
        characterId: 'character',
        name: 'Striking',
        kind: 'advantage',
        points: 0,
        level: 1,
        notes: null,
        modifiers: [],
        libraryTraitId: 'library',
        libraryEffects: library.traits[0]?.effects ?? [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    skills: [],
    spells: [],
    languages: [],
    techniques: [],
    inventory: [],
    combat: null,
    campaign: null,
  });
  expect(detail.derived.effectiveSt).toBe(15);
  expect(detail.derived.thrust).toBe('1d+2');
  expect(detail.derived.swing).toBe('2d+3');
});

it('warns on illegal torso layers, applies valid torso DX penalty, and exempts head armor', () => {
  const timestamp = '2026-10-03T00:00:00.000Z';
  const character = {
    ...characterCreate.parse({ name: 'Layering audit' }),
    id: 'layering-character',
    ownerId: 'owner',
    campaignId: null,
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
    dismissedWarnings: [],
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const armor = (id: string, location: string, flexible: boolean, concealable = false) => ({
    id,
    characterId: character.id,
    name: id,
    quantity: 1,
    weightLbs: 1,
    cost: 1,
    notes: null,
    parentId: null,
    externalLocation: null,
    worn: true,
    equipped: true,
    isContainer: false,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    isArmor: true,
    armor: { locations: [location], dr: 4, flexible, concealable },
    weaponData: null,
    powerstoneData: null,
    magicItemData: null,
    enchantments: [],
    libraryItemId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const build = (inventory: CharacterDetailInput['inventory']) =>
    buildCharacterDetail({
      character,
      traits: [],
      skills: [],
      spells: [],
      languages: [],
      techniques: [],
      inventory,
      combat: null,
      campaign: null,
    });
  const invalid = build([
    armor('Brigandine vest', 'torso', false),
    armor('Mail shirt', 'torso', false),
  ]);
  const layerWarning = invalid.warnings.find(
    (warning) => warning.code === 'inventory.armor_layers',
  );
  expect(layerWarning).toMatchObject({ severity: 'warn' });
  expect(layerWarning?.message).toContain('“Brigandine vest”, “Mail shirt” at Torso, Vitals');
  expect(layerWarning?.message).toContain('inner layer must be flexible and concealable');
  expect(aggregateDrByLocation(invalid.inventory).has('torso')).toBe(false);

  const dismissed = buildCharacterDetail({
    character: { ...character, dismissedWarnings: ['inventory.armor_layers'] },
    traits: [],
    skills: [],
    spells: [],
    languages: [],
    techniques: [],
    inventory: invalid.inventory,
    combat: null,
    campaign: null,
  });
  expect(dismissed.warnings).not.toContainEqual(
    expect.objectContaining({ code: 'inventory.armor_layers' }),
  );

  const validHead = build([
    armor('outer-helm', 'skull', false),
    armor('inner-cap', 'skull', true, true),
  ]);
  expect(validHead.derived.effectiveDx).toBe(character.dx);
  expect(validHead.warnings).not.toContainEqual(
    expect.objectContaining({ code: 'inventory.armor_layers' }),
  );

  const unarmored = build([]);
  const validTorso = build([
    armor('Outer coat', 'torso', false),
    armor('Concealable undershirt', 'torso', true, true),
  ]);
  expect(validTorso.derived.effectiveDx).toBe(character.dx - 1);
  expect(validTorso.derived.basicSpeed).toBe(unarmored.derived.basicSpeed);
  const dxWarning = validTorso.warnings.find(
    (warning) => warning.code === 'inventory.armor_layer_dx',
  );
  expect(dxWarning?.message).toContain('−1 DX');
  expect(dxWarning?.message).toContain('“Outer coat”, “Concealable undershirt” at Torso, Vitals');
  const dismissedDx = buildCharacterDetail({
    character: { ...character, dismissedWarnings: ['inventory.armor_layer_dx'] },
    traits: [],
    skills: [],
    spells: [],
    languages: [],
    techniques: [],
    inventory: validTorso.inventory,
    combat: null,
    campaign: null,
  });
  expect(dismissedDx.warnings).not.toContainEqual(
    expect.objectContaining({ code: 'inventory.armor_layer_dx' }),
  );

  const friendlyLabels = build([
    armor('Arm shell', 'arm_left', false),
    armor('Arm liner', 'arm_left', false),
    armor('Leg shell', 'leg_right', false),
    armor('Leg liner', 'leg_right', false),
    armor('Eye guard', 'eye', false),
    armor('Eye liner', 'eye', false),
    armor('Tail shell', 'tail_feathers', false),
    armor('Tail liner', 'tail_feathers', false),
  ]);
  const friendlyWarning = friendlyLabels.warnings.find(
    (warning) => warning.code === 'inventory.armor_layers',
  );
  expect(friendlyWarning?.message).toContain('Left Arm');
  expect(friendlyWarning?.message).toContain('Right Leg');
  expect(friendlyWarning?.message).toContain('Eyes');
  expect(friendlyWarning?.message).toContain('Tail Feathers');
});

it('keeps nested carried armor enchantments and shields available through the full builder', () => {
  const timestamp = '2026-10-03T00:00:00.000Z';
  const character = {
    ...characterCreate.parse({ name: 'Nested equipment' }),
    id: 'nested-character',
    ownerId: 'owner',
    campaignId: null,
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
    dismissedWarnings: [],
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const base = {
    characterId: character.id,
    quantity: 1,
    weightLbs: 1,
    cost: 1,
    notes: null,
    externalLocation: null,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const detail = buildCharacterDetail({
    character,
    traits: [],
    skills: [],
    spells: [],
    languages: [],
    techniques: [],
    combat: null,
    campaign: { pointTarget: null, disadvantageCap: null, quirkCap: null, manaLevel: 'normal' },
    inventory: [
      {
        ...base,
        id: 'pack',
        name: 'Carried pack',
        parentId: null,
        worn: true,
        equipped: false,
        isContainer: true,
        isArmor: false,
        armor: null,
        weaponData: null,
        powerstoneData: null,
        magicItemData: null,
        enchantments: [],
        libraryItemId: null,
      },
      {
        ...base,
        id: 'mail',
        name: 'Nested mail',
        parentId: 'pack',
        worn: false,
        equipped: true,
        isContainer: false,
        isArmor: true,
        armor: { locations: ['torso'], dr: 4, flexible: false },
        weaponData: null,
        powerstoneData: null,
        magicItemData: null,
        enchantments: [
          {
            spellName: 'Fortify',
            spellLevel: 15,
            mechanics: {
              applicability: 'armor',
              effects: [{ target: 'dr', value: 1 }],
              levels: [],
              stackingPolicy: { kind: 'stack' },
            },
          },
        ],
        libraryItemId: null,
      },
      {
        ...base,
        id: 'shield',
        name: 'Nested shield',
        parentId: 'pack',
        worn: false,
        equipped: true,
        isContainer: false,
        isArmor: false,
        armor: null,
        weaponData: { damage: '1d cr', db: 1 },
        powerstoneData: null,
        magicItemData: null,
        enchantments: [],
        libraryItemId: null,
      },
    ],
  });
  const mail = detail.inventory.find((item) => item.id === 'mail');
  expect(mail).toMatchObject({ equipped: true, armor: { dr: 5 } });
  expect(mail?.enchantmentBreakdown).toMatchObject([{ target: 'dr', active: true }]);
  expect(aggregateDrByLocation(detail.inventory).get('torso')?.dr).toBe(5);
  expect(pickShield(detail.inventory)).toMatchObject({ name: 'Nested shield', db: 1 });
});

describe('very high mana up-front spell costs', () => {
  const spell = {
    id: 'spell',
    characterId: 'character',
    name: 'Light',
    college: 'Light',
    points: 4,
    baseEnergyCost: 5,
    maintenanceCost: 3,
    castingTime: null,
    duration: null,
    prerequisites: null,
    notes: null,
    librarySpellId: null,
    createdAt: '',
    updatedAt: '',
  };
  it.each([0, 2])('retains discounted casting and maintenance costs at Magery %s', (magery) => {
    const out = buildSpellOut(spell, 15, magery, 'very_high');
    expect(out.effectiveCost).toBe(4);
    expect(out.effectiveMaintenanceCost).toBe(2);
    expect(out).toEqual(buildSpellOut(spell, 15, magery, 'normal'));
  });
  it('keeps skill-discounted zero costs free and null maintenance unavailable', () => {
    const out = buildSpellOut(
      { ...spell, baseEnergyCost: 1, maintenanceCost: null },
      15,
      0,
      'very_high',
    );
    expect(out.effectiveCost).toBe(0);
    expect(out.effectiveMaintenanceCost).toBeNull();
  });
  it('applies declarative skill bonuses to spell level and energy discount', () => {
    const base = buildSpellOut(spell, 12, 0, 'normal');
    const talented = buildSpellOut(spell, 12, 0, 'normal', 2);
    expect(talented.level).toBe((base.level ?? 0) + 2);
    expect(talented.effectiveCost).toBeLessThanOrEqual(base.effectiveCost);
  });
});

describe('character skill effect specialization', () => {
  it('preserves YAML specialty scope in skill, weapon and technique targets', () => {
    const definition = libraryTraitCreate.parse({
      name: 'Pistol Talent',
      kind: 'advantage',
      effects: [{ target: 'skill', value: 2, skillName: 'Guns', skillSpecialty: 'Pistol' }],
    }) as unknown as LibraryYamlDoc['library']['traits'][number];
    const yaml = emitLibraryYaml({
      traits: [definition],
      skills: [],
      spells: [],
      items: [],
      languages: [],
      techniques: [],
      styles: [],
    });
    const copied = parseLibraryYaml(yaml).library.traits[0];
    expect(copied?.effects).toEqual(definition.effects);
    const timestamp = '2026-09-10T00:00:00.000Z';
    const row = {
      characterId: 'character',
      createdAt: timestamp,
      updatedAt: timestamp,
      notes: null,
    };
    const input: CharacterDetailInput = {
      character: {
        id: 'character',
        ownerId: 'owner',
        campaignId: null,
        name: 'Gunner',
        height: null,
        weight: null,
        age: null,
        birthdate: null,
        appearance: null,
        st: 10,
        dx: 12,
        iq: 10,
        ht: 10,
        hpMod: 0,
        fpMod: 0,
        willMod: 0,
        perMod: 0,
        speedQuarterMod: 0,
        moveMod: 0,
        dismissedWarnings: [],
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      traits: [
        {
          ...row,
          id: 'talent',
          name: definition.name,
          kind: 'advantage',
          points: 5,
          level: 1,
          modifiers: [],
          libraryTraitId: 'library',
          libraryEffects: copied?.effects ?? [],
        },
      ],
      skills: ['Pistol', 'Rifle'].map((specialization) => ({
        ...row,
        id: specialization,
        name: 'Guns',
        specialization,
        attribute: 'DX',
        difficulty: 'E',
        points: 1,
        techLevel: 8,
        librarySkillId: null,
      })),
      techniques: ['Pistol', 'Rifle'].map((specialization) => ({
        ...row,
        id: `tech-${specialization}`,
        name: `Targeted ${specialization}`,
        defaultSkillName: `Guns (${specialization})`,
        difficulty: 'A',
        points: 0,
        defaultModifier: -2,
        maxLevel: null,
        libraryTechniqueId: null,
      })),
      spells: [],
      languages: [],
      inventory: [],
      combat: null,
      campaign: null,
    };
    const detail = buildCharacterDetail(input);
    expect(detail.skills.map((skill) => skill.effectiveLevel)).toEqual([14, 12]);
    expect(detail.techniques.map((technique) => technique.level)).toEqual([12, 10]);
    const candidates = detail.skills.map((skill) => ({
      name: skillDisplayName(skill.name, skill.specialization),
      level: skill.effectiveLevel,
    }));
    expect(resolveWeaponSkill('Pistol', 'Guns (Pistol)', candidates)).toMatchObject({ level: 14 });
    expect(resolveWeaponSkill('Rifle', 'Guns (Rifle)', candidates)).toMatchObject({ level: 12 });
    const defaulted = buildCharacterDetail({
      ...input,
      skills: input.skills.map((skill) =>
        skill.specialization === 'Rifle'
          ? {
              ...skill,
              points: 0,
              techLevel: 9,
              defaults: [
                { kind: 'skill' as const, name: 'Guns', specialization: 'Pistol', modifier: -2 },
              ],
            }
          : skill,
      ),
    });
    // FAQ: Talent is applied after defaults and only to its listed skills.
    expect(defaulted.skills.map((skill) => skill.effectiveLevel)).toEqual([14, 9]);
  });
});

describe('earned adventure points and character caps', () => {
  const base: CharacterDetailInput = {
    character: {
      ...characterCreate.parse({ name: 'Adventurer', st: 11 }),
      id: 'character',
      ownerId: 'owner',
      campaignId: 'campaign',
      height: null,
      weight: null,
      age: null,
      birthdate: null,
      appearance: null,
      dismissedWarnings: [],
      revision: 1,
      createdAt: '',
      updatedAt: '',
    },
    traits: [],
    skills: [],
    spells: [],
    languages: [],
    techniques: [],
    inventory: [],
    combat: null,
    campaign: { pointTarget: 150, disadvantageCap: 50, quirkCap: 5 },
  };
  it('adds racial attributes once, keeps temporary ST outside HP and point totals, and combines racial skill training', () => {
    const timestamp = '2026-09-10T00:00:00.000Z';
    const definition = libraryRaceOut.parse({
      id: '0193b3c0-f1f0-7000-8000-00000000f001',
      campaignId: '0193b3c0-f1f0-7000-8000-00000000f002',
      revision: 4,
      createdAt: timestamp,
      updatedAt: timestamp,
      key: 'forestkin',
      name: 'Forestkin',
      kind: 'race',
      points: 25,
      attributeModifiers: { st: 2, hp: 1 },
      traits: [{ key: 'Magery', name: 'Magery', points: 5, level: 2 }],
      skills: [
        {
          key: 'forest-lore',
          name: 'Forest Lore',
          attribute: 'IQ',
          difficulty: 'A',
          points: 2,
        },
      ],
    });
    const race = resolveRaceSelection(
      { raceId: definition.id, variantKey: null, lensIds: [], formKey: null },
      [definition],
    );
    const personalSkill: CharacterDetailInput['skills'][number] = {
      id: 'personal-forest-lore',
      characterId: 'character',
      name: 'Forest Lore',
      specialization: null,
      attribute: 'IQ',
      difficulty: 'A',
      points: 1,
      techLevel: null,
      defaults: null,
      notes: null,
      librarySkillId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const spell = {
      id: 'forest-spell',
      characterId: 'character',
      name: 'Forest Bolt',
      college: null,
      difficulty: 'H' as const,
      points: 1,
      baseEnergyCost: 1,
      maintenanceCost: null,
      castingTime: null,
      duration: null,
      prerequisites: null,
      notes: null,
      librarySpellId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const original = buildCharacterDetail(base);
    const detail = buildCharacterDetail({
      ...base,
      character: {
        ...base.character,
        race,
        hpMod: 2,
        tempEffects: [{ id: 'boost', name: 'Boost', mods: { st: 3 } }],
      },
      campaign: { pointTarget: 150, disadvantageCap: 50, quirkCap: 5, manaLevel: 'low' },
      skills: [personalSkill],
      spells: [spell],
      techniques: [
        {
          id: 'forest-lore-technique',
          characterId: 'character',
          name: 'Deep Lore',
          defaultSkillName: 'Forest Lore',
          difficulty: 'A',
          points: 0,
          defaultModifier: -1,
          maxLevel: null,
          notes: null,
          libraryTechniqueId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });
    expect(detail.derived.effectiveSt).toBe(16);
    expect(detail.derived.hp).toBe(16);
    expect(detail.points).toMatchObject({
      race: 25,
      skills: 1,
      secondary: original.points.secondary + 4,
      total: original.points.total + 31,
    });
    expect(detail.skills[0]).toMatchObject({ points: 1, racialTrainingPoints: 2 });
    expect(detail.techniques[0]?.level).toBe((detail.skills[0]?.effectiveLevel ?? 0) - 1);
    const magicTraits = characterMagicTraits(detail);
    expect(hasMagery(magicTraits)).toBe(true);
    const withoutRace = buildCharacterDetail({
      ...base,
      spells: [spell],
      campaign: { pointTarget: 150, disadvantageCap: 50, quirkCap: 5, manaLevel: 'low' },
    });
    expect(detail.spells[0]?.level).toBe((withoutRace.spells[0]?.level ?? 0) + 2);
    expect(
      characterCanCast({
        ...detail,
        manaLevel: 'low',
        manaLevelKnown: true,
      }),
    ).toBe(true);
    expect(
      characterCanCast({
        traits: [],
        manaLevel: 'low',
        manaLevelKnown: true,
      }),
    ).toBe(false);
  });
  it.each([0, 3, 1000, -5])(
    'adds earned points %s to the campaign cap without changing purchased points',
    (earnedPoints) => {
      const original = buildCharacterDetail(base);
      const detail = buildCharacterDetail({
        ...base,
        character: { ...base.character, earnedPoints },
      });
      expect(detail.earnedPoints).toBe(earnedPoints);
      expect(detail.points.total).toBe(original.points.total);
      expect(detail.points.unspent).toBe(original.points.unspent + earnedPoints);
    },
  );
  it.each([null, { pointTarget: null, disadvantageCap: null, quirkCap: null }])(
    'keeps characters without a campaign target uncapped',
    (campaign) => {
      const detail = buildCharacterDetail({
        ...base,
        campaign,
        character: { ...base.character, earnedPoints: 12 },
      });
      expect(detail.earnedPoints).toBe(12);
      expect(detail.points.unspent).toBe(0);
    },
  );
});
