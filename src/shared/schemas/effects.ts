/**
 * Trait & skill effect declarations for the campaign library.
 *
 * A library trait or skill may declare an array of `effects` describing
 * how it modifies the character sheet at runtime.  When the user attaches
 * the trait to a character, `resolveEffects` looks up these declarations
 * via libraryTraitId / librarySkillId and applies them to derived stats
 * (Dodge, Parry, Block, attributes, DR, etc.) or to effective skill levels.
 *
 * Effects with a `conditionGroup` are off by default; the user toggles
 * the group ON via the character's `activeConditionGroups` to enable them
 * (e.g. "vs Fear", "vs distance", "in low mana").
 */

import { z } from 'zod';

export const EFFECT_TARGETS = [
  // primary attributes (treated as additional bonus on top of attrs.tempXxx)
  'st',
  'dx',
  'iq',
  'ht',
  // secondary stats
  'hp',
  'fp',
  'will',
  'per',
  'basic_speed',
  'basic_move',
  // derived
  'dodge',
  'parry',
  'block',
  // damage resistance — global; per-location is a future iteration
  'dr',
  // self-control / will-roll
  'fright_check',
  // skill bonus — requires skillName
  'skill',
  // damage adjustments
  'damage_thrust',
  'damage_swing',
] as const;

export const effectTarget = z.enum(EFFECT_TARGETS);
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export const effectScaling = z.enum(['flat', 'per_level']);
export type EffectScaling = z.infer<typeof effectScaling>;

export const traitEffect = z
  .object({
    target: effectTarget,
    value: z.number().int().min(-100).max(100),
    scaling: effectScaling.default('flat'),
    skillName: z.string().min(1).max(160).optional(),
    skillSpecialty: z.string().min(1).max(160).optional(),
    hitLocation: z.string().min(1).max(40).optional(),
    conditionGroup: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, 'must be lower_snake_case')
      .optional(),
    conditionLabel: z.string().min(1).max(120).optional(),
  })
  .superRefine((eff, ctx) => {
    if (eff.target === 'skill' && !eff.skillName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['skillName'],
        message: "skillName is required when target='skill'",
      });
    }
    if (eff.target !== 'skill' && eff.skillName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['skillName'],
        message: "skillName only allowed when target='skill'",
      });
    }
    if (eff.hitLocation && eff.target !== 'dr') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hitLocation'],
        message: "hitLocation only allowed when target='dr'",
      });
    }
    if (eff.conditionLabel && !eff.conditionGroup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conditionLabel'],
        message: 'conditionLabel requires conditionGroup',
      });
    }
  });

export type TraitEffect = z.infer<typeof traitEffect>;
