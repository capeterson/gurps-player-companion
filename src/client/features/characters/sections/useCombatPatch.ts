/** Shared local-first combat patch helper for the status panel and Combat tab. */
import { useCallback } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { type LocalCharacterCombat, getLocalDb } from '../../../db/dexie.ts';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import { enqueueFieldPatches } from '../../../sync/outbox.ts';

export type CombatFields = Readonly<Record<string, unknown>>;
/** Evaluated once against the latest local row inside the write transaction. */
export type CombatUpdate = (current: Readonly<LocalCharacterCombat>) => CombatFields;
export type CombatPatch = (
  field: string | CombatFields | CombatUpdate,
  value?: unknown,
  batchId?: string,
) => Promise<void>;

/**
 * Materialize, read and enqueue inside one transaction covering both stores.
 * The outbox's nested transaction uses this same scope. Absolute draft saves
 * and relative bumper changes serialize across all hook instances, so a bumper
 * reads the preceding local edit even before React renders it. Failure aborts
 * the entire gesture, including a newly materialized row.
 */
export function useCombatPatch(character: CharacterDetail): CombatPatch {
  const characterId = character.id;
  const defaultHp = character.derived.hp;
  const defaultFp = character.derived.fp;

  return useCallback(
    async (field: string | CombatFields | CombatUpdate, value?: unknown, batchId?: string) => {
      const db = getLocalDb();
      await db.transaction('rw', db.characterCombat, db.outbox, async () => {
        let current = await db.characterCombat.get(characterId);
        if (!current) {
          current = {
            id: characterId,
            characterId,
            currentHp: defaultHp,
            currentFp: defaultFp,
            conditions: [],
            maneuver: null,
            posture: 'standing',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revision: -1,
          };
          await db.characterCombat.add(current);
        }
        const fields =
          typeof field === 'function'
            ? field(current)
            : typeof field === 'string'
              ? { [field]: value }
              : field;
        await enqueueFieldPatches(
          Object.entries(fields).map(([key, attemptedValue]) => ({
            entityClass: 'character_combat',
            entityId: characterId,
            fieldPath: key,
            attemptedValue,
            humanName: key === 'currentHp' ? 'HP' : key === 'currentFp' ? 'FP' : key,
            flashKey: makeFlashKey('character_combat', characterId, key),
            characterId,
            batchId,
          })),
        );
      });
    },
    [characterId, defaultHp, defaultFp],
  );
}
