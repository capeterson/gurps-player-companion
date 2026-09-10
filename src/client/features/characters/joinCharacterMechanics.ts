import type { TraitEffect } from '../../../shared/schemas/effects.ts';
import { ownedLibraryEffects } from '../../../shared/schemas/libraryMechanics.ts';
import type { LocalCharacterSkill, LocalCharacterTrait } from '../../db/dexie.ts';

export interface LibraryEffectOverrides {
  readonly libraryTraitEffects?: ReadonlyMap<string, ReadonlyArray<TraitEffect>>;
  readonly librarySkillEffects?: ReadonlyMap<string, ReadonlyArray<TraitEffect>>;
}

/** Both player and GM readers join the same durable character-owned declarations. */
export function joinCharacterMechanics(
  campaignId: string | null,
  traits: LocalCharacterTrait[],
  skills: LocalCharacterSkill[],
  overrides: LibraryEffectOverrides = {},
) {
  let libraryEffectsKnown = true;
  function effects(
    id: string | null,
    snapshot: unknown,
    override?: ReadonlyMap<string, ReadonlyArray<TraitEffect>>,
  ) {
    const result =
      override && id ? (override.get(id) ?? null) : ownedLibraryEffects(id, campaignId, snapshot);
    if (result === null) libraryEffectsKnown = false;
    return [...(result ?? [])];
  }
  const joinedTraits = traits.map((row) => ({
    ...row,
    libraryEffects: effects(
      row.libraryTraitId,
      row.libraryMechanics,
      overrides.libraryTraitEffects,
    ),
  }));
  const joinedSkills = skills.map((row) => ({
    ...row,
    libraryEffects: effects(
      row.librarySkillId,
      row.libraryMechanics,
      overrides.librarySkillEffects,
    ),
  }));
  return { traits: joinedTraits, skills: joinedSkills, libraryEffectsKnown };
}
