import {
  type CharacterRace,
  HUMAN_RACE,
  type LibraryRaceOut,
  type RaceProfile,
  type RaceSelection,
  characterRace,
  libraryRaceCreate,
  raceProfile,
} from '../schemas/race.ts';
import { canAdoptLibraryEntry, canonicalLibraryKey } from './libraryIdentity.ts';

function profileOf(value: unknown): RaceProfile {
  const row = (value ?? {}) as Record<string, unknown>;
  return raceProfile.parse(
    Object.fromEntries(Object.keys(raceProfile.shape).map((key) => [key, row[key]])),
  );
}
export function validateRaceDefinition(value: unknown): void {
  const input = value as Record<string, unknown>;
  const row = libraryRaceCreate.parse(
    Object.fromEntries(Object.keys(libraryRaceCreate.shape).map((key) => [key, input[key]])),
  );
  const unique = (entries: readonly { key: string }[], label: string) => {
    if (new Set(entries.map((e) => canonicalLibraryKey(e.key))).size !== entries.length)
      throw new Error(`Race ${label} keys must be unique`);
  };
  for (const profile of [row, ...row.variants, ...row.forms]) {
    unique(profile.traits, 'trait');
    unique(profile.skills, 'skill');
  }
  unique(row.variants, 'variant');
  unique(row.forms, 'form');
  if (row.kind === 'lens' && (row.variants.length || row.forms.length))
    throw new Error('A lens cannot declare complete variants or alternate forms');
  if (
    row.kind === 'race' &&
    (row.removesTraits.length || row.removesSkills.length || row.compatibleRaceKeys.length)
  )
    throw new Error('Replacement and compatibility rules belong to lenses');
}

/** Complete variants replace a profile; lenses add deltas with explicit component replacement. */
export function resolveRaceSelection(
  selection: RaceSelection,
  entries: readonly LibraryRaceOut[],
): CharacterRace {
  if (!selection.raceId) {
    if (selection.variantKey || selection.formKey)
      throw new Error('Human has no variants or alternate forms');
  }
  if (new Set(selection.lensIds).size !== selection.lensIds.length)
    throw new Error('A race lens may be selected only once');
  const find = (id: string, kind: 'race' | 'lens') => {
    const row = entries.find((e) => e.id === id);
    if (!row || row.kind !== kind || !canAdoptLibraryEntry(row))
      throw new Error(`Selected ${kind} is unavailable`);
    validateRaceDefinition(row);
    return row;
  };
  const base = selection.raceId ? find(selection.raceId, 'race') : null;
  const lenses = selection.lensIds.map((id) => find(id, 'lens'));
  if (!base && !lenses.length) return structuredClone(HUMAN_RACE);
  const variant = selection.variantKey
    ? base?.variants.find((e) => e.key === selection.variantKey)
    : null;
  if (selection.variantKey && !variant) throw new Error('Selected race variant is unavailable');
  const forms = base?.forms ?? [];
  const form = selection.formKey ? forms.find((e) => e.key === selection.formKey) : null;
  if (selection.formKey && !form) throw new Error('Selected race form is unavailable');
  const costProfile = variant ?? base;
  const resolved = (source: unknown): RaceProfile => {
    const profile = profileOf(source);
    // Alternate Form ownership is included in the selected race purchase.
    profile.points = costProfile?.points ?? 0;
    for (const lens of lenses) {
      if (
        lens.compatibleRaceKeys.length &&
        !lens.compatibleRaceKeys.some(
          (k) =>
            canonicalLibraryKey(k) ===
            canonicalLibraryKey(base?.key ?? (base ? base.name : 'human')),
        )
      )
        throw new Error(`${lens.name} is incompatible with ${base?.name ?? 'Human'}`);
      profile.points += lens.points;
      for (const [axis, value] of Object.entries(lens.attributeModifiers)) {
        const key = axis as keyof RaceProfile['attributeModifiers'];
        profile.attributeModifiers[key] = (profile.attributeModifiers[key] ?? 0) + (value ?? 0);
      }
      const merge = <T extends { key: string }>(old: T[], added: T[], removed: string[]): T[] => {
        const remaining = old.filter(
          (e) => !removed.some((k) => canonicalLibraryKey(k) === canonicalLibraryKey(e.key)),
        );
        if (
          added.some((e) =>
            remaining.some((p) => canonicalLibraryKey(p.key) === canonicalLibraryKey(e.key)),
          )
        )
          throw new Error(`${lens.name} must explicitly replace duplicate components`);
        return [...remaining, ...added];
      };
      profile.traits = merge(profile.traits, lens.traits, lens.removesTraits);
      profile.skills = merge(profile.skills, lens.skills, lens.removesSkills);
      profile.features.push(...lens.features);
      profile.effects.push(...lens.effects);
    }
    return profile;
  };
  const displayName = (name: string) => [name, ...lenses.map((e) => e.name)].join(' · ');
  const naturalForm = {
    ...resolved(costProfile),
    key: 'natural',
    name: displayName(variant?.name ?? base?.name ?? 'Human'),
    description: variant?.description ?? base?.description ?? null,
  };
  const ownedForms = forms.map((option) => ({
    ...option,
    ...resolved(option),
    name: displayName(option.name),
  }));
  const active = selection.formKey
    ? ownedForms.find((option) => option.key === selection.formKey)
    : naturalForm;
  if (!active) throw new Error('Selected race form is unavailable');
  return characterRace.parse({
    selection,
    snapshot: {
      ...profileOf(active),
      name: active.name,
      description: active.description,
      naturalForm,
      forms: ownedForms,
      sources: [...(base ? [base] : []), ...lenses].map((e) => ({
        id: e.id,
        campaignId: e.campaignId,
        revision: e.revision,
        key: e.key ?? canonicalLibraryKey(e.name),
        sourceId: e.sourceId ?? null,
        name: e.name,
        source: e.source ?? null,
        sourceLocator: e.sourceLocator ?? null,
      })),
    },
  });
}

/** Switch only the active owned profile; library deletion or edits cannot rewrite the purchase. */
export function switchOwnedRaceForm(race: CharacterRace, formKey: string | null): CharacterRace {
  if (formKey === race.selection.formKey) return characterRace.parse(race);
  const snapshot = race.snapshot;
  if (!snapshot) throw new Error('Human has no alternate forms');
  const active = formKey
    ? snapshot.forms.find((form) => form.key === formKey)
    : snapshot.naturalForm;
  if (!active) throw new Error('Selected owned race form is unavailable');
  return characterRace.parse({
    selection: { ...race.selection, formKey },
    snapshot: {
      ...snapshot,
      ...profileOf(active),
      points: snapshot.points,
      name: active.name,
      description: active.description,
    },
  });
}

export function racialProfile(race: CharacterRace | undefined): RaceProfile {
  return race?.snapshot ? profileOf(race.snapshot) : raceProfile.parse({});
}
export function raceName(race: CharacterRace | undefined): string {
  return race?.snapshot?.name ?? 'Human';
}
