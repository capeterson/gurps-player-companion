import { describe, expect, it } from 'bun:test';
import { librarySkillCreate } from '../schemas/campaignLibrary.ts';
import {
  initialLibrarySkillSpecialization,
  resolveLibrarySkillSpecialization,
} from './librarySkillSpecializations.ts';

const base = {
  id: '0193b3c0-f1f0-7000-8000-00000000f001',
  campaignId: '0193b3c0-f1f0-7000-8000-00000000c001',
  name: 'Armoury',
  attribute: 'IQ' as const,
  difficulty: 'A' as const,
  techLevel: null,
  description: 'Base description',
  source: 'B178',
  defaultSpecialization: 'Small Arms',
  defaults: [{ kind: 'attribute' as const, attribute: 'IQ' as const, modifier: -5 }],
  prerequisites: 'Base prerequisite',
  situationalModifiers: [],
  effects: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('library skill specialization policies', () => {
  it('rejects duplicate catalog names after normalization', () => {
    const result = librarySkillCreate.safeParse({
      name: 'Armoury',
      attribute: 'IQ',
      difficulty: 'A',
      specializationPolicy: {
        kind: 'required_catalog',
        options: [{ name: 'Small Arms' }, { name: ' small   arms ' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('requires free-form values and rejects specialties on unspecialized skills', () => {
    expect(() =>
      resolveLibrarySkillSpecialization(
        { ...base, specializationPolicy: { kind: 'required_freeform' } },
        null,
      ),
    ).toThrow('requires a specialization');
    expect(() =>
      resolveLibrarySkillSpecialization(
        {
          ...base,
          defaultSpecialization: null,
          specializationPolicy: { kind: 'none' },
        },
        'Small Arms',
      ),
    ).toThrow('does not accept');
  });

  it('canonicalizes a catalog choice and applies its complete overrides', () => {
    const resolved = resolveLibrarySkillSpecialization(
      {
        ...base,
        specializationPolicy: {
          kind: 'required_catalog',
          options: [
            {
              name: 'Small Arms',
              description: 'Specialty description',
              prerequisites: null,
              defaults: [
                {
                  kind: 'skill',
                  name: 'Guns',
                  specialization: { kind: 'any' },
                  modifier: -4,
                },
              ],
            },
          ],
        },
      },
      ' small   arms ',
    );
    expect(resolved).toEqual({
      specialization: 'Small Arms',
      description: 'Specialty description',
      prerequisites: null,
      defaults: [
        {
          kind: 'skill',
          name: 'Guns',
          specialization: { kind: 'any' },
          modifier: -4,
        },
      ],
    });
  });

  it('canonicalizes a whitespace/case-variant catalog default for picker state', () => {
    expect(
      initialLibrarySkillSpecialization({
        ...base,
        defaultSpecialization: ' small arms ',
        specializationPolicy: {
          kind: 'required_catalog',
          options: [{ name: 'Small Arms' }],
        },
      }),
    ).toBe('Small Arms');
  });

  it('treats a whitespace-only default as absent when initializing picker state', () => {
    expect(
      initialLibrarySkillSpecialization({
        ...base,
        defaultSpecialization: '   ',
        specializationPolicy: {
          kind: 'required_catalog',
          options: [{ name: 'Body Armor' }],
        },
      }),
    ).toBe('Body Armor');
    expect(
      initialLibrarySkillSpecialization({
        ...base,
        defaultSpecialization: '\t',
        specializationPolicy: { kind: 'required_freeform' },
      }),
    ).toBeNull();
  });
});
