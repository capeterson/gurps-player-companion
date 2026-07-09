/**
 * Per-field patch helper for the `character_combat` entity, backed by
 * the local Dexie outbox. Shared by the in-sheet CombatPanel and the
 * CombatModal (and any future combat surface, e.g. Play Mode) so the
 * ensure-row + enqueue logic stays single-sourced.
 */

import { useCallback } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { getLocalDb } from '../../../db/dexie.ts';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';

/**
 * Combat is 1:1 keyed by characterId.  If a local row doesn't exist
 * yet (first edit on this device) we materialize a default row in
 * Dexie so the per-field patch has something to update; the
 * orchestrator's whole-body upsert handles the server side.
 */
export function useCombatPatch(
  character: CharacterDetail,
): (field: string, value: unknown) => Promise<void> {
  const characterId = character.id;
  const defaultHp = character.derived.hp;
  const defaultFp = character.derived.fp;

  return useCallback(
    async (field: string, value: unknown) => {
      const db = getLocalDb();
      const existing = await db.characterCombat.get(characterId);
      if (!existing) {
        await db.characterCombat.put({
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
        });
      }
      await enqueueFieldPatch({
        entityClass: 'character_combat',
        entityId: characterId,
        fieldPath: field,
        attemptedValue: value,
        humanName: field,
        flashKey: makeFlashKey('character_combat', characterId, field),
        characterId,
      });
    },
    [characterId, defaultHp, defaultFp],
  );
}
