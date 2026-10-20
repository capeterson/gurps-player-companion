import { z } from 'zod';
import { isoTimestamp, revision, timestamps, uuid } from './common.ts';

export const LOADOUT_NAME_MAX = 80;
export const LOADOUT_ITEM_MAX = 1000;
export const LOADOUTS_PER_CHARACTER = 50;
export const EQUIPMENT_SWITCH_CHANGE_MAX = 2000;

function uniqueIds(ids: readonly string[], ctx: z.RefinementCtx, label: string) {
  const seen = new Set<string>();
  for (const id of ids) {
    const key = id.toLowerCase();
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate ${label}` });
    seen.add(key);
  }
}

/**
 * `character_loadouts.item_ids`: the inventory rows a loadout equips. Ids of
 * deleted items may remain until the next checklist edit; readers ignore them.
 */
export const loadoutItemIds = z
  .array(uuid)
  .max(LOADOUT_ITEM_MAX)
  .superRefine((ids, ctx) => uniqueIds(ids, ctx, 'loadout item'));

const loadoutName = z.string().trim().min(1).max(LOADOUT_NAME_MAX);

export const loadoutCreate = z.object({
  name: loadoutName,
  itemIds: loadoutItemIds.default([]),
  /** Manual menu order; a move writes the midpoint between its neighbours. */
  sortOrder: z.number().finite().default(0),
});

export const loadoutUpdate = z.object({
  name: loadoutName.optional(),
  itemIds: loadoutItemIds.optional(),
  sortOrder: z.number().finite().optional(),
});

export const loadoutOut = z.object({
  id: uuid,
  characterId: uuid,
  name: z.string(),
  itemIds: z.array(uuid),
  sortOrder: z.number(),
  ...timestamps,
  revision,
});

/** The four inventory fields an equipment switch may change on one item. */
export const inventorySwitchState = z
  .object({
    equipped: z.boolean(),
    worn: z.boolean(),
    parentId: uuid.nullable(),
    externalLocation: z.string().max(160).nullable(),
  })
  .strict();

export const equipmentSwitchChange = z
  .object({ itemId: uuid, before: inventorySwitchState, after: inventorySwitchState })
  .strict();

/**
 * `characters.last_equipment_switch`: the most recent loadout switch. It is the
 * Last Equipped loadout (restore returns `previousEquippedIds` and each change's
 * `before` location), the remembered active loadout and the switch's rollback
 * journal. Null until the character first equips a loadout.
 */
export const equipmentSwitch = z
  .object({
    kind: z.enum(['loadout', 'restore']),
    activeLoadoutId: uuid.nullable(),
    /** Names as equipped, for history and for a loadout deleted since. */
    activeLoadoutName: z.string().max(LOADOUT_NAME_MAX).nullable(),
    previousActiveLoadoutId: uuid.nullable(),
    previousActiveLoadoutName: z.string().max(LOADOUT_NAME_MAX).nullable(),
    switchedAt: isoTimestamp,
    previousEquippedIds: z.array(uuid).max(EQUIPMENT_SWITCH_CHANGE_MAX),
    changes: z.array(equipmentSwitchChange).max(EQUIPMENT_SWITCH_CHANGE_MAX),
  })
  .strict()
  .superRefine((value, ctx) => {
    uniqueIds(value.previousEquippedIds, ctx, 'previously equipped item');
    uniqueIds(
      value.changes.map((change) => change.itemId),
      ctx,
      'switched item',
    );
  });

export const characterLoadoutsOut = z.object({
  loadouts: z.array(loadoutOut),
  lastEquipmentSwitch: equipmentSwitch.nullable(),
});

export type LoadoutCreate = z.infer<typeof loadoutCreate>;
export type LoadoutUpdate = z.infer<typeof loadoutUpdate>;
export type LoadoutOut = z.infer<typeof loadoutOut>;
export type InventorySwitchState = z.infer<typeof inventorySwitchState>;
export type EquipmentSwitchChange = z.infer<typeof equipmentSwitchChange>;
export type EquipmentSwitch = z.infer<typeof equipmentSwitch>;
export type CharacterLoadoutsOut = z.infer<typeof characterLoadoutsOut>;
