import { z } from 'zod';
import { MANA_LEVELS } from '../constants/magic.ts';
import { combatStateOut } from './combat.ts';
import { isoTimestamp, revision, timestamps, uuid } from './common.ts';
import { effectTarget } from './effects.ts';
import { inventoryItemOut } from './inventory.ts';
import { skillOut } from './skill.ts';
import { spellOut } from './spell.ts';
import { traitOut } from './trait.ts';

const attr = z.number().int().min(1).max(99);
const mod = z.number().int().min(-50).max(50);

/** The ten stat axes a temporary effect can modify. */
export const TEMP_STAT_AXES = [
  'st',
  'dx',
  'iq',
  'ht',
  'hp',
  'will',
  'per',
  'fp',
  'speedQuarter',
  'move',
] as const;
export type TempStatAxis = (typeof TEMP_STAT_AXES)[number];

/** Axis key -> display label. Shared by the effects-list rows, the add
 * form's axis select, and the client-side cap-violation toast message. */
export const TEMP_AXIS_LABELS: Record<TempStatAxis, string> = {
  st: 'ST',
  dx: 'DX',
  iq: 'IQ',
  ht: 'HT',
  hp: 'HP',
  will: 'Will',
  per: 'Per',
  fp: 'FP',
  speedQuarter: 'Speed',
  move: 'Move',
};

/**
 * Sentinel id for the single "manual adjustment" effect: the
 * always-present bucket the ✦ modifier popovers write to directly
 * (as opposed to a named effect added through the effects list).
 * Never collides with a client-generated uuid.
 */
export const MANUAL_TEMP_EFFECT_ID = 'manual';

const tempAxisMod = z.number().int().min(-50).max(50);

/**
 * One temporary effect: a named bundle of per-axis modifiers (e.g.
 * "Might potion" -> ST +2, HT +1). Validated by `tempEffectsField`
 * below (characters.temp_effects jsonb column — see
 * docs/specs/json-fields.md). Each axis is optional (an effect only
 * lists the axes it actually touches); `mods` is `.strict()` so an
 * unknown axis key is rejected rather than silently ignored.
 */
export const tempEffect = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80).trim(),
  mods: z
    .object({
      st: tempAxisMod.optional(),
      dx: tempAxisMod.optional(),
      iq: tempAxisMod.optional(),
      ht: tempAxisMod.optional(),
      hp: tempAxisMod.optional(),
      will: tempAxisMod.optional(),
      per: tempAxisMod.optional(),
      fp: tempAxisMod.optional(),
      speedQuarter: tempAxisMod.optional(),
      move: tempAxisMod.optional(),
    })
    .strict(),
});
export type TempEffect = z.infer<typeof tempEffect>;

/**
 * The full `characters.temp_effects` jsonb column: a bounded list of
 * `tempEffect`s. Two invariants Zod alone can't express per-element,
 * enforced here via `superRefine`:
 *   - effect ids are unique (the client keys list rows and the
 *     manual-sentinel upsert by id),
 *   - the per-axis SUM across every effect stays within [-50, 50] --
 *     matches the bound a single scalar temp mod used to carry, so
 *     stacking five +10 ST buffs is rejected the same way a lone +60
 *     would have been.
 */
