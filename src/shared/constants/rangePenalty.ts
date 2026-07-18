/**
 * Standard speed/range penalty table (GURPS 4e, B550), used as roll
 * presets for ranged attacks in the combat UI — reference data only,
 * like `hitLocations.ts`. Steps beyond 200 yd exist in the book
 * (−13 … −18 out to 3 mi) but are omitted: past-200-yd shots are rare
 * at the table and the preset list is already long.
 */

export interface RangePenaltyStep {
  /** Upper bound of the band, in yards. */
  readonly maxYards: number;
  readonly penalty: number;
}

export const RANGE_PENALTY_STEPS: readonly RangePenaltyStep[] = [
  { maxYards: 2, penalty: 0 },
  { maxYards: 3, penalty: -1 },
  { maxYards: 5, penalty: -2 },
  { maxYards: 7, penalty: -3 },
  { maxYards: 10, penalty: -4 },
  { maxYards: 15, penalty: -5 },
  { maxYards: 20, penalty: -6 },
  { maxYards: 30, penalty: -7 },
  { maxYards: 50, penalty: -8 },
  { maxYards: 70, penalty: -9 },
  { maxYards: 100, penalty: -10 },
  { maxYards: 150, penalty: -11 },
  { maxYards: 200, penalty: -12 },
] as const;
