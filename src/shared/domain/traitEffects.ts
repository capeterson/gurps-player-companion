/**
 * Trait + skill effect resolution.
 *
 * Pure data transformation: takes a character's attached traits/skills
 * (each carrying its library `effects[]` declaration) and the set of
 * currently-active condition groups, and produces:
 *
 *   1. A flat list of `ResolvedEffect` records (with active/inactive,
 *      post-level-scaling values, source attribution) — the UI uses
 *      these to render breakdowns under Dodge / Parry / Block / etc.
 *
 *   2. Aggregate modifier values applied via `applyEffectsToAttrs` —
 *      these populate `attrs.dodgeMod`, `parryMod`, `blockMod`, `drMod`,
 *      `frightCheckMod` and the existing `*Mod` fields BEFORE
 *      `computeDerived` runs in `buildCharacterDetail`.
 *
 *   3. Per-skill bonus aggregates via `skillBonusFor(name)` — used to
 *      compute effective skill levels.
 *
 * This module is pure.  No I/O, no DB.  All inputs supplied by the
 * caller (server in characterDetail.ts; client in useCharacterDetail).
 */

import type { EffectTarget, TraitEffect } from '../schemas/effects.ts';
import type { CharacterAttrs } from './characterCalc.ts';

export interface CharacterTraitWithEffects {
  readonly id: string;
  readonly name: string;
  readonly level: number | null;
  readonly libraryEffects: ReadonlyArray<TraitEffect>;
}

export interface CharacterSkillWithEffects {
  readonly id: string;
  readonly name: string;
  readonly libraryEffects: ReadonlyArray<TraitEffect>;
}

export interface ResolvedEffect {
  /** Distinguishes trait vs. skill source for UI grouping. */
  readonly sourceKind: 'trait' | 'skill';
  /** Display label, e.g. "Combat Reflexes" or "Animal Handling". */
  readonly sourceName: string;
  /** Stable id of the character_trait / character_skill row. */
  readonly sourceId: string;
  readonly target: EffectTarget;
  /** Post-level-scaling delta to apply (or display in the breakdown). */
  readonly value: number;
  readonly skillName?: string;
  readonly skillSpecialty?: string;
  readonly hitLocation?: string;
  readonly conditionGroup?: string;
  readonly conditionLabel?: string;
  /**
   * False when this effect carries a conditionGroup that the character
   * has NOT toggled ON.  Inactive effects are still surfaced to the UI
   * (greyed out in the breakdown) so the user knows they're available.
   */
  readonly active: boolean;
}

/**
 * The set of effect targets that contribute to character attrs (and thus
 * derived stats).  `skill` is intentionally NOT in this set — skill
 * bonuses are surfaced separately because they don't go through
 * computeDerived; see `skillBonusFor`.
 */
const ATTR_TARGETS: ReadonlySet<EffectTarget> = new Set<EffectTarget>([
  'st',
  'dx',
  'iq',
  'ht',
  'hp',
  'fp',
  'will',
  'per',
  'basic_speed',
  'basic_move',
  'dodge',
  'parry',
  'block',
  'dr',
  'fright_check',
]);

function scaledValue(effect: TraitEffect, traitLevel: number | null): number {
  if (effect.scaling === 'per_level') {
    return effect.value * Math.max(1, traitLevel ?? 1);
  }
  return effect.value;
}

function isActive(effect: TraitEffect, activeGroups: ReadonlySet<string>): boolean {
  if (!effect.conditionGroup) return true;
  return activeGroups.has(effect.conditionGroup);
}

export function resolveEffects(
  characterTraits: ReadonlyArray<CharacterTraitWithEffects>,
  characterSkills: ReadonlyArray<CharacterSkillWithEffects>,
  activeConditionGroups: ReadonlySet<string>,
): ResolvedEffect[] {
  const out: ResolvedEffect[] = [];
  function build(
    sourceKind: 'trait' | 'skill',
    sourceName: string,
    sourceId: string,
    eff: TraitEffect,
    value: number,
  ): ResolvedEffect {
    // Build with a mutable record so we can omit `undefined` keys (the
    // `ResolvedEffect` interface uses `readonly` and exactOptionalPropertyTypes
    // forbids assigning `undefined` to optional fields).
    const base: Record<string, unknown> = {
      sourceKind,
      sourceName,
      sourceId,
      target: eff.target,
      value,
      active: isActive(eff, activeConditionGroups),
    };
    if (eff.skillName !== undefined) base.skillName = eff.skillName;
    if (eff.skillSpecialty !== undefined) base.skillSpecialty = eff.skillSpecialty;
    if (eff.hitLocation !== undefined) base.hitLocation = eff.hitLocation;
    if (eff.conditionGroup !== undefined) base.conditionGroup = eff.conditionGroup;
    if (eff.conditionLabel !== undefined) base.conditionLabel = eff.conditionLabel;
    return base as unknown as ResolvedEffect;
  }

  for (const t of characterTraits) {
    for (const eff of t.libraryEffects) {
      out.push(build('trait', t.name, t.id, eff, scaledValue(eff, t.level)));
    }
  }
  for (const s of characterSkills) {
    for (const eff of s.libraryEffects) {
      // Skills don't have a `level` for per-level scaling; treat as flat.
      out.push(build('skill', s.name, s.id, eff, eff.value));
    }
  }
  return out;
}

