import type { EffectDuration } from '../schemas/encounter.ts';
import { formatRemaining, isExpired, isMaintenanceDue, roundsRemaining } from './effectDuration.ts';

/** Round-based effects can be evaluated deterministically from tracker state. */
export function isEffectExpired(
  duration: EffectDuration,
  startedAtRound: number,
  round: number,
): boolean {
  return isExpired(duration, startedAtRound, round);
}

export function needsMaintenance(
  maintenanceCost: number | null | undefined,
  lastMaintainedRound: number | null | undefined,
  startedAtRound: number,
  round: number,
): boolean {
  return (
    maintenanceCost !== null &&
    maintenanceCost !== undefined &&
    isMaintenanceDue(lastMaintainedRound ?? null, startedAtRound, round)
  );
}

export function effectRemainingLabel(
  duration: EffectDuration,
  startedAtRound: number,
  round: number,
): string {
  return formatRemaining(roundsRemaining(duration, startedAtRound, round));
}
