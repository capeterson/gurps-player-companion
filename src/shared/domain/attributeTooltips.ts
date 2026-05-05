/**
 * Tooltip helpers for the character sheet's attribute and secondary-mod
 * cells: "spent X · next Y" + a plain-language list of what each input
 * influences.
 *
 * Cost math lives in `constants/attributes.ts`; this module only adds
 * the human-readable copy used inside `<InfoTooltip>`. Both layers
 * import the same cost tables so the tooltip can never disagree with
 * the point ledger.
 */

import {
  ATTRIBUTE_BASE,
  PRIMARY_COST_PER_LEVEL,
  type PrimaryAttribute,
  SECONDARY_COST_PER_LEVEL,
  SPEED_COST_PER_QUARTER,
} from '../constants/attributes.ts';

/** Total points spent to raise (or lower) an attribute from 10 to `level`. */
export function attrSpent(key: PrimaryAttribute, level: number): number {
  return (level - ATTRIBUTE_BASE) * PRIMARY_COST_PER_LEVEL[key];
}

/** Cost of the next +1 in this attribute. */
export function attrNextCost(key: PrimaryAttribute): number {
  return PRIMARY_COST_PER_LEVEL[key];
}

/** What raising or lowering each primary attribute affects. */
export const ATTR_INFLUENCE: Record<PrimaryAttribute, string[]> = {
  ST: [
    'HP (default = ST)',
    'Basic Lift = ST²/5 lbs',
    'Thrust & Swing damage',
    'Many physical skills (lifting, climbing, swimming)',
  ],
  DX: [
    'Basic Speed = (DX + HT)/4',
    'Basic Move (drops fractions of Speed)',
    'Dodge = Basic Speed + 3',
    'Most combat, athletic, vehicle, and craft skills',
  ],
  IQ: [
    'Will (default = IQ)',
    'Perception (default = IQ)',
    'All mental skills (sciences, social, magic)',
  ],
  HT: [
    'FP (default = HT)',
    'Basic Speed = (DX + HT)/4',
    'Resistance to disease, poison, knockdown, fatigue',
  ],
};

/**
 * Secondary-mod tooltip metadata.  Speed is special: the underlying
 * field is `speedQuarterMod` (integer quarters of Basic Speed) but
 * the cost is "5 points per +0.25". We surface that explicitly.
 */
export type SecondaryModKey = 'hp' | 'will' | 'per' | 'fp' | 'speed' | 'move';

export interface SecondaryModInfo {
  /** Header label shown in the tooltip (e.g. "HP", "Basic Speed"). */
  readonly label: string;
  /** Cost text for the tooltip's "Next" line. */
  readonly nextCostLabel: string;
  /** Plain-language influence list. */
  readonly influences: string[];
}

export const SECONDARY_INFO: Record<SecondaryModKey, SecondaryModInfo> = {
  hp: {
    label: 'HP',
    nextCostLabel: `+1 = ${SECONDARY_COST_PER_LEVEL.hp} pts`,
    influences: ['Hit points only — does not change ST'],
  },
  will: {
    label: 'Will',
    nextCostLabel: `+1 = ${SECONDARY_COST_PER_LEVEL.will} pts`,
    influences: ['Mental resistance — does not change IQ'],
  },
  per: {
    label: 'Per',
    nextCostLabel: `+1 = ${SECONDARY_COST_PER_LEVEL.per} pts`,
    influences: ['Sense rolls — does not change IQ'],
  },
  fp: {
    label: 'FP',
    nextCostLabel: `+1 = ${SECONDARY_COST_PER_LEVEL.fp} pts`,
    influences: ['Fatigue points only — does not change HT'],
  },
  speed: {
    label: 'Basic Speed',
    nextCostLabel: `+0.25 = ${SPEED_COST_PER_QUARTER} pts`,
    influences: [
      'Basic Speed (in 0.25 increments)',
      'Knock-on: Basic Move (drop fractions) and Dodge (Speed + 3)',
    ],
  },
  move: {
    label: 'Basic Move',
    nextCostLabel: `+1 = ${SECONDARY_COST_PER_LEVEL.move} pts`,
    influences: ['Basic Move only (yards/second) — does not change Speed'],
  },
};

/** Total points spent on a secondary mod at `level`. */
export function secondarySpent(key: SecondaryModKey, level: number): number {
  if (key === 'speed') return level * SPEED_COST_PER_QUARTER;
  return level * SECONDARY_COST_PER_LEVEL[key];
}
