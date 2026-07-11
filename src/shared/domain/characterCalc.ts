/**
 * GURPS 4e character math: derived stats and the point ledger.
 *
 * Every value here is reproducible from the character's mutable inputs
 * (base attrs, secondary mods, temporary mods, traits, skills) — there
 * is no persisted derived state.  The server stores inputs only; this
 * module renders them into derived values consistently.
 *
 * Reference: Basic Set p. 14-16 (attribute cost tables), p. 17
 * (secondary modifications).
 */

import {
  ATTRIBUTE_BASE,
  PRIMARY_ATTRIBUTES,
  PRIMARY_COST_PER_LEVEL,
  SECONDARY_COST_PER_LEVEL,
  SPEED_COST_PER_QUARTER,
} from '../constants/attributes.ts';
import { damageForSt, formatDamageDice } from '../constants/damage.ts';
import {
  ADVANTAGE_KINDS,
  DISADVANTAGE_KINDS,
  QUIRK_KINDS,
  type TraitKind,
} from '../constants/traits.ts';
import { TEMP_STAT_AXES, type TempEffect, type TempStatAxis } from '../schemas/character.ts';

export interface CharacterAttrs {
  readonly st: number;
  readonly dx: number;
  readonly iq: number;
  readonly ht: number;

  readonly hpMod: number;
  readonly willMod: number;
  readonly perMod: number;
  readonly fpMod: number;
  readonly speedQuarterMod: number;
  readonly moveMod: number;

  readonly tempEffects: readonly TempEffect[];
}

/**
 * Sum every temporary effect's per-axis modifiers into one totals
 * record. Pure, unclamped: bounds are enforced only at validation
 * time (`tempEffectsField`'s `superRefine`), not here -- a reducer
 * that silently clamped would hide a data problem instead of letting
 * the write boundary reject it.  Missing axes default to 0 so callers
 * can always index every axis unconditionally.
 */
export function sumTempMods(effects: readonly TempEffect[]): Record<TempStatAxis, number> {
  const totals = Object.fromEntries(TEMP_STAT_AXES.map((axis) => [axis, 0])) as Record<
    TempStatAxis,
    number
  >;
  for (const effect of effects) {
    for (const axis of TEMP_STAT_AXES) {
      const v = effect.mods[axis];
      if (v === undefined) continue;
      totals[axis] += v;
    }
  }
  return totals;
}

export interface CharacterTraitInput {
  readonly kind: TraitKind;
  readonly points: number;
}

export interface CharacterSkillInput {
  readonly points: number;
}

export interface DerivedStats {
  readonly effectiveSt: number;
  readonly effectiveDx: number;
  readonly effectiveIq: number;
  readonly effectiveHt: number;
  readonly hp: number;
  readonly will: number;
  readonly per: number;
  readonly fp: number;
  readonly basicSpeedQuarters: number;
  readonly basicSpeed: number;
  readonly basicMove: number;
  readonly dodge: number;
  readonly basicLift: number;
  /** Basic thrust damage from ST, e.g. "1d-2" (B16). */
  readonly thrust: string;
  /** Basic swing damage from ST, e.g. "1d" (B16). */
  readonly swing: string;
}

export function computeDerived(attrs: CharacterAttrs): DerivedStats {
  const t = sumTempMods(attrs.tempEffects);
  const effectiveSt = attrs.st + t.st;
  const effectiveDx = attrs.dx + t.dx;
  const effectiveIq = attrs.iq + t.iq;
  const effectiveHt = attrs.ht + t.ht;

  const hp = effectiveSt + attrs.hpMod + t.hp;
  const will = effectiveIq + attrs.willMod + t.will;
  const per = effectiveIq + attrs.perMod + t.per;
  const fp = effectiveHt + attrs.fpMod + t.fp;

  const basicSpeedQuarters = effectiveDx + effectiveHt + attrs.speedQuarterMod + t.speedQuarter;
  const basicSpeed = basicSpeedQuarters / 4;
  const basicMove = Math.floor(basicSpeed) + attrs.moveMod + t.move;
  const dodge = Math.floor(basicSpeed) + 3;
  // Basic Lift = ST²/5; round to the nearest whole number once BL
  // reaches 10 (B15).  Below 10 the fraction is kept as printed.
  const rawBasicLift = (effectiveSt * effectiveSt) / 5;
  const basicLift = rawBasicLift >= 10 ? Math.round(rawBasicLift) : rawBasicLift;
  const damage = damageForSt(effectiveSt);

  return {
    effectiveSt,
    effectiveDx,
    effectiveIq,
    effectiveHt,
    hp,
    will,
    per,
    fp,
    basicSpeedQuarters,
    basicSpeed,
    basicMove,
    dodge,
    basicLift,
    thrust: formatDamageDice(damage.thrust),
    swing: formatDamageDice(damage.swing),
  };
}

export interface PointBreakdown {
  readonly attributes: number;
  readonly secondary: number;
  readonly advantages: number;
  readonly disadvantages: number;
  readonly quirks: number;
  readonly skills: number;
  readonly total: number;
}

/**
 * Point cost of base attributes (excluding temporary boosts, which never
 * count toward point cost).
 */
export function computeAttributePoints(attrs: CharacterAttrs): number {
  let total = 0;
  for (const attr of PRIMARY_ATTRIBUTES) {
    const value = attrs[attr.toLowerCase() as 'st' | 'dx' | 'iq' | 'ht'];
    total += (value - ATTRIBUTE_BASE) * PRIMARY_COST_PER_LEVEL[attr];
  }
  return total;
}

export function computeSecondaryPoints(attrs: CharacterAttrs): number {
  return (
    attrs.hpMod * SECONDARY_COST_PER_LEVEL.hp +
    attrs.willMod * SECONDARY_COST_PER_LEVEL.will +
    attrs.perMod * SECONDARY_COST_PER_LEVEL.per +
    attrs.fpMod * SECONDARY_COST_PER_LEVEL.fp +
    attrs.speedQuarterMod * SPEED_COST_PER_QUARTER +
    attrs.moveMod * SECONDARY_COST_PER_LEVEL.move
  );
}

export function computePointBreakdown(
  attrs: CharacterAttrs,
  traits: readonly CharacterTraitInput[],
  skills: readonly CharacterSkillInput[],
): PointBreakdown {
  const attributes = computeAttributePoints(attrs);
  const secondary = computeSecondaryPoints(attrs);

  let advantages = 0;
  let disadvantages = 0;
  let quirks = 0;
  for (const t of traits) {
    if (ADVANTAGE_KINDS.has(t.kind)) advantages += t.points;
    else if (DISADVANTAGE_KINDS.has(t.kind)) disadvantages += t.points;
    else if (QUIRK_KINDS.has(t.kind)) quirks += t.points;
  }

  const skillPoints = skills.reduce((sum, s) => sum + s.points, 0);

  const total = attributes + secondary + advantages + disadvantages + quirks + skillPoints;

  return {
    attributes,
    secondary,
    advantages,
    disadvantages,
    quirks,
    skills: skillPoints,
    total,
  };
}
