/**
 * GURPS 4e mana levels (Basic Set p. 235).  A campaign-wide ambient
 * setting; per-scene overrides stay a table conversation for now.
 *
 *   none       magic does not work at all
 *   low        -5 to all spell skill; Magery required to cast
 *   normal     baseline; Magery required to cast
 *   high       anyone can cast, Magery not required
 *   very_high  as high; mages recover personal FP spent on their turn at the start
 *              of their next turn, after paying the normal costs.
 *              Any failure is critical; a rolled critical failure
 *              causes a spectacular disaster.
 */

export const MANA_LEVELS = ['none', 'low', 'normal', 'high', 'very_high'] as const;
export type ManaLevel = (typeof MANA_LEVELS)[number];

export const MANA_LEVEL_LABELS: Record<ManaLevel, string> = {
  none: 'No mana',
  low: 'Low mana',
  normal: 'Normal mana',
  high: 'High mana',
  very_high: 'Very high mana',
};
