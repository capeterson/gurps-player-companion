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
 * Encounter state is online-only, but linked PC-sheet values are not. Keep
 * their cleanup on the normal Dexie/outbox path so it remains durable offline.
 */
export async function cleanupLinkedSheetEffect(
  effect: LinkedEffect,
  target: TargetCombatant | undefined,
): Promise<void> {
  const characterId = target?.characterId;
  if (!characterId) return;
  const db = getLocalDb();

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
    const character = await db.characters.get(characterId);
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
