/**
 * GURPS 4e mana levels (Basic Set p. 235).  A campaign-wide ambient
 * setting; per-scene overrides stay a table conversation for now.
 *
 *   none       magic does not work at all
 *   low        -5 to all spell skill; Magery required to cast
 *   normal     baseline; Magery required to cast
 *   high       anyone can cast, Magery not required
 *   very_high  as high, but spells cost no energy to cast or
 *              maintain (and per RAW any failure is a critical
 *              failure -- rolls stay on the table, so we only apply
 *              the cost side here)
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