/**
 * Sentinel id used for the synthesized `TempEffect` that carries the
 * aggregated trait-effect contributions to primary attrs (ST/DX/IQ/HT)
 * and standard secondary axes (HP/FP/Will/Per/Speed/Move).  The rest of
 * the mods (dodge/parry/block/DR/fright_check) don't have TempStatAxis
 * counterparts and live on their dedicated `CharacterAttrs` fields.
 */
const TRAIT_EFFECTS_SENTINEL_ID = 'sys:trait-effects';

/** Map an axis-style effect target to its `TempStatAxis` key. */
const TARGET_TO_AXIS: Partial<Record<EffectTarget, string>> = {
  st: 'st',
  dx: 'dx',
  iq: 'iq',
  ht: 'ht',
  hp: 'hp',
  fp: 'fp',
  will: 'will',
  per: 'per',
  basic_move: 'move',
  // basic_speed is whole points but the TempEffect axis carries it in
  // quarter-increments; handled inline.
};

/**
 * Apply ACTIVE non-skill effects to attrs.  Skill-target effects are
 * surfaced separately (see `skillBonusFor`).
 *
 * Attribute + standard-axis effects (ST/DX/IQ/HT/HP/FP/Will/Per/Move/
 * Speed) are folded into a synthesized `TempEffect` appended to
 * `attrs.tempEffects` — this way they participate in `sumTempMods` /
 * `computeDerived` alongside the user's own temp effects, and stack with
 * them via the same per-axis reducer.  The new derived targets
 * (dodge/parry/block/dr/fright_check) don't correspond to TempStatAxes,
 * so they populate their own dedicated `*Mod` fields on `CharacterAttrs`.
 */
export function applyEffectsToAttrs(
  attrs: CharacterAttrs,
  effects: ReadonlyArray<ResolvedEffect>,
): CharacterAttrs {
  const axisMods: Record<string, number> = {};
  let dodgeMod = attrs.dodgeMod;
  let parryMod = attrs.parryMod;
  let blockMod = attrs.blockMod;
  let drMod = attrs.drMod;
  let frightCheckMod = attrs.frightCheckMod;

  for (const eff of effects) {
    if (!eff.active) continue;
    if (!ATTR_TARGETS.has(eff.target)) continue;
    switch (eff.target) {
      case 'dodge':
        dodgeMod += eff.value;
        break;
      case 'parry':
        parryMod += eff.value;
        break;
      case 'block':
        blockMod += eff.value;
        break;
      case 'dr':
        drMod += eff.value;
        break;
      case 'fright_check':
        frightCheckMod += eff.value;
        break;
      case 'basic_speed':
        // Whole points → quarter-increments on the `speedQuarter` axis.
        axisMods.speedQuarter = (axisMods.speedQuarter ?? 0) + eff.value * 4;
        break;
      default: {
        const axis = TARGET_TO_AXIS[eff.target];
        if (axis) axisMods[axis] = (axisMods[axis] ?? 0) + eff.value;
      }
    }
  }

  const tempEffects =
    Object.keys(axisMods).length === 0
      ? attrs.tempEffects
      : [
          ...attrs.tempEffects,
          {
            id: TRAIT_EFFECTS_SENTINEL_ID,
            name: 'Trait effects',
            mods: axisMods as CharacterAttrs['tempEffects'][number]['mods'],
          },
        ];

  return {
    ...attrs,
    tempEffects,
    dodgeMod,
    parryMod,
    blockMod,
    drMod,
    frightCheckMod,
  };
}

/**
 * Sum of ACTIVE skill-target effects matching the given skill name.
 * Used to compute effectiveSkillLevel = base + skillBonusFor(name).
 *
 * Matching is case-insensitive and substring-tolerant on the trailing
 * "(specialty)" suffix — "Stealth" matches both "Stealth" and "Stealth
 * (Urban)" effects.
 */
export function skillBonusFor(
  skillName: string,
  effects: ReadonlyArray<ResolvedEffect>,
): { total: number; sources: ReadonlyArray<ResolvedEffect> } {
  const wantedBase = skillName.toLowerCase().replace(/\s*\(.*\)\s*$/, '');
  const matches: ResolvedEffect[] = [];
  let total = 0;
  for (const eff of effects) {
    if (eff.target !== 'skill' || !eff.active || !eff.skillName) continue;
    const candidate = eff.skillName.toLowerCase().replace(/\s*\(.*\)\s*$/, '');
    if (candidate === wantedBase || candidate === '*') {
      matches.push(eff);
      total += eff.value;
    }
  }
  return { total, sources: matches };
}

/**
 * Distinct condition groups present in the resolved effect list, with
 * their human-readable labels.  Used by ActiveConditionsPanel to render
 * the toggle list.
 *
 * Takes a structural subset so the CharacterDetail.effects array (whose
 * type uses `?: string | undefined` for optionals) also satisfies the
 * signature without a cast.
 */
export function distinctConditionGroups(
  effects: ReadonlyArray<{
    conditionGroup?: string | undefined;
    conditionLabel?: string | undefined;
    active: boolean;
  }>,
): ReadonlyArray<{ group: string; label: string; active: boolean }> {
  const seen = new Map<string, { label: string; active: boolean }>();
  for (const eff of effects) {
    if (!eff.conditionGroup) continue;
    if (seen.has(eff.conditionGroup)) continue;
    seen.set(eff.conditionGroup, {
      label: eff.conditionLabel ?? eff.conditionGroup,
      active: eff.active,
    });
  }
  return Array.from(seen, ([group, v]) => ({ group, label: v.label, active: v.active }));
}
