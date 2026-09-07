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
      'defaultModifier',
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
  it('round-trips a resolved row including the default modifier', () => {
    const row = {
      id: UUID,
      characterId: UUID,
      name: 'Combat Riding',
      defaultSkillName: 'Riding',
      difficulty: 'H' as const,
      points: 0,
      defaultModifier: -7,
      maxLevel: null,
      notes: null,
      libraryTechniqueId: null,
      defaultSkillLevel: 23,
      level: 16,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(techniqueOut.parse(row)).toEqual(row);
    // Absent defaultModifier coerces to 0 (full-skill default).
    expect(
      techniqueOut.parse({ ...row, defaultModifier: undefined, level: 23 }).defaultModifier,
    ).toBe(0);
  });

  it('accepts a null level for an unresolvable default skill', () => {
    const parsed = techniqueOut.parse({
      id: UUID,
      characterId: UUID,
      name: 'Feint',
      defaultSkillName: 'Karate',
      difficulty: 'A' as const,
      points: 2,
      defaultModifier: 0,
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

  it('validates the default modifier bounds on create and update', () => {
    expect(
      techniqueCreate.parse({ name: 'X', defaultSkillName: 'S', defaultModifier: -6 }),
    ).toMatchObject({ defaultModifier: -6 });
    expect(techniqueCreate.parse({ name: 'X', defaultSkillName: 'S' }).defaultModifier).toBe(0);
    expect(() =>
      techniqueCreate.parse({ name: 'X', defaultSkillName: 'S', defaultModifier: 1 }),
    ).toThrow();
    expect(() =>
      techniqueCreate.parse({ name: 'X', defaultSkillName: 'S', defaultModifier: -100 }),
    ).toThrow();
    expect(() => techniqueUpdate.parse({ defaultModifier: 0.5 })).toThrow();
  });
});
