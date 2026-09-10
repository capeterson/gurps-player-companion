/** Mandatory combat-state adjustments (B365-366, B419, B426, B551).
 * Halve current Dodge after encumbrance; DB and situational roll modifiers
 * apply afterward (B374 distinguishes Dodge score from bonuses to its roll).
 * Reeling is a manual condition; only actual pools trigger numerical halving.
 */
import type { Posture } from '../constants/combat.ts';
import { conditionsInclude, normalizeCondition } from './conditions.ts';

export type DefenseKind = 'dodge' | 'parry' | 'block';
export type AllOutDefenseOption = DefenseKind | 'double' | null;
export interface CombatAdjustmentInput {
  hp: number;
  maxHp: number;
  fp: number;
  maxFp: number;
  posture: Posture;
  conditions: readonly string[];
  maneuver: string | null;
}

export function combatAdjustments(input: CombatAdjustmentInput) {
  const lowHp = input.maxHp > 0 && input.hp * 3 < input.maxHp;
  const lowFp = input.maxFp > 0 && input.fp * 3 < input.maxFp;
  const poolDivisor = (lowHp ? 2 : 1) * (lowFp ? 2 : 1);
  const stunned = conditionsInclude(input.conditions, 'stunned');
  const unconscious =
    conditionsInclude(input.conditions, 'unconscious') ||
    conditionsInclude(input.conditions, 'sleeping') ||
    (input.maxFp > 0 && input.fp <= -input.maxFp);
  const maneuver = normalizeCondition(input.maneuver ?? '').replaceAll('-', '_');
  const posturePenalty = ['prone', 'lying', 'crawling'].includes(input.posture)
    ? -3
    : ['kneeling', 'sitting'].includes(input.posture)
      ? -2
      : 0;
  const defensePenalty = posturePenalty + (stunned ? -4 : 0);
  const unavailable = unconscious
    ? 'Unconscious or asleep: no active defenses'
    : maneuver === 'all_out_attack'
      ? 'All-Out Attack: no active defenses'
      : null;
  const parryUnavailable =
    unavailable ?? (maneuver === 'move_and_attack' ? 'Move and Attack: no parry' : null);
  const allOutDefense = maneuver === 'all_out_defense';
  const notes: string[] = [];
  if (lowHp) notes.push('HP below one-third: halve Move and Dodge');
  if (lowFp) notes.push('FP below one-third: halve Move, Dodge, and usable ST');
  if (poolDivisor > 1)
    notes.push('Round pool reductions up after encumbrance; add DB and roll modifiers afterward');
  if (posturePenalty) notes.push(`${input.posture}: ${posturePenalty} to defenses`);
  if (stunned) notes.push('Stunned: −4 to defenses; no movement or retreat');
  if (unavailable) notes.push(unavailable);
  if (maneuver === 'all_out_attack') notes.push('Movement is half Move, forward only');
  if (maneuver === 'move_and_attack') notes.push('Move and Attack: no parry or retreat');
  if (allOutDefense)
    notes.push('All-Out Defense: choose +2 to one defense, or two different defenses');

  return {
    lowHp,
    lowFp,
    poolDivisor,
    stunned,
    unconscious,
    maneuver,
    allOutDefense,
    notes,
    defense(
      kind: DefenseKind,
      score: number,
      option: AllOutDefenseOption = null,
      rollBonus = 0,
    ): number | null {
      if (kind === 'parry' ? parryUnavailable : unavailable) return null;
      const poolScore =
        kind === 'dodge' && poolDivisor > 1 ? Math.max(1, Math.ceil(score / poolDivisor)) : score;
      return poolScore + rollBonus + defensePenalty + (allOutDefense && option === kind ? 2 : 0);
    },
    reason(kind: DefenseKind) {
      return kind === 'parry' ? parryUnavailable : unavailable;
    },
    strength(st: number) {
      return lowFp ? Math.ceil(st / 2) : st;
    },
    movement(score: number, option: AllOutDefenseOption = null) {
      let move = score > 0 && poolDivisor > 1 ? Math.max(1, Math.ceil(score / poolDivisor)) : score;
      if (input.posture === 'sitting' || stunned || unconscious) return 0;
      if (input.posture === 'prone' || input.posture === 'lying') move = Math.min(move, 1);
      if (input.posture === 'kneeling' || input.posture === 'crawling')
        move = move > 0 ? Math.max(1, Math.floor(move / 3)) : 0;
      if (input.posture === 'crouching')
        move = move > 0 ? Math.max(1, Math.floor((move * 2) / 3)) : 0;
      if (maneuver === 'do_nothing' || maneuver === 'change_posture') return 0;
      if (maneuver === 'all_out_attack' || (allOutDefense && option === 'dodge'))
        return Math.ceil(move / 2);
      if (
        allOutDefense ||
        ['aim', 'evaluate', 'attack', 'feint', 'concentrate', 'ready', 'wait'].includes(maneuver)
      )
        return Math.min(move, Math.max(1, Math.ceil(move / 10)));
      return move;
    },
  };
}
