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
 *
 * Atomicity guarantee: the missing-row check and the default-row
 * creation happen inside one Dexie `rw` transaction on
 * `characterCombat`, and use `add` (never `put`) so a second,
 * interleaved call can't recreate the row out from under the first.
 * Without this, two rapid edits to different fields on a
 * not-yet-materialized row could both pass the "does it exist" check
 * before either write lands; the second `put` would then overwrite
 * the whole row back to defaults, silently reverting the first edit's
 * field even though its outbox op is still pending. The transaction
 * makes the two checks serialize, and `add` throws a `ConstraintError`
 * (caught and ignored below) if a pathological double-create still
 * slips through, so the ensure-row step can never clobber an existing
 * row. This transaction MUST complete before `enqueueFieldPatch` is
 * called -- not wrap it -- because Dexie transactions don't nest
 * safely across overlapping stores; the two stay sequential.
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
      await db.transaction('rw', db.characterCombat, async () => {
        const existing = await db.characterCombat.get(characterId);
        if (!existing) {
          try {
            await db.characterCombat.add({
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
          } catch (err) {
            // Belt-and-braces: if two interleaved calls both observed a
            // missing row, only one `add` can win -- the loser hits a
            // ConstraintError on the duplicate primary key. That's fine;
            // the winner's row is already in place. Anything else rethrows.
            if (!(err instanceof Error) || err.name !== 'ConstraintError') {
              throw err;
            }
          }
        }
      });
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
