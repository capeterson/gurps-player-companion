/**
 * Shared number-formatting helpers. Pure TS — importable from client,
 * server, and service-worker contexts (no DOM, no Bun globals, no env
 * access). See AGENTS.md's "Shared validation is pure TS" invariant.
 */

/** "+3", "0" → "+0", "-2" — ASCII hyphen-minus. */
export function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Scale-for-display: scale !== 1 ? (n * scale).toFixed(2) : String(n) */
export function formatScaled(n: number, scale: number): string {
  return scale !== 1 ? (n * scale).toFixed(2) : String(n);
}
