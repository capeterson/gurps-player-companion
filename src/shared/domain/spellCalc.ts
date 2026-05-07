/**
 * GURPS 4e magic math.
 *
 * Spells are mechanically IQ/Hard skills, but their effective level
 * gets the caster's Magery level added on top.  The casting cost
 * shrinks by 1 for every full +5 the effective skill is above 10
 * (Basic Set p. 235 / GURPS Magic p. 7), to a floor of 1 -- unless
 * the spell's base cost is 0, in which case it stays free.
 *
 *   level         = IQ + skillOffset(H, points) + Magery
 *   reduction     = floor(max(0, level - 10) / 5)
 *   effectiveCost = max(baseCost === 0 ? 0 : 1, baseCost - reduction)
 */

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
    // GURPS terms = "level 0").  Treat null as 0.
    const lvl = t.level ?? 0;
    if (lvl > best) best = lvl;
  }
  return best;
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
 * Effective spell skill level.  Spells are always IQ/Hard, so we
 * delegate the points→offset table to `skillOffset('H', points)` and
 * add the caster's IQ and Magery on top.
 */
export function computeSpellLevel(points: number, iq: number, magery: number): number {
  return iq + skillOffset('H', points) + magery;
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
 * Cost actually paid to cast this spell.  Free spells (base 0) stay
 * free; everything else floors at 1 -- you can't get a paid spell
 * down to 0 by being skilled.
 */
export function effectiveCastingCost(baseCost: number, effectiveSkill: number): number {
  if (baseCost <= 0) return 0;
  const discounted = baseCost - costReduction(effectiveSkill);
  return Math.max(1, discounted);
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
