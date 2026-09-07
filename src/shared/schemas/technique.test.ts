import { describe, expect, it } from 'bun:test';
import { techniqueCreate, techniqueOut, techniqueUpdate } from './technique.ts';

const UUID = '0193b3c0-f1f0-7000-8000-0000000000b1';

describe('techniqueCreate', () => {
  it('defaults difficulty to Average and points to 0', () => {
    expect(techniqueCreate.parse({ name: 'Feint', defaultSkillName: 'Broadsword' })).toMatchObject({
      difficulty: 'A',
      points: 0,
    });
  });

  it('trims both names', () => {
    const parsed = techniqueCreate.parse({
      name: '  Feint  ',
      defaultSkillName: '  Broadsword  ',
    });
    expect(parsed.name).toBe('Feint');
    expect(parsed.defaultSkillName).toBe('Broadsword');
  });

  it('requires a default skill name', () => {
    expect(techniqueCreate.safeParse({ name: 'Feint' }).success).toBe(false);
    expect(techniqueCreate.safeParse({ name: 'Feint', defaultSkillName: '' }).success).toBe(false);
  });

  it('rejects a difficulty outside A/H (techniques have no E or VH tier)', () => {
    expect(
      techniqueCreate.safeParse({ name: 'Feint', defaultSkillName: 'Broadsword', difficulty: 'E' })
        .success,
    ).toBe(false);
    expect(
      techniqueCreate.safeParse({ name: 'Feint', defaultSkillName: 'Broadsword', difficulty: 'VH' })
        .success,
    ).toBe(false);
  });

  it('accepts a null maxLevel and rejects a negative one', () => {
    expect(
      techniqueCreate.parse({ name: 'Feint', defaultSkillName: 'Broadsword', maxLevel: null })
        .maxLevel,
    ).toBeNull();
    expect(
      techniqueCreate.safeParse({ name: 'Feint', defaultSkillName: 'Broadsword', maxLevel: -1 })
        .success,
    ).toBe(false);
  });
});

describe('techniqueUpdate', () => {
  it('is fully partial so single-field sync patches validate', () => {
    expect(techniqueUpdate.parse({ points: 3 })).toEqual({ points: 3 });
    expect(techniqueUpdate.parse({})).toEqual({});
  });

  it('exposes every writable field in its shape (sync WRITABLE_FOR_PATCH source)', () => {
    expect(Object.keys(techniqueUpdate.shape).sort()).toEqual([
      'defaultSkillName',
      'difficulty',
      'libraryTechniqueId',
      'maxLevel',
      'name',
      'notes',
      'points',
    ]);
  });
});

describe('techniqueOut', () => {
  it('round-trips a resolved row', () => {
    const row = {
      id: UUID,
      characterId: UUID,
      name: 'Feint',
      defaultSkillName: 'Broadsword',
      difficulty: 'H' as const,
      points: 3,
      maxLevel: 4,
      notes: null,
      libraryTechniqueId: null,
      defaultSkillLevel: 14,
      level: 16,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(techniqueOut.parse(row)).toEqual(row);
  });

  it('accepts a null level for an unresolvable default skill', () => {
    const parsed = techniqueOut.parse({
      id: UUID,
      characterId: UUID,
      name: 'Feint',
      defaultSkillName: 'Karate',
      difficulty: 'A' as const,
      points: 2,
      maxLevel: null,
      notes: null,
      libraryTechniqueId: null,
      defaultSkillLevel: null,
      level: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(parsed.level).toBeNull();
    expect(parsed.defaultSkillLevel).toBeNull();
  });
});
