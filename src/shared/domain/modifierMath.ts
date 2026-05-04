/**
 * GURPS 4e trait modifier math (Basic Set p. B102).
 *
 * - All percent enhancements and limitations sum together (limitations are
 *   negative).
 * - The summed percent is applied to the base point cost; the result is
 *   rounded toward zero (truncation), which produces the "ceiling toward
 *   zero" behavior described in the legacy library author skill.
 * - Flat modifiers are added afterward, with no rounding.
 */

import type { ModifierCategory, ModifierCostType } from '../constants/traits.ts';

export interface TraitModifier {
  readonly name: string;
  readonly category: ModifierCategory;
  readonly costType: ModifierCostType;
  /** Signed.  Limitations are typically stored as negative values. */
  readonly costValue: number;
  readonly description?: string;
  /** Optional mutex group; only one selected modifier per group is allowed. */
  readonly group?: string;
}

/** Round toward zero (truncation) — matches Math.trunc for any finite input. */
function truncToZero(value: number): number {
  return Math.trunc(value);
}

export interface ModifiedCost {
  readonly base: number;
  readonly percentSum: number;
  readonly flatSum: number;
  readonly total: number;
}

export function computeTraitCost(
  basePoints: number,
  modifiers: readonly TraitModifier[],
): ModifiedCost {
  let percentSum = 0;
  let flatSum = 0;
  for (const m of modifiers) {
    if (m.costType === 'percent') {
      percentSum += m.costValue;
    } else {
      flatSum += m.costValue;
    }
  }
  // GURPS clamps the final percent multiplier to no less than -80%
  // (limitation cap) per B102.  We expose the math but enforce the cap.
  // Use integer math (basePoints * (100 + pct) / 100) to avoid binary
  // floating-point error like 0.19999... that would push a clamped 20pt
  // result down to 19.
  const clampedPercent = Math.max(percentSum, -80);
  const scaled = truncToZero((basePoints * (100 + clampedPercent)) / 100);
  const total = scaled + flatSum;
  return { base: basePoints, percentSum, flatSum, total };
}

/**
 * Validate that all selected modifiers respect their mutex groups.
 * Returns a list of conflicting group names (empty if valid).
 */
export function findGroupConflicts(modifiers: readonly TraitModifier[]): string[] {
  const seen = new Map<string, number>();
  for (const m of modifiers) {
    if (!m.group) continue;
    seen.set(m.group, (seen.get(m.group) ?? 0) + 1);
  }
  const conflicts: string[] = [];
  for (const [group, count] of seen) {
    if (count > 1) conflicts.push(group);
  }
  return conflicts;
}
