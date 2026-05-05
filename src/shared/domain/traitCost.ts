/**
 * Compute the final point cost of a library trait given a set of
 * applied modifiers, per GURPS Basic Set p. 102.
 *
 * Rule:
 *   - All percentage modifiers SUM to a single percentage.
 *   - That single percentage is applied ONCE to the base, then rounded
 *     up (Math.ceil so negative cost trends toward 0, matching the
 *     "you don't get more than the cap" reading from B102).
 *   - Flat modifiers add directly to the result.
 *
 * Examples:
 *   computeTraitCost(10, [{ costType:'percent', costValue:50 }]) === 15
 *   computeTraitCost(10, [
 *     { costType:'percent', costValue:50 },
 *     { costType:'percent', costValue:-50 },
 *   ]) === 10
 *   computeTraitCost(10, [{ costType:'flat', costValue:5 }]) === 15
 */

export interface AppliedTraitModifier {
  readonly costType: 'percent' | 'flat';
  readonly costValue: number;
}

export function computeTraitCost(base: number, applied: readonly AppliedTraitModifier[]): number {
  let sumPercent = 0;
  let sumFlat = 0;
  for (const m of applied) {
    if (m.costType === 'percent') sumPercent += m.costValue;
    else sumFlat += m.costValue;
  }
  const withPercent = Math.ceil(base * (1 + sumPercent / 100));
  return withPercent + sumFlat;
}
