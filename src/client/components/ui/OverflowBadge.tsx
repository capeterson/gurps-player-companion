/**
 * Compact warning chip shown next to HP/FP when the current pool
 * exceeds the character's normal maximum (e.g. healing past full
 * via the double-press override).
 *
 * Uses the theme's `warning` semantic colour so it stays visible
 * in both arcane-dark and arcane-light without bespoke tuning.
 */
export function OverflowBadge({ amount }: { amount?: number }) {
  return (
    <output
      className="badge badge-warning badge-outline gap-1 text-[10px] font-semibold uppercase tracking-wider"
      style={{
        borderColor: 'var(--color-warning)',
        color: 'var(--color-warning)',
        background: 'color-mix(in oklch, var(--color-warning) 12%, transparent)',
      }}
      aria-label={amount ? `Overflow by ${amount}` : 'Overflow'}
    >
      <span aria-hidden>▲</span>
      Overflow{amount !== undefined ? ` +${amount}` : ''}
    </output>
  );
}
