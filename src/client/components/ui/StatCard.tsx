import type { ReactNode } from 'react';
import { AppIcon, type AppIconName } from './AppIcon.tsx';

/** A section band with its point cost or actions, over a matte stat surface. */
export function StatCard({
  title,
  icon,
  points,
  children,
  className = '',
  headerExtra,
}: {
  title: string;
  icon?: AppIconName;
  points?: number | string;
  /** Extra content on the right of the header (e.g. a small action). */
  headerExtra?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card rounded-box border border-base-300/60 bg-base-100 ${className}`}>
      <header className="stat-band flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-base-content">
          {icon && <AppIcon name={icon} size={18} className="text-muted" />}
          {title}
        </h2>
        <span className="flex items-center gap-2">
          {headerExtra}
          {points !== undefined && (
            <span className="num text-[11px] tracking-wider text-muted">{points} pts</span>
          )}
        </span>
      </header>
      {children != null && <div className="card-body p-5">{children}</div>}
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
  singleLine = false,
}: {
  /** Plain string OR a node (e.g. an InfoTooltip-wrapped label). */
  label: ReactNode;
  value: ReactNode;
  derived?: ReactNode;
  valueClassName?: string;
  /** Label is known to fit one line: skip the two-line height reservation. */
  singleLine?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      {/* min-h reserves room for a two-line label so single-word labels
          (e.g. "Dodge") align with two-word ones (e.g. "Basic Speed")
          when the cells sit in the same row. */}
      <span className={`label-eyebrow block ${singleLine ? '' : 'min-h-[2lh]'}`}>{label}</span>
      <span className={`num text-xl font-semibold leading-tight ${valueClassName}`}>{value}</span>
      {derived !== undefined && (
        <span className="num text-[11px] text-base-content/60">{derived}</span>
      )}
    </div>
  );
}
