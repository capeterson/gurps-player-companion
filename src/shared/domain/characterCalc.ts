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

  readonly tempSt: number;
  readonly tempDx: number;
  readonly tempIq: number;
  readonly tempHt: number;
  readonly tempHpMod: number;
  readonly tempWillMod: number;
  readonly tempPerMod: number;
  readonly tempFpMod: number;
  readonly tempSpeedQuarterMod: number;
  readonly tempMoveMod: number;
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
  /** From base ST (not effectiveSt) + hpMod + tempHpMod — temp ST doesn't add HP. */
  readonly hp: number;
  readonly will: number;
  readonly per: number;
  /** From base HT (not effectiveHt) + fpMod + tempFpMod — temp HT doesn't add FP. */
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
  const effectiveSt = attrs.st + attrs.tempSt;
  const effectiveDx = attrs.dx + attrs.tempDx;
  const effectiveIq = attrs.iq + attrs.tempIq;
  const effectiveHt = attrs.ht + attrs.tempHt;

  // HP and FP are derived from BASE ST/HT, not effective (temp-boosted)
  // ST/HT. Canonical temporary attribute boosts (e.g. Might/Vigor
  // spells, M37) explicitly do NOT change HP or FP maxima — only the
  // dedicated tempHpMod/tempFpMod fields do that. Temp ST still drives
  // Basic Lift, thrust/swing damage, and effectiveSt itself (exactly
  // what a Might-type boost is meant to affect).
  const hp = attrs.st + attrs.hpMod + attrs.tempHpMod;
  const will = effectiveIq + attrs.willMod + attrs.tempWillMod;
  const per = effectiveIq + attrs.perMod + attrs.tempPerMod;
  const fp = attrs.ht + attrs.fpMod + attrs.tempFpMod;

  const basicSpeedQuarters =
    effectiveDx + effectiveHt + attrs.speedQuarterMod + attrs.tempSpeedQuarterMod;
  const basicSpeed = basicSpeedQuarters / 4;
  const basicMove = Math.floor(basicSpeed) + attrs.moveMod + attrs.tempMoveMod;
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
