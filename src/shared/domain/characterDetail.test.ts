import { describe, expect, it } from 'bun:test';
import { activeEffectDefinitionCreate } from '../schemas/activeEffects.ts';
import { libraryTraitCreate } from '../schemas/campaignLibrary.ts';
import { characterCreate } from '../schemas/character.ts';
import { libraryRaceOut } from '../schemas/race.ts';
import { emitLibraryYaml, parseLibraryYaml } from '../yaml/library.ts';
import { instantiateEffect } from './activeEffects.ts';
import {
  type CharacterDetailInput,
  buildCharacterDetail,
  buildSpellOut,
} from './characterDetail.ts';
import { resolveWeaponSkill, skillDisplayName } from './defenseCalc.ts';
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
        }),
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
    });
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
