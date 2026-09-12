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
  // innate damage resistance — global or hitLocation-scoped
  'dr',
  // self-control / will-roll
  'fright_check',
  // skill bonus — requires skillName
  'skill',
  // flat adds to final ST-based thrust/swing dice, after temporary ST
  'damage_thrust',
  'damage_swing',
  // item-aware weapon effects (require weaponSelector)
  'weapon_attack',
  'weapon_parry',
  'weapon_block',
  'weapon_damage',
  'weapon_accuracy',
] as const;

export const effectTarget = z.enum(EFFECT_TARGETS);
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export const effectScaling = z.enum(['flat', 'per_level']);
export type EffectScaling = z.infer<typeof effectScaling>;

export const WEAPON_EFFECT_TARGETS = [
  'weapon_attack',
  'weapon_parry',
  'weapon_block',
  'weapon_damage',
  'weapon_accuracy',
] as const satisfies readonly EffectTarget[];

export const weaponEffectTarget = z.enum(WEAPON_EFFECT_TARGETS);
export type WeaponEffectTarget = z.infer<typeof weaponEffectTarget>;

const modeName = z.string().trim().min(1).max(40).optional();

/**
 * Deterministic weapon binding. Portable definitions use semantic selectors;
 * an owned/local declaration may instead bind one exact inventory row.
 * Mechanical matching is always normalized exact matching -- never fuzzy.
 */
export const weaponSelector = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('inventory_item'), inventoryItemId: z.string().uuid(), modeName })
    .strict(),
  z
    .object({
      kind: z.literal('library_item'),
      /** Same-campaign fast path. Name is the portable YAML/re-import fallback. */
      libraryItemId: z.string().uuid().optional(),
      libraryItemName: z.string().trim().min(1).max(160),
      modeName,
    })
    .strict(),
  z
    .object({
      kind: z.literal('weapon_skill'),
      skillName: z.string().trim().min(1).max(160),
      skillSpecialty: z.string().trim().min(1).max(160).optional(),
      modeName,
    })
    .strict(),
  z
    .object({
      kind: z.literal('weapon_name'),
      weaponName: z.string().trim().min(1).max(160),
      modeName,
    })
    .strict(),
]);
export type WeaponSelector = z.infer<typeof weaponSelector>;

export const traitEffect = z
  .object({
    target: effectTarget,
    value: z.number().int().min(-100).max(100),
    scaling: effectScaling.default('flat'),
    skillName: z.string().min(1).max(160).optional(),
    skillSpecialty: z.string().min(1).max(160).optional(),
    hitLocation: z.string().min(1).max(40).optional(),
    weaponSelector: weaponSelector.optional(),
    conditionGroup: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, 'must be lower_snake_case')
      .optional(),
    conditionLabel: z.string().min(1).max(120).optional(),
  })
  .strict()
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
    const weaponTarget = WEAPON_EFFECT_TARGETS.includes(eff.target as WeaponEffectTarget);
    if (weaponTarget && !eff.weaponSelector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weaponSelector'],
        message: `weaponSelector is required when target='${eff.target}'`,
      });
    }
    if (!weaponTarget && eff.weaponSelector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weaponSelector'],
        message: 'weaponSelector is only allowed for weapon targets',
      });
    }
    if (
      (eff.target === 'weapon_parry' || eff.target === 'weapon_block') &&
      eff.weaponSelector?.modeName
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weaponSelector', 'modeName'],
        message: `${eff.target} applies to the item defense and cannot select an attack mode`,
      });
    }
  });

export type TraitEffect = z.infer<typeof traitEffect>;

/** Campaign/YAML declarations must remain portable between characters. */
export const libraryTraitEffect = traitEffect.superRefine((effect, ctx) => {
  if (effect.weaponSelector?.kind === 'inventory_item') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['weaponSelector', 'kind'],
      message: 'campaign-library effects cannot bind a character inventory item',
    });
  }
});
export type LibraryTraitEffect = z.infer<typeof libraryTraitEffect>;
