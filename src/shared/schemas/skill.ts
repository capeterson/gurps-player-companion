import { z } from 'zod';
import { SKILL_ATTRIBUTES, SKILL_DIFFICULTIES } from '../constants/skills.ts';
import { timestamps, uuid } from './common.ts';

export const skillAttributeEnum = z.enum(SKILL_ATTRIBUTES);
export const skillDifficultyEnum = z.enum(SKILL_DIFFICULTIES);

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
  notes: z.string().max(20_000).nullable(),
  librarySkillId: uuid.nullable(),
  /** Server-computed convenience field.  At 0 points this is the
   * attribute default (attr-4/-5/-6 per B173); null for a 0-point
   * Very Hard skill, which has no attribute default. */
  level: z.number().int().nullable(),
  ...timestamps,
});

export const skillCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  attribute: skillAttributeEnum,
  difficulty: skillDifficultyEnum,
  points: z.number().int().min(0).max(1000).default(1),
  techLevel: z.number().int().min(0).max(12).nullable().optional(),
  specialization: z.string().max(160).trim().nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  librarySkillId: uuid.nullable().optional(),
});

export const skillUpdate = skillCreate.partial();

export type SkillOut = z.infer<typeof skillOut>;
export type SkillCreate = z.infer<typeof skillCreate>;
export type SkillUpdate = z.infer<typeof skillUpdate>;
export type SituationalModifier = z.infer<typeof situationalModifier>;
