/**
 * GURPS 4e trait modifier math (Basic Set p. B102 / B110).
 *
 * The arithmetic itself lives in `traitCost.ts` (single source of
 * truth): percent modifiers sum, the net is clamped at -80%, the
 * result is rounded up, and flat modifiers add afterward.  This module
 * layers the richer `TraitModifier` shape (category, mutex groups) and
 * the group-conflict validator on top.
 */

import type { ModifierCategory, ModifierCostType } from '../constants/traits.ts';
import { computeTraitCostBreakdown } from './traitCost.ts';

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

export interface ModifiedCost {
  readonly base: number;
  readonly percentSum: number;
  readonly flatSum: number;
  readonly total: number;
}

export function computeModifiedCost(
  basePoints: number,
  modifiers: readonly TraitModifier[],
): ModifiedCost {
  const breakdown = computeTraitCostBreakdown(
    basePoints,
    modifiers.map((m) => ({ costType: m.costType, costValue: m.costValue })),
  );
  return {
    base: breakdown.base,
    percentSum: breakdown.percentSum,
    flatSum: breakdown.flatSum,
    total: breakdown.total,
  };
}

export interface LeveledTraitCostInput {
  /** Library trait `basePoints` — the cost at level 0 (or fixed cost for non-leveled traits). */
  readonly basePoints: number;
  /** Library trait `pointsPerLevel`.  Omit / null for fixed-cost traits. */
  readonly pointsPerLevel?: number | null;
  /** Character trait `level`.  Defaults to 0 (i.e. base cost only). */
  readonly level?: number | null;
  /**
   * Selected variant (from libraryTrait.variants[]).  When omitted, no
   * variant adjustment is applied.  The variant's multiplier applies
   * BEFORE the delta: `total = ceil(leveled * multiplier) + delta`.
   * Per-trait modifiers (enhancements/limitations) then apply via
   * `computeModifiedCost`.
   */
  readonly variant?: {
    readonly pointCostMultiplier?: number;
    readonly pointCostDelta?: number;
  };
  readonly modifiers?: readonly TraitModifier[];
}

/**
 * Full GURPS cost pipeline for a leveled/variant/modified trait:
 *
 *   1. `leveled = basePoints + level * pointsPerLevel`
 *   2. variant: multiplier (Math.ceil), then flat delta
 *   3. modifiers: percent sum (clamped -80%) + flat sum via computeModifiedCost
 *
 * Returns the breakdown so the UI can show every step.
 */
export function computeLeveledTraitCost(input: LeveledTraitCostInput): ModifiedCost & {
  readonly leveled: number;
  readonly variantAdjusted: number;
} {
  const level = input.level ?? 0;
  const perLevel = input.pointsPerLevel ?? 0;
  const leveled = input.basePoints + level * perLevel;
  let variantAdjusted = leveled;
  if (input.variant?.pointCostMultiplier !== undefined) {
    // Round up (Math.ceil) — matches computeTraitCostBreakdown's rule
    // for per-instance enhancements/limitations, so a variant × a mod
    // produces a consistent number regardless of order.  For negative
    // (disadvantage) costs, ceil pulls the total toward zero, which is
    // the same directional favor as B102's round rule.
    variantAdjusted = Math.ceil(leveled * input.variant.pointCostMultiplier);
  }
  if (input.variant?.pointCostDelta !== undefined) {
    variantAdjusted += input.variant.pointCostDelta;
  }
  const modCost = computeModifiedCost(variantAdjusted, input.modifiers ?? []);
  return { ...modCost, leveled, variantAdjusted };
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
