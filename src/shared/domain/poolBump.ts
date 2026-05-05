/**
 * Compute the next value of a pool (HP / FP) after a +/- bump,
 * applying the "soft-cap with double-press override" rule:
 *
 *   - The pool may not exceed `max` on a normal heal/restore.
 *   - If the user attempts to push past `max` twice within
 *     `windowMs` (default 2000), the second attempt is allowed.
 *
 * Damage / FP loss (delta <= 0) is always applied as-is, including
 * pushing the pool below 0 into the death-check zone.
 *
 * Caller passes the timestamp of the last "blocked" attempt (or
 * null) and gets back both the next value and the new "last blocked"
 * timestamp to persist for the next call.
 */

export interface BumpResult {
  /** New value to write back to the pool. */
  readonly next: number;
  /**
   * Timestamp of the most recent blocked attempt, or null when the
   * latest call landed cleanly. Caller stores this and feeds it back
   * on the next call to enable the double-press override.
   */
  readonly lastBlockedAt: number | null;
  /** True when this call was blocked by the soft cap. */
  readonly blocked: boolean;
}

export function bumpPool(
  current: number,
  delta: number,
  max: number,
  lastBlockedAt: number | null,
  now: number = Date.now(),
  windowMs = 2000,
): BumpResult {
  const naive = current + delta;

  // Damage / FP loss is always allowed.
  if (delta <= 0) {
    return { next: naive, lastBlockedAt: null, blocked: false };
  }

  // Already at or above max: block once, allow on second press inside the window.
  if (current >= max) {
    if (lastBlockedAt !== null && now - lastBlockedAt <= windowMs) {
      return { next: naive, lastBlockedAt: null, blocked: false };
    }
    return { next: current, lastBlockedAt: now, blocked: true };
  }

  // Bump that would cross the cap: clamp to max but remember the user
  // *tried* to push past — a follow-up press within the window should
  // overshoot freely.
  if (naive > max) {
    return { next: max, lastBlockedAt: now, blocked: true };
  }

  return { next: naive, lastBlockedAt: null, blocked: false };
}