export const tempEffectsField = z
  .array(tempEffect)
  .max(40)
  .superRefine((effects, ctx) => {
    const seenIds = new Set<string>();
    for (const effect of effects) {
      if (seenIds.has(effect.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate temporary effect id "${effect.id}"`,
        });
      }
      seenIds.add(effect.id);
    }
    const totals: Record<string, number> = {};
    for (const effect of effects) {
      for (const axis of TEMP_STAT_AXES) {
        const v = effect.mods[axis];
        if (v === undefined) continue;
        totals[axis] = (totals[axis] ?? 0) + v;
      }
    }
    for (const axis of TEMP_STAT_AXES) {
      const total = totals[axis] ?? 0;
      if (total < -50 || total > 50) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `combined ${axis} modifier ${total} out of range [-50, 50]`,
        });
      }
    }
  });

export const characterAttributesShape = {
  st: attr.default(10),
  dx: attr.default(10),
  iq: attr.default(10),
  ht: attr.default(10),

  hpMod: mod.default(0),
  willMod: mod.default(0),
  perMod: mod.default(0),
  fpMod: mod.default(0),
  speedQuarterMod: mod.default(0),
  moveMod: mod.default(0),

  tempEffects: tempEffectsField.default([]),
} as const;

export const characterIdentityShape = {
  name: z.string().min(1).max(120).trim(),
  playerName: z.string().max(120).trim().nullable().optional(),
  height: z.string().max(40).nullable().optional(),
  weight: z.string().max(40).nullable().optional(),
  age: z.number().int().min(0).max(10_000).nullable().optional(),
  appearance: z.string().max(20_000).nullable().optional(),
  techLevel: z.number().int().min(0).max(12).nullable().optional(),
  campaignId: uuid.nullable().optional(),
} as const;

export const characterCreate = z.object({
  ...characterIdentityShape,
  ...characterAttributesShape,
});

export const characterUpdate = characterCreate.partial();

/**
 * Schema for the `characters.dismissed_warnings` jsonb column: the set
 * of warning codes the owner has dismissed.  Codes match
 * `warningOut.code` (see `src/shared/domain/warnings.ts`).
 */
export const dismissedWarningsField = z.array(z.string().min(1).max(80)).max(200);

/**
 * Fields writable through /sync/operations for the `character` class.
 * Extends the REST-update surface with `dismissedWarnings`, which REST
 * mutates via the dedicated /warnings/dismiss endpoint but the
 * offline-first client patches directly as a field (WarningsPanel
 * enqueues `fieldPath: 'dismissedWarnings'`).
 */
export const characterSyncPatch = characterUpdate.extend({
  dismissedWarnings: dismissedWarningsField.optional(),
});

export const dismissWarningRequest = z.object({
  code: z.string().min(1).max(80),
  dismissed: z.boolean(),
});

export const derivedStatsOut = z.object({
  effectiveSt: z.number().int(),
  effectiveDx: z.number().int(),
  effectiveIq: z.number().int(),
  effectiveHt: z.number().int(),
  hp: z.number().int(),
  will: z.number().int(),
  per: z.number().int(),
  fp: z.number().int(),
  basicSpeedQuarters: z.number().int(),
  basicSpeed: z.number(),
  basicMove: z.number().int(),
  dodge: z.number().int(),
  /** Alias of `dodge` (kept for clarity in trait-effect breakdowns). */
  dodgeBase: z.number().int(),
  /** Aggregate +N to all parry rolls from active trait effects. */
  parryMod: z.number().int(),
  /** Aggregate +N to all block rolls from active trait effects. */
  blockMod: z.number().int(),
  /** Aggregate DR contributed by traits (separate from armor DR). */
  traitDr: z.number().int(),
  /** Aggregate +N to fright check rolls from active trait effects. */
  frightCheckMod: z.number().int(),
  basicLift: z.number(),
  /** Basic thrust damage from ST, e.g. "1d-2" (B16). */
  thrust: z.string(),
  /** Basic swing damage from ST, e.g. "1d" (B16). */
  swing: z.string(),
});

/**
 * One trait/skill effect resolved against a character — same shape as
 * domain/traitEffects.ts ResolvedEffect, returned in CharacterDetail
 * for UI breakdowns.
 */
export const resolvedEffectOut = z.object({
  sourceKind: z.enum(['trait', 'skill']),
  sourceName: z.string(),
  sourceId: uuid,
  target: effectTarget,
  value: z.number().int(),
  skillName: z.string().optional(),
  skillSpecialty: z.string().optional(),
  hitLocation: z.string().optional(),
  conditionGroup: z.string().optional(),
  conditionLabel: z.string().optional(),
  active: z.boolean(),
});

export const pointBreakdownOut = z.object({
  attributes: z.number().int(),
  secondary: z.number().int(),
  advantages: z.number().int(),
  disadvantages: z.number().int(),
  quirks: z.number().int(),
  skills: z.number().int(),
  total: z.number().int(),
});

export const warningOut = z.object({
  code: z.string(),
  severity: z.enum(['warn', 'note']),
  message: z.string(),
});

export const encumbranceOut = z.object({
  level: z.number().int().min(0).max(4),
  label: z.enum(['None', 'Light', 'Medium', 'Heavy', 'X-Heavy']),
  moveMultiplier: z.number(),
  dodgePenalty: z.number().int(),
  playerWeightLbs: z.number(),
  basicLift: z.number(),
  ratio: z.number(),
});

export const characterListItem = z.object({
  id: uuid,
  ownerId: uuid,
  campaignId: uuid.nullable(),
  name: z.string(),
  playerName: z.string().nullable(),
  techLevel: z.number().int().nullable(),
  st: z.number().int(),
  dx: z.number().int(),
  iq: z.number().int(),
  ht: z.number().int(),
  updatedAt: isoTimestamp,
  revision,
});

export const characterDetail = z.object({
  /** Discriminator so the client can switch between full and minimal views. */
  view: z.literal('full').default('full'),
  id: uuid,
  ownerId: uuid,
  ...characterIdentityShape,
  ...characterAttributesShape,
  dismissedWarnings: z.array(z.string()),
  /** Trait/skill effect condition groups currently toggled ON. */
  activeConditionGroups: z.array(z.string()).default([]),
  ...timestamps,
  revision,
  derived: derivedStatsOut,
  points: pointBreakdownOut,
  encumbrance: encumbranceOut,
  warnings: z.array(warningOut),
  /** Ambient mana from the campaign ('normal' when campaignless);
   * already folded into every spell's level and effective costs. */
  manaLevel: z.enum(MANA_LEVELS).default('normal'),
  /** False when the character belongs to a campaign whose row hasn't
   * reached the local store yet -- manaLevel is then only the 'normal'
   * fallback and casting should be held rather than trusted. Always
   * true on server-built details (the server joins the campaign). */
  manaLevelKnown: z.boolean().default(true),
  traits: z.array(traitOut),
  skills: z.array(skillOut),
  spells: z.array(spellOut),
  inventory: z.array(inventoryItemOut),
  combat: combatStateOut.nullable(),
  /**
   * Flat list of trait/skill effects resolved against this character's
   * current condition-group toggles.  The UI groups by `target` to
   * render per-stat breakdowns.  Inactive (conditional, group OFF)
   * effects appear here too with `active: false`.
   */
  effects: z.array(resolvedEffectOut).default([]),
});

/**
 * Minimal "readily apparent" view of a character. Returned to non-owner
 * non-author members of campaigns where `share_character_sheets=false`,
 * so other players can still see the public-facing identity bits without
 * accessing private stats / inventory / log entries.
 */
export const characterMinimalOut = z.object({
  view: z.literal('minimal'),
  id: uuid,
  ownerId: uuid,
  campaignId: uuid.nullable(),
  name: z.string().min(1),
  playerName: z.string().nullable(),
  height: z.string().nullable(),
  weight: z.string().nullable(),
  age: z.number().int().nullable(),
  appearance: z.string().nullable(),
  techLevel: z.number().int().nullable(),
  updatedAt: isoTimestamp,
});

/** Discriminated union of the two character payloads. */
export const characterDetailEnvelope = z.discriminatedUnion('view', [
  characterDetail,
  characterMinimalOut,
]);

export type CharacterCreate = z.infer<typeof characterCreate>;
export type CharacterUpdate = z.infer<typeof characterUpdate>;
export type CharacterSyncPatch = z.infer<typeof characterSyncPatch>;
export type CharacterDetail = z.infer<typeof characterDetail>;
export type CharacterMinimalOut = z.infer<typeof characterMinimalOut>;
export type CharacterDetailEnvelope = z.infer<typeof characterDetailEnvelope>;
export type CharacterListItem = z.infer<typeof characterListItem>;
export type DerivedStatsOut = z.infer<typeof derivedStatsOut>;
export type PointBreakdownOut = z.infer<typeof pointBreakdownOut>;
export type WarningOut = z.infer<typeof warningOut>;
export type EncumbranceOut = z.infer<typeof encumbranceOut>;
export type DismissWarningRequest = z.infer<typeof dismissWarningRequest>;
export type ResolvedEffectOut = z.infer<typeof resolvedEffectOut>;
