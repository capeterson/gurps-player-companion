export const ROUNDS_PER_MINUTE = 60;
export const ROUNDS_PER_HOUR = 3600;
export type EffectDuration =
  | { unit: 'rounds' | 'minutes' | 'hours'; amount: number }
  | { unit: 'indefinite' };
export function durationInRounds(duration: EffectDuration) {
  return duration.unit === 'indefinite'
    ? null
    : duration.amount *
        (duration.unit === 'hours'
          ? ROUNDS_PER_HOUR
          : duration.unit === 'minutes'
            ? ROUNDS_PER_MINUTE
            : 1);
}
export function expiresAtRound(duration: EffectDuration, startedAtRound: number) {
  const n = durationInRounds(duration);
  return n === null ? null : startedAtRound + n;
}
export function isExpired(duration: EffectDuration, started: number, current: number) {
  const expiry = expiresAtRound(duration, started);
  return expiry !== null && current >= expiry;
}
export function roundsRemaining(duration: EffectDuration, started: number, current: number) {
  const expiry = expiresAtRound(duration, started);
  return expiry === null ? null : Math.max(0, expiry - current);
}
export function formatRemaining(rounds: number | null) {
  if (rounds === null) return 'until removed';
  if (rounds <= 0) return 'expired';
  if (rounds >= ROUNDS_PER_HOUR) return `~${Math.ceil(rounds / ROUNDS_PER_HOUR)} hr`;
  if (rounds >= ROUNDS_PER_MINUTE) return `~${Math.ceil(rounds / ROUNDS_PER_MINUTE)} min`;
  return `${rounds} rd${rounds === 1 ? '' : 's'}`;
}
export function maintenanceDueAtRound(last: number | null, started: number) {
  return (last ?? started) + ROUNDS_PER_MINUTE;
}
export function isMaintenanceDue(last: number | null, started: number, current: number) {
  return current >= maintenanceDueAtRound(last, started);
}
export function parseSpellDurationText(text: string): EffectDuration | null {
  const match = text
    .trim()
    .toLowerCase()
    .match(/\b(\d+)\s*(second|sec|round|minute|min|hour|hr)s?\b/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount < 1) return null;
  const unit = match[2];
  return unit === 'second' || unit === 'sec' || unit === 'round'
    ? { unit: 'rounds', amount }
    : unit === 'minute' || unit === 'min'
      ? { unit: 'minutes', amount }
      : { unit: 'hours', amount };
}
