/**
 * HP / FP horizontal pool bar with the Arcane severity ramp.
 *
 * Wraps the project's existing `.hp-bar` markup so callers don't have
 * to remember the inner-div + inline-width pattern, and exposes a
 * `role="progressbar"` for screen readers. Colour comes from
 * `hpVarFor(ratio)` so the same ratio reads the same hue across the
 * Combat modal, the inline panel, and the bottom-right FAB.
 *
 * `tone="fp"` uses a softer good→warn→low ramp suitable for fatigue
 * (FP doesn't have a "crit/out" zone the way HP does).
 */

import { hpVarFor } from '../../features/characters/sections/hpColor.ts';

interface PoolMeterProps {
  current: number;
  max: number;
  tone: 'hp' | 'fp';
  height?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
  className?: string;
}

const HEIGHT_CLASS: Record<NonNullable<PoolMeterProps['height']>, string> = {
  sm: 'h-2',
  md: 'h-2.5',
  lg: 'h-3.5',
};

export function PoolMeter({
  current,
  max,
  tone,
  height = 'md',
  ariaLabel,
  className,
}: PoolMeterProps) {
  const ratio = max > 0 ? current / max : 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  const colour =
    tone === 'hp'
      ? hpVarFor(ratio)
      : ratio > 0.66
        ? 'var(--hp-good)'
        : ratio > 0.33
          ? 'var(--hp-warn)'
          : 'var(--hp-low)';

  return (
    <div
      className={`hp-bar ${HEIGHT_CLASS[height]} ${className ?? ''}`}
      role="progressbar"
      // tabIndex={-1} keeps the bar out of tab order while making it
      // programmatically focusable, satisfying the a11y rule for
      // interactive roles. The player edits HP via the input/bumper,
      // so there's no reason to land focus on the bar via Tab.
      tabIndex={-1}
      aria-label={ariaLabel}
      aria-valuenow={Math.max(0, current)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div style={{ width: `${clamped * 100}%`, background: colour }} />
    </div>
  );
}
