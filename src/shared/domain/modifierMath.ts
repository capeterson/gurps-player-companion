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

export function computeTraitCost(
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
