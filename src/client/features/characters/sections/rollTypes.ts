/**
 * Shared shape for "open the roll sheet for X" requests, passed down
 * from the combat tab to every card and up from RollableRow taps.
 */

export interface RollPreset {
  readonly label: string;
  /** Signed modifier this preset contributes to the roll's target. */
  readonly mod: number;
}

export interface RollRequest {
  readonly label: string;
  readonly baseTarget: number;
  readonly presets?: readonly RollPreset[];
}
