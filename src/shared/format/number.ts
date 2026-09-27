/**
 * Shared number-formatting helpers. Pure TS — importable from client,
 * server, and service-worker contexts (no DOM, no Bun globals, no env
 * access). See AGENTS.md's "Shared validation is pure TS" invariant.
 */

/**
 * "+3", "-2" — ASCII hyphen-minus. Zero prints "+0" by default; pass
 * `{ zero: 'plain' }` where an unsigned "0" reads better (a cost delta).
 */
export function formatSigned(n: number, opts?: { zero?: 'plus' | 'plain' }): string {
  if (n === 0 && opts?.zero === 'plain') return `${n}`;
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Scale-for-display: scale !== 1 ? (n * scale).toFixed(2) : String(n) */
export function formatScaled(n: number, scale: number): string {
  return scale !== 1 ? (n * scale).toFixed(2) : String(n);
}
