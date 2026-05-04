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

/** Trait kinds that count toward the advantage / positive trait pool. */
export const ADVANTAGE_KINDS = new Set<TraitKind>([
  'advantage',
  'perk',
  'language',
  'cultural_familiarity',
]);
