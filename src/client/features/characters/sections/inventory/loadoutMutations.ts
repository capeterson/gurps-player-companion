/** Local-first loadout writes. Every change goes through the outbox (S1). */
import {
  type PlannedSwitch,
  type SortableLoadout,
  loadoutMoveUpdates,
  planLastEquippedRestore,
  planLoadoutSwitch,
} from '../../../../../shared/domain/loadouts.ts';
import { getLocalDb } from '../../../../db/dexie.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueEquipmentSwitch,
  enqueueFieldPatch,
  enqueueFieldPatches,
  newClientId,
} from '../../../../sync/outbox.ts';

export async function createLoadout(
  characterId: string,
  input: { name: string; itemIds: string[]; sortOrder: number },
): Promise<string> {
  const id = newClientId();
  await enqueueCreate({
    entityClass: 'character_loadout',
    entityId: id,
    characterId,
    attemptedValue: { ...input, characterId },
    humanName: `Loadout ${input.name}`,
  });
  return id;
}

export function renameLoadout(characterId: string, id: string, name: string) {
  return enqueueFieldPatch({
    entityClass: 'character_loadout',
    entityId: id,
    characterId,
    fieldPath: 'name',
    attemptedValue: name,
    humanName: 'Loadout name',
    flashKey: makeFlashKey('character_loadout', id, 'name'),
  });
}

/**
 * Check or uncheck one item. Read/modify/write runs in one IndexedDB
 * transaction so rapid toggles never drop an earlier check, and ids of
 * deleted items are pruned on the way.
 */
export async function setLoadoutItem(id: string, itemId: string, included: boolean) {
  const db = getLocalDb();
  await db.transaction('rw', [db.characterLoadouts, db.characterInventory, db.outbox], async () => {
    const loadout = await db.characterLoadouts.get(id);
    if (!loadout) throw new Error('This loadout no longer exists');
    const existing = new Set(
      (
        await db.characterInventory.where('characterId').equals(loadout.characterId).primaryKeys()
      ).map(String),
    );
    const kept = loadout.itemIds.filter((entry) => entry !== itemId && existing.has(entry));
    await enqueueFieldPatch({
      entityClass: 'character_loadout',
      entityId: id,
      characterId: loadout.characterId,
      fieldPath: 'itemIds',
      attemptedValue: included ? [...kept, itemId] : kept,
      humanName: `${loadout.name}: items`,
      flashKey: makeFlashKey('character_loadout', id, 'itemIds'),
    });
  });
}

export function moveLoadout(
  characterId: string,
  sorted: readonly SortableLoadout[],
  from: number,
  to: number,
) {
  return enqueueFieldPatches(
    loadoutMoveUpdates(sorted, from, to).map((update) => ({
      entityClass: 'character_loadout' as const,
      entityId: update.id,
      characterId,
      fieldPath: 'sortOrder',
      attemptedValue: update.sortOrder,
      humanName: 'Loadout order',
      flashKey: makeFlashKey('character_loadout', update.id, 'sortOrder'),
    })),
  );
}

export function deleteLoadout(characterId: string, id: string, name: string) {
  return enqueueDelete({
    entityClass: 'character_loadout',
    entityId: id,
    characterId,
    humanName: `Loadout ${name}`,
  });
}

export function equipLoadout(
  characterId: string,
  loadout: { id: string; name: string; itemIds: readonly string[] },
): Promise<PlannedSwitch> {
  return enqueueEquipmentSwitch({
    characterId,
    humanName: `Equip ${loadout.name}`,
    plan: (items, current) => planLoadoutSwitch(items, loadout, current, new Date().toISOString()),
  });
}

export function restoreLastEquipped(characterId: string): Promise<PlannedSwitch> {
  return enqueueEquipmentSwitch({
    characterId,
    humanName: 'Restore Last Equipped',
    plan: (items, current) => {
      if (!current) throw new Error('There is no Last Equipped loadout to restore');
      return planLastEquippedRestore(items, current, new Date().toISOString());
    },
  });
}
