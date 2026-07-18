/**
 * Shared shape for "open the roll sheet for X" requests, passed down
 * from the combat tab to every card and up from RollableRow taps.
 */

import type { DamageDice } from '../../../../shared/constants/damage.ts';

export interface RollPreset {
  readonly label: string;
  /** Signed modifier this preset contributes to the roll's target. */
  readonly mod: number;
}

/** Payload turning a RollRequest into a damage roll (NdM+adds, no target). */
export interface DamageRollSpec {
  readonly dice: DamageDice;
  readonly damageType: string | null;
  readonly armorDivisor: string | null;
}

export interface RollRequest {
  readonly label: string;
  /** Ignored when `damage` is present. */
  readonly baseTarget: number;
  readonly presets?: readonly RollPreset[];
  /** Present => the sheet rolls damage dice instead of 3d6-vs-target. */
  readonly damage?: DamageRollSpec;
}
