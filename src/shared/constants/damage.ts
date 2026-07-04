/**
 * GURPS 4e basic damage by ST (Basic Set p. 16, "Damage Table").
 *
 * Thrust (thr) and swing (sw) dice as printed, ST 1-40 row by row,
 * then the published 5-point steps from 45 to 100.  Above ST 100,
 * add 1d to both thrust and swing per full 10 points of ST (B16).
 */

export interface DamageDice {
  /** Number of d6s. */
  readonly dice: number;
  /** Flat adds (may be negative). */
  readonly adds: number;
}

export interface StDamage {
  readonly thrust: DamageDice;
  readonly swing: DamageDice;
}

function d(dice: number, adds: number): DamageDice {
  return { dice, adds };
}

/** Rows for ST 1-40 (index = ST - 1). */
const DAMAGE_TABLE: readonly StDamage[] = [
  { thrust: d(1, -6), swing: d(1, -5) }, // ST 1
  { thrust: d(1, -6), swing: d(1, -5) }, // ST 2
  { thrust: d(1, -5), swing: d(1, -4) }, // ST 3
  { thrust: d(1, -5), swing: d(1, -4) }, // ST 4
  { thrust: d(1, -4), swing: d(1, -3) }, // ST 5
  { thrust: d(1, -4), swing: d(1, -3) }, // ST 6
  { thrust: d(1, -3), swing: d(1, -2) }, // ST 7
  { thrust: d(1, -3), swing: d(1, -2) }, // ST 8
  { thrust: d(1, -2), swing: d(1, -1) }, // ST 9
  { thrust: d(1, -2), swing: d(1, 0) }, // ST 10
  { thrust: d(1, -1), swing: d(1, 1) }, // ST 11
  { thrust: d(1, -1), swing: d(1, 2) }, // ST 12
  { thrust: d(1, 0), swing: d(2, -1) }, // ST 13
  { thrust: d(1, 0), swing: d(2, 0) }, // ST 14
  { thrust: d(1, 1), swing: d(2, 1) }, // ST 15
  { thrust: d(1, 1), swing: d(2, 2) }, // ST 16
  { thrust: d(1, 2), swing: d(3, -1) }, // ST 17
  { thrust: d(1, 2), swing: d(3, 0) }, // ST 18
  { thrust: d(2, -1), swing: d(3, 1) }, // ST 19
  { thrust: d(2, -1), swing: d(3, 2) }, // ST 20
  { thrust: d(2, 0), swing: d(4, -1) }, // ST 21
  { thrust: d(2, 0), swing: d(4, 0) }, // ST 22
  { thrust: d(2, 1), swing: d(4, 1) }, // ST 23
  { thrust: d(2, 1), swing: d(4, 2) }, // ST 24
  { thrust: d(2, 2), swing: d(5, -1) }, // ST 25
  { thrust: d(2, 2), swing: d(5, 0) }, // ST 26
  { thrust: d(3, -1), swing: d(5, 1) }, // ST 27
  { thrust: d(3, -1), swing: d(5, 1) }, // ST 28
  { thrust: d(3, 0), swing: d(5, 2) }, // ST 29
  { thrust: d(3, 0), swing: d(5, 2) }, // ST 30
  { thrust: d(3, 1), swing: d(6, -1) }, // ST 31
  { thrust: d(3, 1), swing: d(6, -1) }, // ST 32
  { thrust: d(3, 2), swing: d(6, 0) }, // ST 33
  { thrust: d(3, 2), swing: d(6, 0) }, // ST 34
  { thrust: d(4, -1), swing: d(6, 1) }, // ST 35
  { thrust: d(4, -1), swing: d(6, 1) }, // ST 36
  { thrust: d(4, 0), swing: d(6, 2) }, // ST 37
  { thrust: d(4, 0), swing: d(6, 2) }, // ST 38
  { thrust: d(4, 1), swing: d(7, -1) }, // ST 39
  { thrust: d(4, 1), swing: d(7, -1) }, // ST 40
];

/** Published 5-point steps for ST 45-100 (B16). */
const HIGH_ST_STEPS: readonly (readonly [number, StDamage])[] = [
  [45, { thrust: d(5, 0), swing: d(7, 1) }],
  [50, { thrust: d(5, 2), swing: d(8, -1) }],
  [55, { thrust: d(6, 0), swing: d(8, 1) }],
  [60, { thrust: d(7, -1), swing: d(9, 0) }],
  [65, { thrust: d(7, 1), swing: d(9, 2) }],
  [70, { thrust: d(8, 0), swing: d(10, 0) }],
  [75, { thrust: d(8, 2), swing: d(10, 2) }],
  [80, { thrust: d(9, 0), swing: d(11, 0) }],
  [85, { thrust: d(9, 2), swing: d(11, 2) }],
  [90, { thrust: d(10, 0), swing: d(12, 0) }],
  [95, { thrust: d(10, 2), swing: d(12, 2) }],
  [100, { thrust: d(11, 0), swing: d(13, 0) }],
];

/**
 * Basic thrust/swing damage for a given ST.  ST below 1 is clamped to
 * the ST 1 row; between published high-ST rows, use the next lower row
 * (standard table reading).
 */
export function damageForSt(st: number): StDamage {
  const clamped = Math.max(1, Math.floor(st));
  if (clamped <= 40) {
    // biome-ignore lint/style/noNonNullAssertion: index is in [0, 39] by construction
    return DAMAGE_TABLE[clamped - 1]!;
  }
  if (clamped <= 100) {
    let row = DAMAGE_TABLE[39] as StDamage; // ST 40 fallback for 41-44
    for (const [threshold, dmg] of HIGH_ST_STEPS) {
      if (clamped >= threshold) row = dmg;
      else break;
    }
    return row;
  }
  // Above ST 100: +1d to thrust and swing per full 10 ST (B16).
  const extra = Math.floor((clamped - 100) / 10);
  const base = (HIGH_ST_STEPS[HIGH_ST_STEPS.length - 1] as [number, StDamage])[1];
  return {
    thrust: d(base.thrust.dice + extra, base.thrust.adds),
    swing: d(base.swing.dice + extra, base.swing.adds),
  };
}

/** Render dice as the conventional "2d-1" / "1d" / "3d+2" notation. */
export function formatDamageDice(dd: DamageDice): string {
  if (dd.adds === 0) return `${dd.dice}d`;
  return dd.adds > 0 ? `${dd.dice}d+${dd.adds}` : `${dd.dice}d${dd.adds}`;
}
