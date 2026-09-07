export const TRAIT_KINDS = [
  'advantage',
  'disadvantage',
  'perk',
  'quirk',
  'language',
  'cultural_familiarity',
] as const;

export type TraitKind = (typeof TRAIT_KINDS)[number];

export const MODIFIER_CATEGORIES = ['enhancement', 'limitation'] as const;
export type ModifierCategory = (typeof MODIFIER_CATEGORIES)[number];

export const MODIFIER_COST_TYPES = ['percent', 'flat'] as const;
export type ModifierCostType = (typeof MODIFIER_COST_TYPES)[number];

/** Trait kinds that count toward the disadvantage pool. */
export const DISADVANTAGE_KINDS = new Set<TraitKind>(['disadvantage']);

/** Trait kinds that count toward the quirk pool. */
export const QUIRK_KINDS = new Set<TraitKind>(['quirk']);

/**
 * Trait kinds whose points bill to the *languages* bucket rather than
 * advantages.
 *
 * `character_languages` (migration 0026) is where languages live now, and
 * migration 0028 moved every existing `kind='language'` trait into it. The
 * enum value stays for backward compatibility — an old client or a
 * hand-crafted import can still create one — so rather than dropping those
 * points on the floor, route them to the same bucket the real language
 * rows use.
 *
 * `cultural_familiarity` deliberately stays an advantage: it has no
 * first-class entity yet, and excluding it without one would make its
 * points vanish from the ledger entirely.
 */
export const LANGUAGE_TRAIT_KINDS = new Set<TraitKind>(['language']);

/** Trait kinds that count toward the advantage / positive trait pool. */
export const ADVANTAGE_KINDS = new Set<TraitKind>(['advantage', 'perk', 'cultural_familiarity']);
