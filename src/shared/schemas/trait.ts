import { z } from 'zod';
import { MODIFIER_CATEGORIES, MODIFIER_COST_TYPES, TRAIT_KINDS } from '../constants/traits.ts';
import { timestamps, uuid } from './common.ts';

export const traitKindEnum = z.enum(TRAIT_KINDS);
export const modifierCategoryEnum = z.enum(MODIFIER_CATEGORIES);
export const modifierCostTypeEnum = z.enum(MODIFIER_COST_TYPES);

export const traitModifier = z.object({
  name: z.string().min(1).max(160),
  category: modifierCategoryEnum,
  costType: modifierCostTypeEnum,
  costValue: z.number().int().min(-200).max(500),
  description: z.string().max(2000).optional(),
  group: z.string().max(80).optional(),
});

/**
 * A named variant of a trait — e.g. Damage Resistance has "Hardened",
 * "Tough Skin", "Limited (Crushing)" variants that share the base entry
 * but adjust the final cost.  Variants are discrete picks (radio-button
 * style); a character has at most one variant of a given trait.
 *
 * For leveled traits, the variant adjustment applies AFTER level scaling:
 * `total = (basePoints + level * pointsPerLevel) * variantMultiplier + variantDelta`.
 * Then existing trait modifiers (enhancements/limitations) apply on top
 * via `computeTraitCost` in domain/modifierMath.ts.
 */
export const traitVariant = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  /** Multiplier applied to the leveled cost.  Omit for 1.0. */
  pointCostMultiplier: z.number().min(0.05).max(20).optional(),
  /** Flat delta added after the multiplier.  Omit for 0. */
  pointCostDelta: z.number().int().min(-1000).max(1000).optional(),
});

export const traitOut = z.object({
  id: uuid,
  characterId: uuid,
  kind: traitKindEnum,
  name: z.string().min(1).max(160),
  points: z.number().int().min(-1000).max(1000),
  level: z.number().int().min(1).max(99).nullable(),
  /** Selected variant name (must match a library variant's `name`).  Null = base. */
  variantName: z.string().min(1).max(80).nullable(),
  notes: z.string().max(20_000).nullable(),
  modifiers: z.array(traitModifier).default([]),
  libraryTraitId: uuid.nullable(),
  ...timestamps,
});

export const traitCreate = z.object({
  kind: traitKindEnum,
  name: z.string().min(1).max(160).trim(),
  points: z.number().int().min(-1000).max(1000).default(0),
  level: z.number().int().min(1).max(99).nullable().optional(),
  variantName: z.string().min(1).max(80).trim().nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  modifiers: z.array(traitModifier).default([]),
  libraryTraitId: uuid.nullable().optional(),
});

export const traitUpdate = traitCreate.partial();

export type TraitOut = z.infer<typeof traitOut>;
export type TraitCreate = z.infer<typeof traitCreate>;
export type TraitUpdate = z.infer<typeof traitUpdate>;
export type TraitModifier = z.infer<typeof traitModifier>;
export type TraitVariant = z.infer<typeof traitVariant>;
