/**
 * Conditions-array toggle state machine, shared by PoolsCard (Play
 * Mode) and CombatModal (the full sheet's FAB tracker). Owns the
 * latest-intended-value ref for the same reason usePoolBumpers owns
 * one for HP/FP — see that hook's comments for the general pattern.
 *
 * Posture is single-valued (last write wins) and needs no such ref;
 * only the conditions *array* is at risk of a compose-against-stale-
 * snapshot race, because two chip taps compute `toggleCondition`
 * against the same render-time array.
 */

import { useEffect, useRef } from 'react';
import { toggleCondition } from '../../../../shared/domain/conditions.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';

export interface ConditionsToggle {
  /** Render from this (Dexie-backed via the character prop), same as today. */
  readonly conditions: readonly string[];
  readonly toggle: (id: string) => void;
}

export function useConditionsToggle(
  character: CharacterDetail,
  canWrite: boolean,
  patchCombat: (field: string, value: unknown) => Promise<void>,
): ConditionsToggle {
  const conditions = character.combat?.conditions ?? [];

  // Latest-intended conditions array, updated synchronously on every
  // toggle tap. Without this ref, two chip taps that fire before
  // Dexie's write round-trips back into a new `character` prop would
  // both call `toggleCondition(conditions, id)` against the SAME
  // render-time array — e.g. tapping Stunned then Bleeding from an
  // empty array would enqueue ['stunned'] and then ['bleeding'], and
  // because the outbox coalesces same-field patches (S3: same
  // `${entityId}|${fieldPath}` key replaces the pending op), the
  // second patch overwrites the first and the Stunned toggle is
  // silently dropped. Composing against the ref instead of the prop
  // makes each tap see the previous tap's intended result. The ref
  // resyncs from the prop whenever Dexie surfaces a new value (a
  // remote change, or this component's own write landing).
  const conditionsRef = useRef(conditions);
  useEffect(() => {
    conditionsRef.current = conditions;
  }, [conditions]);

  function toggle(id: string) {
    if (!canWrite) return;
    const next = toggleCondition(conditionsRef.current, id);
    conditionsRef.current = next;
    void patchCombat('conditions', next);
  }

  return { conditions, toggle };
}
