/**
 * Technique math (GURPS Martial Arts p. 87-90).
 *
 * A technique defaults from a governing skill at a **penalty** (its
 * default line — e.g. "Defaults: Riding-6").  Points are then spent to
 * buy it up from that line.  Point-to-bonus conversion depends on
 * difficulty:
 *
 *   Average — every point buys +1 over the default.
 *   Hard    — the first point buys nothing (it only "unlocks" the
 *             technique at its default); every point after that buys +1.
 *
 * NOTE: the implementation plan's sketch used `floor(points / 2)` for
 * Hard techniques and described it as a simplification. That doesn't
 * match the book — and it doesn't match the plan's own prose ("1 point =
 * +0 (default), then +1 per point"). The book rule is implemented here;
 * it's no more complex and it produces the numbers a player expects off
 * a printed sheet.
 *
 * The default penalty itself is stored as `defaultModifier` on the
 * technique (0 = no penalty, defaults at full skill), so a technique
 * that starts at skill-6 doesn't expose the inflated full skill level
 * as its roll target until the player buys it up.
 *
 * Techniques are also capped: `maxLevel` is the largest bonus the
 * technique may reach above its default, per its write-up. Null =
 * uncapped.
 */

import type { TechniqueDifficulty } from '../schemas/technique.ts';
import { skillDisplayName } from './defenseCalc.ts';

/**
 * Bonus a technique gets over its default skill for `points` invested.
 * Never negative, and never above `maxLevel` when one is set.
 */
export function techniqueBonus(
  points: number,
  difficulty: TechniqueDifficulty,
  maxLevel: number | null | undefined,
): number {
  const raw = difficulty === 'A' ? points : points - 1;
  const bonus = Math.max(0, raw);
  if (maxLevel === null || maxLevel === undefined) return bonus;
  return Math.min(bonus, maxLevel);
}

/**
 * Technique level = resolved default skill level + the technique's
 * default-line penalty (`defaultModifier`) + `techniqueBonus` (the
 * point-purchased improvement, capped by `maxLevel`).  Null when the
 * default skill isn't resolvable on the sheet (or has no usable level,
 * e.g. a 0-point Very Hard skill), because a technique without a
 * default has nothing to roll against.
 */
export function computeTechniqueLevel(
  points: number,
  defaultSkillLevel: number | null,
  difficulty: TechniqueDifficulty,
  maxLevel: number | null | undefined = null,
  defaultModifier: number | null | undefined = 0,
): number | null {
  if (defaultSkillLevel === null) return null;
  return defaultSkillLevel + (defaultModifier ?? 0) + techniqueBonus(points, difficulty, maxLevel);
}

/** One of the character's skills, as seen by the technique resolver. */
export interface TechniqueSkillCandidate {
  readonly name: string;
  readonly specialization?: string | null;
  /** Effective level (after trait effects); null = no usable level. */
  readonly level: number | null;
}

/**
 * Resolve a technique's `defaultSkillName` against the character's
 * skills.  Matches case-insensitively against both the bare skill name
 * and its `Name (Specialization)` display form, so "Broadsword" and
 * "Savoir-Faire (Dojo)" both work. Ties break on the highest level so a
 * character with two specializations of the same skill defaults from
 * their best. Returns null when nothing usable matches — the technique
 * then has a null level rather than silently defaulting to something
 * else.
 */
export function resolveDefaultSkillLevel(
  defaultSkillName: string,
  skills: readonly TechniqueSkillCandidate[],
): number | null {
  const needle = defaultSkillName.trim().toLowerCase();
  if (needle.length === 0) return null;
  let best: number | null = null;
  for (const skill of skills) {
    if (skill.level === null) continue;
    const bare = skill.name.trim().toLowerCase();
    const display = skillDisplayName(skill.name, skill.specialization).trim().toLowerCase();
    if (bare !== needle && display !== needle) continue;
    if (best === null || skill.level > best) best = skill.level;
  }
  return best;
}
