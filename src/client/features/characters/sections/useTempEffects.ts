/**
 * Temporary-effects state machine for the Attributes/Secondary panels.
 * Owns the latest-intended-array ref for the same reason
 * `useConditionsToggle` does (see that hook's comments for the general
 * pattern): the whole `tempEffects` array is patched as ONE field
 * (S2/S3 -- raw array value, whole-array coalescing), so two rapid
 * mutations (bump ST in one popover, then bump HT in another before
 * the first save round-trips through Dexie) must each compose against
 * the OTHER's just-enqueued result, not the same render-time
 * `character.tempEffects` snapshot -- otherwise the outbox's same-field
 * coalescing would replay the earlier tap's array over the later one
 * and silently drop it.
 *
 * Shared by every consumer that can mutate temp effects (both stat
 * panels) via ONE hook instance lifted to CharacterSheetPage and passed
 * down as a prop -- calling this hook more than once per character
 * would give each call site its own ref, reintroducing the exact race
 * the ref exists to prevent.
 */

import { useEffect, useRef } from 'react';
import type { z } from 'zod';
import { sumTempMods } from '../../../../shared/domain/characterCalc.ts';
import {
  type CharacterDetail,
  MANUAL_TEMP_EFFECT_ID,
  TEMP_AXIS_LABELS,
  type TempEffect,
  type TempStatAxis,
  tempEffectsField,
} from '../../../../shared/schemas/character.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { flashBus, makeFlashKey } from '../../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';

/** The per-axis modifier bag of one effect. Zod-inferred, so optional
 * axes admit an explicit `undefined` -- which is what makes it (and not
 * `Partial<Record<TempStatAxis, number>>`) assignable under
 * exactOptionalPropertyTypes. */
export type TempEffectMods = TempEffect['mods'];

/**
 * Turn a `tempEffectsField.safeParse` failure into a short, human
 * message for the "Couldn't save temporary effects — …" toast. Only
 * special-cases the per-axis ±50 cap (`superRefine` in
 * `tempEffectsField`) since that's the constraint an offline rapid-tap
 * gesture is realistically going to hit; anything else (duplicate id,
 * max-40-effects) falls back to the raw zod issue message rather than
 * building out a full message catalog for constraints a UI gesture
 * can't actually trigger.
 */
function describeTempEffectsFailure(error: z.ZodError): string {
  const capIssue = error.issues.find((i) => /^combined \w+ modifier/.test(i.message));
  if (capIssue) {
    const axis = /^combined (\w+) modifier/.exec(capIssue.message)?.[1] as TempStatAxis | undefined;
    const label = axis ? (TEMP_AXIS_LABELS[axis] ?? axis) : 'a stat';
    return `exceed the ±50 cap for ${label}`;
  }
  return error.issues[0]?.message ?? 'invalid temporary effects';
}

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
  const toasts = useToasts();

  const effectsRef = useRef(effects);
  useEffect(() => {
    effectsRef.current = effects;
  }, [effects]);

  /**
   * Shared commit path for every mutator below. Validates `next`
   * against `tempEffectsField` (the same schema the server enforces --
   * per-axis ±50 sums, max 40 effects, unique ids) BEFORE writing to
   * Dexie or the outbox (PR #46 review finding: an offline user could
   * previously stack rapid-tap boosts past the ±50 cap and live with
   * invalid derived stats until the server rejected the patch much
   * later). On failure we do NOT touch `effectsRef` or Dexie -- the
   * rejected mutation is discarded entirely, mirroring how
   * `useDraftField`'s `rollback` treats a parse/validate failure
   * (immediate UX, no outbox involvement). Because this hook doesn't
   * own the rendering component's flash state (it's shared across every
   * temp-effect surface via `flashKey`), we go through `flashBus.emit`
   * the same way the orchestrator does for an async server rejection,
   * rather than a local `useFlashState` trigger.
   */
  function commit(next: TempEffect[]): Promise<void> {
    const result = tempEffectsField.safeParse(next);
    if (!result.success) {
      const reason = describeTempEffectsFailure(result.error);
      toasts.push(`Couldn't save temporary effects — ${reason}`, { kind: 'error' });
      flashBus.emit({ key: flashKey, reason });
      return Promise.resolve();
    }
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
    clearAll,
  };
}
