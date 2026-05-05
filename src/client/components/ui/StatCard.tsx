import type { ReactNode } from 'react';

/**
 * Card with a Fraunces title and an optional point-cost eyebrow.
 * The four hero cards on the character sheet (Attributes, Derived,
 * Modifiers, Point Ledger) lean on this so the chrome is consistent.
 */
export function StatCard({
  title,
  points,
  children,
  className = '',
  headerExtra,
}: {
  title: string;
  points?: number | string;
  /** Extra content on the right of the header (e.g. a small action). */
  headerExtra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card bg-base-100 border border-base-300/60 rounded-2xl ${className}`}>
      <div className="card-body p-5">
        <header className="flex items-baseline justify-between mb-3.5 gap-3">
          <h2 className="font-display text-lg font-semibold text-base-content">{title}</h2>
          <span className="flex items-center gap-2">
            {headerExtra}
            {points !== undefined && (
              <span className="num text-[11px] tracking-wider text-base-content/60">
                {points} pts
              </span>
            )}
          </span>
        </header>
        {children}
      </div>
    </section>
  );
}

/**
 * Single label/value pair inside a StatCard. `derived` is small grey
 * text under the value (e.g. "ST + Lifting × 0.4 = 12 lb").
 */
export function Stat({
  label,
  value,
  derived,
  valueClassName = '',
}: {
  /** Plain string OR a node (e.g. an InfoTooltip-wrapped label). */
  label: ReactNode;
  value: ReactNode;
  derived?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      {typeof label === 'string' ? (
        <span className="label-eyebrow">{label}</span>
      ) : (
        <span className="label-eyebrow">{label}</span>
      )}
      <span className={`num text-xl font-semibold leading-tight ${valueClassName}`}>{value}</span>
      {derived !== undefined && (
        <span className="num text-[11px] text-base-content/60">{derived}</span>
      )}
    </div>
  );
}
