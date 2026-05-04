/**
 * GURPS 4e skill difficulty levels and their default offset (Basic Set p. 170).
 *
 * The offset table here is `base` only — the per-points adjustment is in
 * src/shared/domain/skillCalc.ts.
 */

export const SKILL_DIFFICULTIES = ['E', 'A', 'H', 'VH'] as const;
export type SkillDifficulty = (typeof SKILL_DIFFICULTIES)[number];

export const DIFFICULTY_BASE_OFFSET: Record<SkillDifficulty, number> = {
  E: 0,
  A: -1,
  H: -2,
  VH: -3,
};

export const SKILL_ATTRIBUTES = ['ST', 'DX', 'IQ', 'HT', 'Will', 'Per', 'Other'] as const;
export type SkillAttribute = (typeof SKILL_ATTRIBUTES)[number];

/** When a skill's attribute is "Other", we default the implied attribute level to 10. */
export const OTHER_ATTRIBUTE_DEFAULT = 10 as const;
