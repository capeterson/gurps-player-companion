/**
 * Character / sub-resource save factory backed by the local Dexie
 * outbox.
 *
 * Replaces the prior fetch-on-blur pattern: every per-field save now
 * enqueues an outbox patch op that the orchestrator drains
 * asynchronously to /sync/operations.  The promise returned to
 * `useDraftField.onSave` resolves as soon as the local Dexie write +
 * outbox insert commit -- the user's edit is durable from that point
 * even if the network is offline or the server later rejects it.
 *
 * The orchestrator handles server rejections by:
 *   - reverting the local row to `prevValue` (captured by enqueue),
 *   - emitting a `flashBus` event keyed by entityId+fieldPath, and
 *   - pushing a persistent toast naming the field.
 *
 * `useCharacterFieldSave(id)` returns a factory; each invocation
 * yields a `{ onSave, flashKey }` pair to spread into a useDraftField
 * call.  Callers wire `flashKey` so the input animates back to the
 * authoritative value when the orchestrator reverts.
 */

import { useCallback } from 'react';
import type { EntityClass } from '../../../../shared/schemas/sync.ts';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';

export interface FieldSaver {
  readonly onSave: (value: unknown) => Promise<void>;
  readonly flashKey: string;
}

/**
 * Build a saver for the given parent character.  The optional
 * `entityClass` and `entityId` overrides let trait/skill/inventory
 * panels route per-field patches to their own row (where entityId is
 * the trait/skill/item id, not the character id).
 */
export function useCharacterFieldSave(characterId: string) {
  return useCallback(
    (
      field: string,
      opts?: {
        entityClass?: EntityClass | undefined;
        entityId?: string | undefined;
        humanName?: string | undefined;
      },
    ): FieldSaver => {
      const entityClass: EntityClass = opts?.entityClass ?? 'character';
      const entityId = opts?.entityId ?? characterId;
      const flashKey = makeFlashKey(entityClass, entityId, field);
      const onSave = async (value: unknown) => {
        await enqueueFieldPatch({
          entityClass,
          entityId,
          fieldPath: field,
          attemptedValue: value,
          humanName: opts?.humanName ?? field,
          flashKey,
          characterId: entityClass === 'character' ? undefined : characterId,
        });
      };
      return { onSave, flashKey };
    },
    [characterId],
  );
}

// ---------- legacy compat ----------
//
// The character sheet still imports `useFieldSaver` and
// `applyDetailToCache` / `characterDetailKey` from this module.  We
// keep the old names so existing call sites compile during the
// migration; callers should switch to the explicit
// `useCharacterFieldSave` flow which surfaces the flashKey.

/** @deprecated use {@link useCharacterFieldSave} which also returns a flashKey. */
export function useFieldSaver(id: string) {
  const build = useCharacterFieldSave(id);
  return useCallback(
    (field: string) => {
      const saver = build(field);
      return saver.onSave;
    },
    [build],
  );
}

// `applyDetailToCache` and `characterDetailKey` are no longer needed
// (TanStack Query no longer caches character detail -- Dexie does).
// Export shims so any straggling import compiles, but they are no-ops.

export function characterDetailKey(id: string) {
  return ['characters', id, 'detail'] as const;
}

export function applyDetailToCache(_qc: unknown, _id: string, _detail: unknown): void {
  /* no-op: Dexie + useLiveQuery is the source of truth now. */
}
