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

export const traitOut = z.object({
  id: uuid,
  characterId: uuid,
  kind: traitKindEnum,
  name: z.string().min(1).max(160),
  points: z.number().int().min(-1000).max(1000),
  level: z.number().int().min(1).max(99).nullable(),
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
  notes: z.string().max(20_000).nullable().optional(),
  modifiers: z.array(traitModifier).default([]),
  libraryTraitId: uuid.nullable().optional(),
});

export const traitUpdate = traitCreate.partial();

export type TraitOut = z.infer<typeof traitOut>;
export type TraitCreate = z.infer<typeof traitCreate>;
export type TraitUpdate = z.infer<typeof traitUpdate>;
export type TraitModifier = z.infer<typeof traitModifier>;
