/**
 * Map an HP ratio (current / max) to a colour token from the
 * Arcane severity ramp. Used by both the Combat Modal and the
 * Derived stat card so the same numeric pool reads the same
 * colour across surfaces.
 *
 * Ratios mirror the design prototype's `hpColorFor` helper:
 *   > 0.99   full
 *   > 0.66   good
 *   > 0.33   warn
 *   > 0.00   low
 *   > -0.33  crit
 *   ≤ -0.33  out (death-check zone)
 */
export type HpToken = 'hp-full' | 'hp-good' | 'hp-warn' | 'hp-low' | 'hp-crit' | 'hp-out';

export function hpTokenFor(ratio: number): HpToken {
  if (ratio > 0.99) return 'hp-full';
  if (ratio > 0.66) return 'hp-good';
  if (ratio > 0.33) return 'hp-warn';
  if (ratio > 0) return 'hp-low';
  if (ratio > -0.33) return 'hp-crit';
  return 'hp-out';
}

export function hpVarFor(ratio: number): string {
  return `var(--${hpTokenFor(ratio)})`;
}
