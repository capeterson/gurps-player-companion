import { normalizeCondition } from '../../../shared/domain/conditions.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { makeFlashKey } from '../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../sync/outbox.ts';

interface LinkedEffect {
  readonly linkedCondition: string | null;
  readonly linkedTempEffectId: string | null;
}

interface TargetCombatant {
  readonly characterId: string | null;
}

/**
 * Write access to the linked PC sheet, mirroring the server's character write
 * guard: the sheet's owner always, or campaign staff when GM editing is on.
 */
export interface SheetWriteAccess {
  readonly viewerId: string | undefined;
  readonly isStaff: boolean;
  readonly allowGmCharacterEditing: boolean;
}

function canWriteSheet(ownerId: string | undefined, access: SheetWriteAccess): boolean {
  if (!access.viewerId) return false;
  if (ownerId === access.viewerId) return true;
  return access.isStaff && access.allowGmCharacterEditing;
}

/**
 * Encounter state is online-only, but linked PC-sheet values are not. Keep
 * their cleanup on the normal Dexie/outbox path so it remains durable offline.
 *
 * The cleanup only runs when the viewer can actually write the target sheet.
 * Enqueuing outbox patches the sync write guard would reject (e.g. a GM clearing
 * another player's PC without GM editing) leaves the sheet stuck while claiming
 * it was cleared, so we skip those writes entirely.
 */
export async function cleanupLinkedSheetEffect(
  effect: LinkedEffect,
  target: TargetCombatant | undefined,
  access: SheetWriteAccess,
): Promise<void> {
  const characterId = target?.characterId;
  if (!characterId) return;
  const db = getLocalDb();
  const character = await db.characters.get(characterId);
  if (!canWriteSheet(character?.ownerId, access)) return;

  if (effect.linkedCondition) {
    const conditions = (await db.characterCombat.get(characterId))?.conditions;
    const linkedCondition = normalizeCondition(effect.linkedCondition);
    if (conditions?.some((condition) => normalizeCondition(condition) === linkedCondition)) {
      await enqueueFieldPatch({
        entityClass: 'character_combat',
        entityId: characterId,
        characterId,
        fieldPath: 'conditions',
        attemptedValue: conditions
          .map(normalizeCondition)
          .filter((condition) => condition !== linkedCondition),
        humanName: 'conditions',
        flashKey: makeFlashKey('character_combat', characterId, 'conditions'),
      });
    }
  }

  if (effect.linkedTempEffectId) {
    const effects = character?.tempEffects ?? [];
    if (character && effects.some((entry) => entry.id === effect.linkedTempEffectId)) {
      await enqueueFieldPatch({
        entityClass: 'character',
        entityId: characterId,
        fieldPath: 'tempEffects',
        attemptedValue: effects.filter((entry) => entry.id !== effect.linkedTempEffectId),
        humanName: 'temporary effects',
        flashKey: makeFlashKey('character', characterId, 'tempEffects'),
      });
    }
  }
}
