/**
 * GURPS 4e magic math.
 *
 * Spells are mechanically IQ skills of Hard or Very Hard difficulty,
 * and their effective level gets the caster's Magery level added on
 * top.  The casting cost shrinks by 1 at effective skill 15, by 2 at
 * 20, and so on (Basic Set p. 236 / GURPS Magic p. 8) -- all the way
 * down to 0: high enough skill makes a cheap spell free.  The same
 * reduction applies to the per-interval maintenance cost; a spell
 * whose maintenance drops to 0 can be maintained indefinitely.
 *
 *   level         = IQ + skillOffset(H|VH, points) + Magery
 *   reduction     = floor(max(0, level - 10) / 5)
 *   effectiveCost = max(0, baseCost - reduction)
 */

import type { ManaLevel } from '../constants/magic.ts';
import type { SpellDifficulty } from '../constants/skills.ts';
import { skillOffset } from './skillCalc.ts';

/** Minimal trait shape the magic helpers need. */
export interface MageryTraitInput {
  readonly name: string;
  readonly level: number | null;
}

/** Minimal inventory shape `totalPowerstoneEnergy` walks. */
export interface PowerstoneInventoryInput {
  readonly powerstoneData: { readonly currentEnergy: number } | null;
}

/**
 * Magery level: reads the highest `level` from any trait whose name
 * starts with "Magery" (case-insensitive).  Magery 0 is also recorded
 * (the "can cast at all" gate) -- callers that need to distinguish "no
 * Magery" from "Magery 0" should check `hasMagery` instead.
 *
 * Returns 0 when no Magery trait exists; there's no negative Magery in
 * 4e and the additive math degrades gracefully to "regular IQ skill".
 */
export function mageryLevel(traits: readonly MageryTraitInput[]): number {
  let best = 0;
  for (const t of traits) {
    if (!isMageryName(t.name)) continue;
    // Magery 0 is encoded as level=null in many sheets (no level in
    // GURPS terms = "level 0").  When the level column is empty, fall
    // back to a level embedded in the name -- GCS-style sheets write
    // "Magery 3" as the trait name with no separate level.
    const lvl = t.level ?? mageryLevelFromName(t.name);
    if (lvl > best) best = lvl;
  }
  return best;
}

/** "Magery 3", "magery 2 (One College)" → 3 / 2; no number → 0. */
function mageryLevelFromName(name: string): number {
  const m = /\bmagery\s+(\d{1,2})\b/i.exec(name);
  return m?.[1] ? Number.parseInt(m[1], 10) : 0;
}

/** True when the character has any Magery trait at all (incl. Magery 0). */
export function hasMagery(traits: readonly MageryTraitInput[]): boolean {
  return traits.some((t) => isMageryName(t.name));
}

function isMageryName(name: string): boolean {
  // Common conventions: "Magery", "Magery 1", "Magery (Solid!)" etc.
  // We require the word "Magery" with a word boundary so "Imagery"
  // doesn't accidentally count.
  return /\bmagery\b/i.test(name);
}

/**
 * Effective spell skill level.  Spells are IQ/Hard or IQ/Very Hard;
 * we delegate the points→offset table to `skillOffset` and add the
 * caster's IQ and Magery on top.
 */
export function computeSpellLevel(
  points: number,
  iq: number,
  magery: number,
  difficulty: SpellDifficulty = 'H',
): number {
  return iq + skillOffset(difficulty, points) + magery;
}

/**
 * Skill modifier from the ambient mana level (Basic Set p. 235).
 * Low mana is -5 to every spell; the other levels don't shift skill.
 */
export function manaSkillModifier(mana: ManaLevel): number {
  return mana === 'low' ? -5 : 0;
}

/**
 * Whether this character can cast spells at all here (B235): no mana
 * means nobody casts, high or better lets anyone cast, and normal/low
 * mana require Magery (even Magery 0).
 */
export function canCastInMana(casterHasMagery: boolean, mana: ManaLevel): boolean {
  if (mana === 'none') return false;
  if (mana === 'high' || mana === 'very_high') return true;
  return casterHasMagery;
}

/** In very high mana, spells cost no energy to cast or maintain (B235). */
export function isFreeCastingMana(mana: ManaLevel): boolean {
  return mana === 'very_high';
}

/**
 * Cost reduction granted by skill: -1 per full +5 above skill 10, no cap.
 * Always non-negative; sub-10 skills get no reduction (they cast at
 * the listed cost and risk failure, which we don't auto-roll here).
 */
export function costReduction(effectiveSkill: number): number {
  const above = effectiveSkill - 10;
  if (above < 5) return 0;
  return Math.floor(above / 5);
}

/**
 * Cost actually paid to cast this spell.  The skill discount can take
 * a paid spell all the way to 0 (Basic Set p. 236): at skill 15+ a
 * 1-point spell is free.
 */
export function effectiveCastingCost(baseCost: number, effectiveSkill: number): number {
  if (baseCost <= 0) return 0;
  return Math.max(0, baseCost - costReduction(effectiveSkill));
}

/**
 * Per-interval cost to keep the spell running, after the same skill
 * discount (Basic Set p. 236).  Null passes through (spell is not
 * sustainable); 0 means it can be maintained indefinitely for free.
 */
export function effectiveMaintenanceCost(
  baseMaintenance: number | null,
  effectiveSkill: number,
): number | null {
  if (baseMaintenance == null) return null;
  if (baseMaintenance <= 0) return 0;
  return Math.max(0, baseMaintenance - costReduction(effectiveSkill));
}

/**
 * Sum of `currentEnergy` across all powerstones in inventory.  Used by
 * the cast dialog to surface "available stone energy" alongside FP.
 * Items without `powerstoneData` are skipped silently.
 */
export function totalPowerstoneEnergy(items: readonly PowerstoneInventoryInput[]): number {
  let total = 0;
  for (const i of items) {
    if (!i.powerstoneData) continue;
    total += i.powerstoneData.currentEnergy;
  }
  return total;
}
