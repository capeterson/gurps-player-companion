/**
 * Temporary-effects list state machine for the Attributes/Secondary
 * panels. Owns the latest-intended-array ref for the same reason
 * `useConditionsToggle` does (see that hook's comments for the general
 * pattern): the whole `tempEffects` array is patched as ONE field
 * (S2/S3 -- raw array value, whole-array coalescing), so two rapid
 * mutations (bump ST in the popover, then add a named effect before
 * the first save round-trips through Dexie) must each compose against
 * the OTHER's just-enqueued result, not the same render-time
 * `character.tempEffects` snapshot -- otherwise the outbox's same-field
 * coalescing would replay the earlier tap's array over the later one
 * and silently drop it.
 *
 * Shared by every consumer that can mutate temp effects (both stat
 * panels, the effects list) via ONE hook instance lifted to
 * CharacterSheetPage and passed down as a prop -- calling this hook
 * more than once per character would give each call site its own ref,
 * reintroducing the exact race the ref exists to prevent.
 */

import { useEffect, useRef } from 'react';
import { sumTempMods } from '../../../../shared/domain/characterCalc.ts';
import {
  type CharacterDetail,
  MANUAL_TEMP_EFFECT_ID,
  type TempEffect,
  type TempStatAxis,
} from '../../../../shared/schemas/character.ts';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import { enqueueFieldPatch, newClientId } from '../../../sync/outbox.ts';

/** The per-axis modifier bag of one effect. Zod-inferred, so optional
 * axes admit an explicit `undefined` -- which is what makes it (and not
 * `Partial<Record<TempStatAxis, number>>`) assignable under
 * exactOptionalPropertyTypes. */
export type TempEffectMods = TempEffect['mods'];

export interface TempEffectsApi {
  /** Render from this (Dexie-backed via the character prop), same as today. */
  readonly effects: readonly TempEffect[];
  /** Per-axis sum across every effect -- see `sumTempMods`. */
  readonly totals: Record<TempStatAxis, number>;
  /** Shared flash key for every temp-effect-driven control (they all
   * patch the same `tempEffects` field). */
  readonly flashKey: string;
  /**
   * Upsert/trim the reserved 'manual' effect's axis value. Removes the
   * manual entry entirely once all of its axes are 0/absent. Returns
   * the enqueue promise (resolves once the Dexie write + outbox insert
   * commit) so callers that need to await it -- mainly tests -- can;
   * UI call sites fire-and-forget it like every other outbox mutation.
   */
  setManualAxis(axis: TempStatAxis, value: number): Promise<void>;
  /** Append a new named effect with a client-generated id. */
  addEffect(name: string, mods: TempEffectMods): Promise<void>;
  /** Remove one effect (named or manual) by id. */
  removeEffect(id: string): Promise<void>;
  /** Replace the whole list with `[]` in a single patch -- this is the
   * "revert all temporary buffs" gesture. */
  clearAll(): Promise<void>;
}

/**
 * `character` is nullable so this hook can be called unconditionally
 * before CharacterSheetPage's loading/not-found early returns (Rules
 * of Hooks -- see the `useCharacterAccessLocal` call site it sits next
 * to for the same shape). While loading, `characterId` is `''` and
 * every mutator is a no-op (mirrors `canWrite=false`).
 */
export function useTempEffects(
  character: CharacterDetail | null | undefined,
  canWrite: boolean,
): TempEffectsApi {
  const characterId = character?.id ?? '';
  const effects = character?.tempEffects ?? [];
  const flashKey = makeFlashKey('character', characterId, 'tempEffects');
  const canMutate = canWrite && character != null;

  const effectsRef = useRef(effects);
  useEffect(() => {
    effectsRef.current = effects;
  }, [effects]);

  function commit(next: TempEffect[]): Promise<void> {
    effectsRef.current = next;
    return enqueueFieldPatch({
      entityClass: 'character',
      entityId: characterId,
      fieldPath: 'tempEffects',
      attemptedValue: next,
      humanName: 'temporary effects',
      flashKey,
    });
  }

  function setManualAxis(axis: TempStatAxis, value: number): Promise<void> {
    if (!canMutate) return Promise.resolve();
    const current = effectsRef.current;
    const manual = current.find((e) => e.id === MANUAL_TEMP_EFFECT_ID);
    const nextMods: TempEffectMods = { ...manual?.mods };
    if (value === 0) delete nextMods[axis];
    else nextMods[axis] = value;
    const withoutManual = current.filter((e) => e.id !== MANUAL_TEMP_EFFECT_ID);
    const hasAnyMod = Object.keys(nextMods).length > 0;
    const next = hasAnyMod
      ? [...withoutManual, { id: MANUAL_TEMP_EFFECT_ID, name: 'Manual adjustment', mods: nextMods }]
      : withoutManual;
    return commit(next);
  }

  function addEffect(name: string, mods: TempEffectMods): Promise<void> {
    if (!canMutate) return Promise.resolve();
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve();
    const next = [...effectsRef.current, { id: newClientId(), name: trimmed, mods }];
    return commit(next);
  }

  function removeEffect(id: string): Promise<void> {
    if (!canMutate) return Promise.resolve();
    const next = effectsRef.current.filter((e) => e.id !== id);
    return commit(next);
  }

  function clearAll(): Promise<void> {
    if (!canMutate) return Promise.resolve();
    if (effectsRef.current.length === 0) return Promise.resolve();
    return commit([]);
  }

  return {
    effects,
    totals: sumTempMods(effects),
    flashKey,
    setManualAxis,
    addEffect,
    removeEffect,
    clearAll,
  };
}
