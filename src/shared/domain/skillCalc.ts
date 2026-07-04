/**
 * GURPS 4e skill level calculation.  Reference: Basic Set p. 170.
 *
 *   level = attribute + offset(difficulty, points)
 *
 * The offset table for invested points is:
 *
 *   points | E   A   H   VH
 *   -------+----------------
 *   1      |  0  -1  -2  -3
 *   2      |  1   0  -1  -2
 *   4      |  2   1   0  -1
 *   8      |  3   2   1   0
 *   12     |  4   3   2   1
 *   ...
 *
 * Each additional doubling of points (or each additional 4 points after 4)
 * grants +1.  This is captured by:
 *
 *   if points >= 4:  offset = base + 2 + (points - 4) // 4
 *   if points == 1:  offset = base + 1
 *   if points >= 2:  offset = base + 1   (covers 2-3 → base+1)
 *
 * A skill with 0 points is not "known" at all — the character rolls
 * against the *attribute default* (Basic Set p. 173): attribute-4 for
 * Easy, -5 for Average, -6 for Hard.  Very Hard skills have no
 * attribute default, so their level is null at 0 points.
 */

import {
  DIFFICULTY_BASE_OFFSET,
  OTHER_ATTRIBUTE_DEFAULT,
  type SkillAttribute,
  type SkillDifficulty,
} from '../constants/skills.ts';
import type { DerivedStats } from './characterCalc.ts';

/**
 * Attribute-default offset for an unlearned (0-point) skill, per B173:
 * E → -4, A → -5, H → -6.  Very Hard skills have no attribute default
 * (null).
 */
export function skillDefaultOffset(difficulty: SkillDifficulty): number | null {
  if (difficulty === 'VH') return null;
  return DIFFICULTY_BASE_OFFSET[difficulty] - 4;
}

/**
 * Offset for an invested skill, per the B170 ladder.  Callers must
 * handle the 0-point case themselves (see `skillDefaultOffset`);
 * points below 1 are clamped to the 1-point row defensively.
 */
export function skillOffset(difficulty: SkillDifficulty, points: number): number {
  const base = DIFFICULTY_BASE_OFFSET[difficulty];
  if (points <= 1) return base;
  if (points < 4) return base + 1;
  return base + 2 + Math.floor((points - 4) / 4);
}

/** Resolve which attribute level a skill uses. */
export function attributeLevelFor(attribute: SkillAttribute, derived: DerivedStats): number {
  switch (attribute) {
    case 'ST':
      return derived.effectiveSt;
    case 'DX':
      return derived.effectiveDx;
    case 'IQ':
      return derived.effectiveIq;
    case 'HT':
      return derived.effectiveHt;
    case 'Will':
      return derived.will;
    case 'Per':
      return derived.per;
    case 'Other':
      return OTHER_ATTRIBUTE_DEFAULT;
  }
}

/**
 * Skill level: attribute + point offset for invested skills, or the
 * attribute default for 0-point skills.  Null means "no default" (a
 * Very Hard skill with no points cannot be rolled at all).
 */
export function computeSkillLevel(
  attribute: SkillAttribute,
  difficulty: SkillDifficulty,
  points: number,
  derived: DerivedStats,
): number | null {
  const offset = points <= 0 ? skillDefaultOffset(difficulty) : skillOffset(difficulty, points);
  if (offset === null) return null;
  return attributeLevelFor(attribute, derived) + offset;
}
