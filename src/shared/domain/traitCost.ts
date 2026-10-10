/**
 * Compute the final point cost of a library trait given a set of
 * applied modifiers, per GURPS Basic Set p. 102 / p. 110.
 *
 * Rule:
 *   - All percentage modifiers SUM to a single net percentage
 *     (enhancements positive, limitations negative).
 *   - The net percentage can never reduce the cost by more than 80%:
 *     treat any net modifier of -81% or worse as -80% (B110). A campaign
 *     may change the cap (`houseRules.limitationCapPercent`).
 *   - That single percentage is applied ONCE to the base, then rounded
 *     up (Math.ceil), which rounds "against" the character for both
 *     signs: advantages cost more, disadvantages give back fewer
 *     points (B102's round-up rule).
 *   - Flat modifiers add directly to the result.
 *
 * This module is the single source of truth for modified trait cost —
 * `modifierMath.ts` delegates its arithmetic here.
 *
 * Examples:
 *   computeTraitCost(10, [{ costType:'percent', costValue:50 }]) === 15
 *   computeTraitCost(10, [
 *     { costType:'percent', costValue:50 },
 *     { costType:'percent', costValue:-50 },
 *   ]) === 10
 *   computeTraitCost(10, [{ costType:'percent', costValue:-100 }]) === 2  // clamped to -80%
 *   computeTraitCost(10, [{ costType:'flat', costValue:5 }]) === 15
 */

export interface AppliedTraitModifier {
  readonly costType: 'percent' | 'flat';
  readonly costValue: number;
}

/** Net percentage modifier can never be worse than -80% (B110). */
export const LIMITATION_FLOOR_PERCENT = -80 as const;
/** The published cap as a positive campaign setting value. */
export const STANDARD_LIMITATION_CAP_PERCENT = -LIMITATION_FLOOR_PERCENT;

export interface TraitCostBreakdown {
  readonly base: number;
  /** Unclamped sum of all percent modifiers. */
  readonly percentSum: number;
  /** Percent actually applied after the limitation floor (-80% by default). */
  readonly clampedPercent: number;
  readonly flatSum: number;
  readonly total: number;
}

export function computeTraitCostBreakdown(
  base: number,
  applied: readonly AppliedTraitModifier[],
  limitationCapPercent: number = STANDARD_LIMITATION_CAP_PERCENT,
): TraitCostBreakdown {
  let percentSum = 0;
  let flatSum = 0;
  for (const m of applied) {
    if (m.costType === 'percent') percentSum += m.costValue;
    else flatSum += m.costValue;
  }
  const clampedPercent = Math.max(percentSum, -limitationCapPercent);
  // Integer math (base * (100 + pct) / 100) avoids binary floating-point
  // error like 0.19999... that would nudge an exact result across the
  // ceil boundary.
  const withPercent = Math.ceil((base * (100 + clampedPercent)) / 100);
  return { base, percentSum, clampedPercent, flatSum, total: withPercent + flatSum };
}

export function computeTraitCost(
  base: number,
  applied: readonly AppliedTraitModifier[],
  limitationCapPercent?: number,
): number {
  return computeTraitCostBreakdown(base, applied, limitationCapPercent).total;
}
