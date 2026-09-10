import { z } from 'zod';
import { SKILL_ATTRIBUTES, SKILL_DIFFICULTIES } from '../constants/skills.ts';
import { timestamps, uuid } from './common.ts';

export const skillAttributeEnum = z.enum(SKILL_ATTRIBUTES);
export const skillDifficultyEnum = z.enum(SKILL_DIFFICULTIES);

/** Null/absent = legacy unknown; [] = explicitly no defaults. */
export const skillDefault = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('attribute'),
      attribute: skillAttributeEnum,
      modifier: z.number().int().min(-50).max(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal('skill'),
      name: z.string().trim().min(1).max(160),
      specialization: z.string().trim().min(1).max(160).optional(),
      modifier: z.number().int().min(-50).max(0),
    })
    .strict(),
]);
export const skillDefaults = z.array(skillDefault).max(20).nullable();
export type SkillDefaults = z.infer<typeof skillDefaults>;

export const situationalModifier = z.object({
  name: z.string().min(1).max(160),
  modifier: z.number().int().min(-50).max(50),
  description: z.string().max(2000).optional(),
});

export const skillOut = z.object({
  id: uuid,
  characterId: uuid,
  name: z.string().min(1).max(160),
  attribute: skillAttributeEnum,
  difficulty: skillDifficultyEnum,
  points: z.number().int().min(0).max(1000),
  techLevel: z.number().int().min(0).max(12).nullable(),
  specialization: z.string().max(160).nullable(),
  // A library copy can contain both 20k description/prerequisites plus source labels.
  notes: z.string().max(40_100).nullable(),
  librarySkillId: uuid.nullable(),
  defaults: skillDefaults.optional(),
  /** Best purchased or declared default level (B173). Null when untrained
   * and no declared default has an available source, including legacy unknowns. */
  level: z.number().int().nullable(),
  /**
   * Server-computed: `level` + sum of active skill-target trait effects
   * (e.g. Talents, Magery's blanket bonus to all spell skills).  Null
   * when `level` is null; otherwise `level` when
   * no matching effects apply.
   */
  effectiveLevel: z.number().int().nullable(),
  ...timestamps,
});

export const skillCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  attribute: skillAttributeEnum,
  difficulty: skillDifficultyEnum,
  points: z.number().int().min(0).max(1000).default(1),
  techLevel: z.number().int().min(0).max(12).nullable().optional(),
  specialization: z.string().max(160).trim().nullable().optional(),
  notes: z.string().max(40_100).nullable().optional(),
  librarySkillId: uuid.nullable().optional(),
  defaults: skillDefaults.optional(),
});

export const skillUpdate = skillCreate.partial();

export type SkillOut = z.infer<typeof skillOut>;
export type SkillCreate = z.infer<typeof skillCreate>;
export type SkillUpdate = z.infer<typeof skillUpdate>;
export type SituationalModifier = z.infer<typeof situationalModifier>;
