/**
 * GURPS 4e attribute and secondary-stat point costs.
 * Per Basic Set p. 14-16 / p. 17 (modifiers).
 *
 * These values are the source of truth for both the character sheet UI
 * and the server-side point ledger.
 */

export type Attribute = 'ST' | 'DX' | 'IQ' | 'HT' | 'Will' | 'Per' | 'Other';

export const PRIMARY_ATTRIBUTES = ['ST', 'DX', 'IQ', 'HT'] as const;
export type PrimaryAttribute = (typeof PRIMARY_ATTRIBUTES)[number];

export const ATTRIBUTE_BASE = 10 as const;

/** Cost per +1 of base attribute (or per -1 below 10, multiplied negatively). */
export const PRIMARY_COST_PER_LEVEL: Record<PrimaryAttribute, number> = {
  ST: 10,
  DX: 20,
  IQ: 20,
  HT: 10,
};

/** Cost per +1 of secondary mod (HP, Will, Per, FP, Move) above the derived base. */
export const SECONDARY_COST_PER_LEVEL = {
  hp: 2,
  will: 5,
  per: 5,
  fp: 3,
  move: 5,
} as const;

/**
 * Basic Speed costs 5 points per +0.25.  We track speed modifications in
 * "quarter increments" (integer) to avoid floating-point arithmetic.
 */
export const SPEED_COST_PER_QUARTER = 5 as const;

export const SECONDARY_MODS = ['hp', 'will', 'per', 'fp', 'move'] as const;
export type SecondaryMod = (typeof SECONDARY_MODS)[number];
