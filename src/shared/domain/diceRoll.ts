/**
 * GURPS 4e core success roll: 3d6 vs effective skill (Basic Set p. 556,
 * with the critical success/failure table cross-referenced against
 * B345-346).
 *
 * Critical success (B556):
 *   - Roll of 3 or 4: always a critical success.
 *   - Roll of 5: critical success if effective skill is 15+.
 *   - Roll of 6: critical success if effective skill is 16+.
 *
 * Critical failure (B556):
 *   - Roll of 18: always a critical failure.
 *   - Roll of 17: critical failure unless effective skill is 16+, in
 *     which case it is an ordinary failure (B345-346: 17 is never
 *     better than an ordinary failure, no matter how high the skill).
 *   - Any roll of (effective skill + 10) or more: critical failure.
 *
 * Everything else is an ordinary success (roll <= effective skill) or
 * ordinary failure (roll > effective skill).
 */

/** One 3d6 roll: the individual dice plus their sum. */
export interface DiceRoll {
  readonly dice: readonly [number, number, number];
  readonly total: number;
}

export type CritKind = 'success' | 'failure' | null;

export interface RollOutcome {
  readonly success: boolean;
  /**
   * effectiveSkill - total, always (not just on failure). Positive
   * margin means the roll beat the skill by that much; negative margin
   * means it missed by that much. This convention holds even for
   * critical rolls that override the arithmetic success/failure call
   * (e.g. a total of 4 against skill 3 is a critical success with
   * margin -1).
   */
  readonly margin: number;
  readonly crit: CritKind;
}

/** Roll 3d6 using an injectable RNG (defaults to Math.random) so tests are deterministic. */
export function roll3d6(rng: () => number = Math.random): DiceRoll {
  const d1 = Math.floor(rng() * 6) + 1;
  const d2 = Math.floor(rng() * 6) + 1;
  const d3 = Math.floor(rng() * 6) + 1;
  return { dice: [d1, d2, d3], total: d1 + d2 + d3 };
}

/**
 * Evaluate a 3d6 total against an effective skill per the GURPS 4e
 * success roll rules (B556). See module doc comment for the exact
 * critical thresholds.
 *
 * Note the B345-346 wrinkle: a roll of 17 is ALWAYS a failure (never
 * an arithmetic success), even when effectiveSkill >= 17. It is only
 * a *critical* failure when effectiveSkill <= 15; at 16+ it's an
 * ordinary failure. Likewise a roll of 3-4 is always a critical
 * success, even against a very low skill.
 */
export function evaluateRoll(effectiveSkill: number, total: number): RollOutcome {
  const margin = effectiveSkill - total;

  // Critical success (B556).
  if (total <= 4) return { success: true, margin, crit: 'success' };
  if (total === 5 && effectiveSkill >= 15) return { success: true, margin, crit: 'success' };
  if (total === 6 && effectiveSkill >= 16) return { success: true, margin, crit: 'success' };

  // Critical failure (B556).
  if (total === 18) return { success: false, margin, crit: 'failure' };
  if (total >= effectiveSkill + 10) return { success: false, margin, crit: 'failure' };
  if (total === 17) {
    // Always a failure; only "critical" when effectiveSkill <= 15 (B345-346).
    const crit: CritKind = effectiveSkill <= 15 ? 'failure' : null;
    return { success: false, margin, crit };
  }

  // Ordinary roll.
  return { success: total <= effectiveSkill, margin, crit: null };
}
