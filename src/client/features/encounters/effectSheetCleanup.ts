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
    const character = await db.characters.get(characterId);
    await db.transaction('rw', db.characterCombat, async () => {
      if (await db.characterCombat.get(characterId)) return;
      await db.characterCombat.add({
        id: characterId,
        characterId,
        currentHp: (character?.st ?? 10) + (character?.hpMod ?? 0),
        currentFp: (character?.ht ?? 10) + (character?.fpMod ?? 0),
        conditions: [],
        maneuver: null,
        posture: 'standing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: -1,
      });
    });
    const conditions = (await db.characterCombat.get(characterId))?.conditions ?? [];
    if (conditions.includes(effect.linkedCondition)) {
      await enqueueFieldPatch({
        entityClass: 'character_combat',
        entityId: characterId,
        characterId,
        fieldPath: 'conditions',
        attemptedValue: conditions.filter((condition) => condition !== effect.linkedCondition),
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
