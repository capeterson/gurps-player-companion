import { describe, expect, it } from 'bun:test';
import { libraryTraitCreate } from '../schemas/campaignLibrary.ts';
import { emitLibraryYaml, parseLibraryYaml } from '../yaml/library.ts';
import { type CharacterDetailInput, buildCharacterDetail } from './characterDetail.ts';
import { resolveWeaponSkill, skillDisplayName } from './defenseCalc.ts';

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
              defaults: [
                { kind: 'skill' as const, name: 'Guns', specialization: 'Pistol', modifier: -2 },
              ],
            }
          : skill,
      ),
    });
    // FAQ: Talent is applied after defaults and only to its listed skills.
    expect(defaulted.skills.map((skill) => skill.effectiveLevel)).toEqual([14, 10]);
  });
});
