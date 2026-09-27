import { evaluateCalculation } from '../../../shared/domain/calculation.ts';
import type { CalculationDefinitionV1 } from '../../../shared/schemas/calculation.ts';

// Dexie/library row snapshots are immutable per revision. Avoid reevaluating
// fixed rules for every sort comparison in a large library.
const fixedResults = new WeakMap<CalculationDefinitionV1, Record<string, number> | null>();

/** Never label an unresolved rule with its legacy compatibility price. */
export function pricingDisplayValue(
  rule: CalculationDefinitionV1 | null | undefined,
  output: string,
  legacy: number,
): number | null {
  if (!rule) return legacy;
  if (rule.inputs.length || rule.nodes.some((node) => node.op === 'call')) return null;
  if (!fixedResults.has(rule)) {
    try {
      fixedResults.set(rule, evaluateCalculation(rule, {}));
    } catch {
      fixedResults.set(rule, null);
    }
  }
  return fixedResults.get(rule)?.[output] ?? null;
}
