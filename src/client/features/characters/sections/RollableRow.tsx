import type { ReactNode } from 'react';
import type { RollRequest } from './rollTypes.ts';

export interface RollableRowProps {
  label: string;
  baseTarget: number;
  presets?: RollRequest['presets'];
  openRoll: (req: RollRequest) => void;
  /** Small caption under the label, e.g. provenance ("via Broadsword–14"). */
  sublabel?: ReactNode;
  /** Known rules restriction: show an unavailable value without a roll action. */
  unavailableReason?: string | null;
}

/**
 * Shared row for every rollable value in the Combat tab (skills, spells,
 * defenses, weapon attacks). The target number is the dominant visual
 * element by design — a player at the table with physical dice reads
 * it at a glance before deciding whether to even open the roll sheet.
 *
 * Purely a dispatcher: it never mutates synced state, so it works
 * identically whether or not the viewer has write access.
 */
export function RollableRow({
  label,
  baseTarget,
  presets,
  openRoll,
  sublabel,
  unavailableReason,
}: RollableRowProps) {
  if (unavailableReason)
    return (
      <div className="rounded-lg border border-base-300/60 px-3 py-2 text-sm">
        <span className="font-medium">{label} — unavailable</span>
        <span className="block text-xs text-base-content/60">{unavailableReason}</span>
      </div>
    );
  return (
    <button
      type="button"
      onClick={() => openRoll({ label, baseTarget, ...(presets ? { presets } : {}) })}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-base-300/60 px-3 py-2 text-left transition hover:border-border-strong hover:bg-base-200/60"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        {sublabel}
      </span>
      <span className="num shrink-0 text-2xl font-bold text-primary">{baseTarget}</span>
    </button>
  );
}
