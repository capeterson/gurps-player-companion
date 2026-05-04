export const POSTURES = [
  'standing',
  'prone',
  'kneeling',
  'crawling',
  'sitting',
  'crouching',
  'lying',
] as const;

export type Posture = (typeof POSTURES)[number];

/**
 * Common conditions presented as one-tap chips in the combat tracker UI.
 * The data model accepts arbitrary strings; this list is just the seeded
 * shortcut set so players don't have to type the same words repeatedly.
 */
export const COMMON_CONDITIONS = [
  'shock',
  'stunned',
  'unconscious',
  'mortally_wounded',
  'reeling',
  'bleeding',
  'grappled',
  'restrained',
  'pinned',
  'on_fire',
  'poisoned',
  'sleeping',
] as const;
