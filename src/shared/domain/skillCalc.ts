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
 * The first doubling steps and then each additional 4 points grant +1:
 *
 *   if points >= 4:  offset = base + 2 + (points - 4) // 4
 *   if points == 1:  offset = base
 *   if points >= 2:  offset = base + 1   (covers 2-3 → base+1)
 *
 * Defaults are skill-specific declarations (B173), never inferred from
 * difficulty. Unknown legacy defaults and explicit no-default skills have
 * no rollable level until points are invested or declarations are supplied.
 */

import {
  DIFFICULTY_BASE_OFFSET,
  OTHER_ATTRIBUTE_DEFAULT,
  type SkillAttribute,
  type SkillDifficulty,
} from '../constants/skills.ts';
import type { SkillDefaults } from '../schemas/skill.ts';
import type { DerivedStats } from './characterCalc.ts';
import { skillDisplayName } from './defenseCalc.ts';

/**
 * Offset for an invested skill, per the B170 ladder.  Callers must
 * handle the 0-point case themselves (see `computeSkillLevel`);
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

export interface TrainedSkillDefaultSource {
  name: string;
  specialization: string | null;
  /** Learned source level before Talent; caller must exclude dependency cycles. */
  level: number;
}

/** Point value of a default on the target skill's own learning ladder. */
function defaultPointCredit(level: number, attribute: number, difficulty: SkillDifficulty): number {
  const steps = level - attribute - DIFFICULTY_BASE_OFFSET[difficulty];
  if (steps < 0) return 0;
  if (steps === 0) return 1;
  if (steps === 1) return 2;
  return 4 * (steps - 1);
}

/** Best declared default or purchased level. Points are actual points spent;
 * skill-default credits are virtual and never enter the point ledger.
 * The whole-list resolver below supplies learned sources without cycles.
 * See official FAQ 3.3.1 for buy-up examples.
 */
export function computeSkillLevel(
  attribute: SkillAttribute,
  difficulty: SkillDifficulty,
  points: number,
  derived: DerivedStats,
  defaults: SkillDefaults = null,
  trainedSkills: readonly TrainedSkillDefaultSource[] = [],
): number | null {
  const attr = attributeLevelFor(attribute, derived);
  let best = points > 0 ? attr + skillOffset(difficulty, points) : null;
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const candidate of defaults ?? []) {
    const levels =
      candidate.kind === 'attribute'
        ? [attributeLevelFor(candidate.attribute, derived) + candidate.modifier]
        : trainedSkills
            .filter((source) => {
              const wanted = normalize(skillDisplayName(candidate.name, candidate.specialization));
              return normalize(skillDisplayName(source.name, source.specialization)) === wanted;
            })
            .map((source) => source.level + candidate.modifier);
    for (const level of levels) {
      let improved = level;
      if (points > 0) {
        improved = Math.max(
          level,
          attr + skillOffset(difficulty, points + defaultPointCredit(level, attr, difficulty)),
        );
      }
      best = best === null ? improved : Math.max(best, improved);
    }
  }
  return best;
}

interface DefaultableSkill {
  id: string;
  name: string;
  specialization: string | null;
  attribute: SkillAttribute;
  difficulty: SkillDifficulty;
  points: number;
  defaults?: SkillDefaults;
}

/** Resolve one consistent, acyclic set of defaults for the whole sheet.
 * A learned buy-up can supply another default; a zero-point bridge cannot.
 * Strict improvements preserve the current direction on ties. Stable ID order
 * makes reciprocal choices independent of row ordering. Reversing a bought-up
 * pair requires redistributing actual points (B173), not claiming both discounts.
 */
export function resolveSkillLevels(
  skills: readonly DefaultableSkill[],
  derived: DerivedStats,
): Map<string, number | null> {
  const ordered = [...skills].sort((a, b) => a.id.localeCompare(b.id));
  type SkillSource = Extract<NonNullable<SkillDefaults>[number], { kind: 'skill' }>;
  const selected = new Map<string, { source: DefaultableSkill; declaration: SkillSource }>();
  const levels = new Map<string, number | null>();
  const levelFor = (skill: DefaultableSkill): number | null => {
    if (levels.has(skill.id)) return levels.get(skill.id) ?? null;
    const parent = selected.get(skill.id);
    const sourceLevel = parent ? levelFor(parent.source) : null;
    const level = computeSkillLevel(
      skill.attribute,
      skill.difficulty,
      skill.points,
      derived,
      parent ? [parent.declaration] : skill.defaults?.filter((d) => d.kind === 'attribute'),
      parent && sourceLevel !== null
        ? [
            {
              name: parent.source.name,
              specialization: parent.source.specialization,
              level: sourceLevel,
            },
          ]
        : [],
    );
    levels.set(skill.id, level);
    return level;
  };
  const wouldCycle = (target: string, source: string): boolean => {
    let cursor: string | undefined = source;
    while (cursor !== undefined) {
      if (cursor === target) return true;
      cursor = selected.get(cursor)?.source.id;
    }
    return false;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const skill of ordered) {
      let best = levelFor(skill);
      let choice = selected.get(skill.id);
      for (const declaration of skill.defaults ?? []) {
        if (declaration.kind !== 'skill') continue;
        for (const source of ordered) {
          if (source.points <= 0 || wouldCycle(skill.id, source.id)) continue;
          const sourceLevel = levelFor(source);
          if (sourceLevel === null) continue;
          const candidate = computeSkillLevel(
            skill.attribute,
            skill.difficulty,
            skill.points,
            derived,
            [declaration],
            [{ name: source.name, specialization: source.specialization, level: sourceLevel }],
          );
          if (candidate !== null && (best === null || candidate > best)) {
            best = candidate;
            choice = { source, declaration };
          }
        }
      }
      if (choice && choice !== selected.get(skill.id)) {
        selected.set(skill.id, choice);
        levels.clear(); // Ancestor improvements also raise every dependent skill.
        changed = true;
      }
    }
  }
  for (const skill of ordered) levelFor(skill);
  return levels;
}
