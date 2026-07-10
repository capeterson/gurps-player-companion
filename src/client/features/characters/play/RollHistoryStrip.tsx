import { useState } from 'react';
import { useRollHistory } from './rollHistory.ts';

export interface RollHistoryStripProps {
  characterId: string;
}

function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** Collapsible strip of this session's rolls for one character, newest first. */
export function RollHistoryStrip({ characterId }: RollHistoryStripProps) {
  const [open, setOpen] = useState(true);
  const all = useRollHistory();
  const rolls = all.filter((r) => r.characterId === characterId);

  return (
    <section className="card space-y-2 p-5">
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="label-eyebrow">Roll history</span>
        <span className="text-xs text-base-content/50" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <>
          <p className="text-[11px] text-base-content/50">Session only — cleared on reload.</p>
          {rolls.length === 0 ? (
            <p className="text-xs text-base-content/60">No rolls yet this session.</p>
          ) : (
            <ul className="space-y-1">
              {rolls.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{r.label}</span>
                  <span className="num flex shrink-0 items-center gap-2 text-xs text-base-content/70">
                    <span>vs {r.target}</span>
                    <span className="font-semibold text-base-content">{r.total}</span>
                    <span>{fmtSigned(r.margin)}</span>
                    {r.crit && (
                      <span
                        className={`badge badge-xs ${r.crit === 'success' ? 'badge-success' : 'badge-error'}`}
                      >
                        {r.crit === 'success' ? 'crit' : 'crit fail'}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
