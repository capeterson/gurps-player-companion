/**
 * Pick which of a library trait's available modifiers to apply.
 *
 * Rules:
 * - Multiple modifiers can be on at once.
 * - If two modifiers share the same `group`, only one in the group can
 *   be on (clicking another in the same group swaps).
 * - Final point cost preview uses GURPS B102: percentages SUM and apply
 *   ONCE to base (rounded up), flat modifiers add directly.
 *
 * Mirrors gurps-player-web's `LibraryModifierPicker`.
 */

import { useMemo } from 'react';
import { computeTraitCost } from '../../../shared/domain/traitCost.ts';
import type { TraitModifier } from '../../../shared/schemas/trait.ts';

interface Props {
  basePoints: number;
  available: readonly TraitModifier[];
  selectedNames: readonly string[];
  onToggle: (name: string) => void;
  disabled?: boolean;
}

export function LibraryModifierPicker({
  basePoints,
  available,
  selectedNames,
  onToggle,
  disabled,
}: Props) {
  const selectedSet = useMemo(() => new Set(selectedNames), [selectedNames]);

  const finalCost = useMemo(() => {
    const applied = available
      .filter((m) => selectedSet.has(m.name))
      .map((m) => ({ costType: m.costType, costValue: m.costValue }));
    return computeTraitCost(basePoints, applied);
  }, [basePoints, available, selectedSet]);

  if (available.length === 0) return null;

  return (
    <div className="border-t border-base-300/60 bg-base-200/30 px-3 py-2 text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-base-content/60">Modifiers</span>
        <span className="num text-sm" aria-label="Final point cost">
          {basePoints} → <strong>{finalCost}</strong> pts
        </span>
      </div>
      <ul className="grid gap-1">
        {available.map((m) => {
          const on = selectedSet.has(m.name);
          const sign = m.costValue >= 0 ? '+' : '';
          const cost =
            m.costType === 'percent' ? `${sign}${m.costValue}%` : `${sign}${m.costValue} pts`;
          return (
            <li key={m.name}>
              <button
                type="button"
                onClick={() => onToggle(m.name)}
                disabled={disabled}
                aria-pressed={on}
                className={`w-full text-left rounded px-2 py-1 transition ${
                  on
                    ? 'bg-primary/15 border border-primary/40 text-base-content'
                    : 'border border-base-300 hover:border-primary/40 hover:bg-base-200'
                }`}
                title={m.description ?? undefined}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate">
                    {m.name}
                    {m.group ? (
                      <span className="ml-1 text-[10px] uppercase tracking-wider text-base-content/50">
                        ({m.group})
                      </span>
                    ) : null}
                  </span>
                  <span className="num text-xs text-base-content/70">{cost}</span>
                </span>
                {m.description && (
                  <span className="block text-[11px] text-base-content/60 truncate">
                    {m.description}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Apply a "toggle" event to the current selection list, honouring the
 * "only one per group" rule. Pure helper, exported so callers can
 * compute the new array before persisting.
 */
export function applyModifierToggle(
  available: readonly TraitModifier[],
  current: readonly string[],
  toggled: string,
): string[] {
  const target = available.find((m) => m.name === toggled);
  if (!target) return [...current];
  const next = new Set(current);
  if (next.has(toggled)) {
    next.delete(toggled);
    return [...next];
  }
  // If this modifier has a group, drop any other selected modifier in the same group.
  if (target.group) {
    for (const m of available) {
      if (m.group === target.group && next.has(m.name)) next.delete(m.name);
    }
  }
  next.add(toggled);
  return [...next];
}
