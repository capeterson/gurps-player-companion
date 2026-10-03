import type { TraitEffect } from '../../../shared/schemas/effects.ts';
import { ownedLibraryEffects } from '../../../shared/schemas/libraryMechanics.ts';
import type { LocalCharacterSkill, LocalCharacterTrait } from '../../db/dexie.ts';

export interface LibraryEffectOverrides {
  readonly libraryTraitEffects?: ReadonlyMap<string, ReadonlyArray<TraitEffect>>;
  readonly librarySkillEffects?: ReadonlyMap<string, ReadonlyArray<TraitEffect>>;
}

export interface UnavailableMechanics {
  readonly id: string;
  readonly name: string;
  readonly kind: 'trait' | 'skill';
}

/** Both player and GM readers join the same durable character-owned declarations. */
export function joinCharacterMechanics(
  campaignId: string | null,
  traits: LocalCharacterTrait[],
  skills: LocalCharacterSkill[],
  overrides: LibraryEffectOverrides = {},
) {
  let libraryEffectsKnown = true;
  const unavailableMechanics: UnavailableMechanics[] = [];
  function effects(
    row: { id: string; name: string; specialization?: string | null },
    kind: UnavailableMechanics['kind'],
    id: string | null,
    snapshot: unknown,
    override?: ReadonlyMap<string, ReadonlyArray<TraitEffect>>,
  ) {
    const result =
      override && id ? (override.get(id) ?? null) : ownedLibraryEffects(id, campaignId, snapshot);
    if (result === null) {
      libraryEffectsKnown = false;
      unavailableMechanics.push({
        id: row.id,
        name: row.specialization ? `${row.name} (${row.specialization})` : row.name,
        kind,
      });
    }
    return [...(result ?? [])];
  }
  const joinedTraits = traits.map((row) => ({
    ...row,
    libraryEffects: effects(
      row,
      'trait',
      row.libraryTraitId,
      row.libraryMechanics,
      overrides.libraryTraitEffects,
    ),
  }));
  const joinedSkills = skills.map((row) => ({
    ...row,
    libraryEffects: effects(
      row,
      'skill',
      row.librarySkillId,
      row.libraryMechanics,
      overrides.librarySkillEffects,
    ),
  }));
  unavailableMechanics.sort((left, right) =>
    left.kind === right.kind
      ? left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
      : left.kind === 'trait'
        ? -1
        : 1,
  );
  return { traits: joinedTraits, skills: joinedSkills, libraryEffectsKnown, unavailableMechanics };
}
