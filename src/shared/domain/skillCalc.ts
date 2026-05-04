/**
 * GURPS 4e skill level calculation.  Reference: Basic Set p. 170.
 *
 *   level = attribute + offset(difficulty, points)
 *
 * The offset table is:
 *
 *   points      | E   A   H   VH
 *   ------------+----------------
 *   0 (default) | -1  -2  -3  -4
 *   1           |  0  -1  -2  -3
 *   2           |  1   0  -1  -2
 *   4           |  2   1   0  -1
 *   8           |  3   2   1   0
 *   12          |  4   3   2   1
 *   ...
 *
 * Each additional doubling of points (or each additional 4 points after 4)
 * grants +1.  This is captured by:
 *
 *   if points >= 4:  offset = base + 2 + (points - 4) // 4
 *   if points == 1:  offset = base + 1
 *   if points >= 2:  offset = base + 1   (covers 2-3 → base+1)
 *
 * The legacy backend used a single piecewise expression; we keep the same
 * computation but spell it out for readability.
 */

import {
  DIFFICULTY_BASE_OFFSET,
  OTHER_ATTRIBUTE_DEFAULT,
  type SkillAttribute,
  type SkillDifficulty,
} from '../constants/skills.ts';
import type { DerivedStats } from './characterCalc.ts';

export function skillOffset(difficulty: SkillDifficulty, points: number): number {
  const base = DIFFICULTY_BASE_OFFSET[difficulty];
  if (points <= 0) return base - 1;
  if (points === 1) return base;
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

export function computeSkillLevel(
  attribute: SkillAttribute,
  difficulty: SkillDifficulty,
  points: number,
  derived: DerivedStats,
): number {
  return attributeLevelFor(attribute, derived) + skillOffset(difficulty, points);
}
