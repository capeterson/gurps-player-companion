/**
 * Shared submit/creating/toast mechanics behind AddSkillForm,
 * AddSpellForm, and AddTraitForm. Each panel keeps its own per-field
 * `useState` and JSX layout (they differ: skills have attribute/
 * difficulty, spells have college/baseEnergyCost, traits have kind/
 * modifiers) — this hook only captures the part that was verbatim
 * duplicated:
 *
 *   1. set `creating` true,
 *   2. `enqueueCreate` the entity,
 *   3. on success, run the caller's `onCreated` callback — per
 *      AGENTS.md rule 1, that callback must only clear a field whose
 *      *current* value still matches the value that was submitted,
 *      using the functional `setX(cur => ...)` form so the comparison
 *      runs against live state at completion time rather than a
 *      stale closure (the race-safe style; SkillsPanel/TraitsPanel
 *      used to compare against a closure-captured variable instead —
 *      normalized here to the one safe implementation),
 *   4. on failure, toast `Couldn't add ${label} — ${reason}`,
 *   5. always clear `creating`.
 */

import { useCallback, useState } from 'react';
import type { EntityClass } from '../../../../shared/schemas/sync.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { enqueueCreate, newClientId } from '../../../sync/outbox.ts';

export interface UseAddEntityFormOptions {
  readonly entityClass: EntityClass;
  readonly characterId: string;
  /** e.g. 'skill' — used as enqueueCreate's humanName and in the error toast. */
  readonly label: string;
}

export interface UseAddEntityFormReturn {
  readonly creating: boolean;
  /**
   * Create the entity from `attemptedValue`. On success, `onCreated`
   * runs before `creating` is cleared — callers use it to reset their
   * per-field draft state with the functional-setter snapshot guard.
   */
  readonly submit: (
    attemptedValue: Record<string, unknown>,
    onCreated: () => void,
  ) => Promise<void>;
}

export function useAddEntityForm({
  entityClass,
  characterId,
  label,
}: UseAddEntityFormOptions): UseAddEntityFormReturn {
  const toasts = useToasts();
  const [creating, setCreating] = useState(false);

  const submit = useCallback(
    async (attemptedValue: Record<string, unknown>, onCreated: () => void) => {
      setCreating(true);
      try {
        await enqueueCreate({
          entityClass,
          entityId: newClientId(),
          humanName: label,
          characterId,
          attemptedValue,
        });
        onCreated();
      } catch (err) {
        toasts.push(`Couldn't add ${label} — ${(err as Error).message}`, { kind: 'error' });
      } finally {
        setCreating(false);
      }
    },
    [entityClass, characterId, label, toasts],
  );

  return { creating, submit };
}
