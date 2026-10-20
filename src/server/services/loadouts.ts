/**
 * Equipment loadouts. REST routes and the /sync dispatcher share these
 * services, so both doors apply the same authorization, referential checks
 * and switch validation (AGENTS.md S12). Callers have already established
 * write access; each service takes the character's inventory tree lock.
 */
import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  type LoadoutInventoryItem,
  type PlannedSwitch,
  equipmentSwitchProblem,
  nextLoadoutSortOrder,
  planLastEquippedRestore,
  planLoadoutSwitch,
} from '../../shared/domain/loadouts.ts';
import {
  type EquipmentSwitch,
  LOADOUTS_PER_CHARACTER,
  type LoadoutCreate,
  type LoadoutOut,
  type LoadoutUpdate,
  equipmentSwitch,
  loadoutOut,
} from '../../shared/schemas/loadout.ts';
import type { AuditTx } from '../db/auditContext.ts';
import {
  type DbCharacterLoadout,
  characterLoadouts,
  characters,
  inventoryItems,
} from '../db/schema.ts';
import { enforceEquippedOnPlayer } from './inventoryContainment.ts';
import { lockLibraryReferenceScope } from './libraryReferences.ts';

export function loadoutRowOut(row: DbCharacterLoadout): LoadoutOut {
  return loadoutOut.parse({
    ...row,
    revision: Number(row.revision),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function listLoadouts(tx: Pick<AuditTx, 'select'>, characterId: string) {
  const rows = await tx
    .select()
    .from(characterLoadouts)
    .where(eq(characterLoadouts.characterId, characterId))
    .orderBy(asc(characterLoadouts.sortOrder), asc(characterLoadouts.name));
  return rows.map(loadoutRowOut);
}

/** Every existing id must be an inventory item of this character. Unknown ids
 * may be items deleted concurrently; readers ignore them. */
async function assertLoadoutItemsBelong(tx: AuditTx, characterId: string, itemIds: string[]) {
  if (itemIds.length === 0) return;
  const [foreign] = await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        inArray(
          inventoryItems.id,
          itemIds.map((id) => id.toLowerCase()),
        ),
        ne(inventoryItems.characterId, characterId),
      ),
    )
    .limit(1);
  if (foreign)
    throw new HTTPException(400, { message: 'Loadout items must belong to this character' });
}

export async function createLoadout(
  tx: AuditTx,
  userId: string,
  characterId: string,
  body: LoadoutCreate,
  id?: string,
): Promise<DbCharacterLoadout> {
  await lockLibraryReferenceScope(tx, characterId, userId);
  const existing = await tx
    .select({ id: characterLoadouts.id })
    .from(characterLoadouts)
    .where(eq(characterLoadouts.characterId, characterId));
  if (existing.length >= LOADOUTS_PER_CHARACTER)
    throw new HTTPException(400, {
      message: `A character can have at most ${LOADOUTS_PER_CHARACTER} loadouts`,
    });
  await assertLoadoutItemsBelong(tx, characterId, body.itemIds);
  const [created] = await tx
    .insert(characterLoadouts)
    .values({
      ...(id ? { id } : {}),
      characterId,
      name: body.name,
      itemIds: body.itemIds.map((itemId) => itemId.toLowerCase()),
      sortOrder: body.sortOrder,
    })
    .returning();
  if (!created) throw new HTTPException(500, { message: 'insert failed' });
  return created;
}

/** Default sort order for REST creates that omit one: after every loadout. */
export async function appendedSortOrder(tx: Pick<AuditTx, 'select'>, characterId: string) {
  const rows = await tx
    .select({
      id: characterLoadouts.id,
      name: characterLoadouts.name,
      sortOrder: characterLoadouts.sortOrder,
    })
    .from(characterLoadouts)
    .where(eq(characterLoadouts.characterId, characterId));
  return nextLoadoutSortOrder(rows);
}

/** Validate a loadout patch. Returns the column updates to apply. */
export async function prepareLoadoutUpdate(
  tx: AuditTx,
  userId: string,
  characterId: string,
  body: LoadoutUpdate,
): Promise<Record<string, unknown>> {
  await lockLibraryReferenceScope(tx, characterId, userId);
  if (body.itemIds) await assertLoadoutItemsBelong(tx, characterId, body.itemIds);
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.itemIds !== undefined) updates.itemIds = body.itemIds.map((id) => id.toLowerCase());
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
  return updates;
}

export async function updateLoadout(
  tx: AuditTx,
  userId: string,
  characterId: string,
  loadoutId: string,
  body: LoadoutUpdate,
): Promise<DbCharacterLoadout | undefined> {
  const updates = await prepareLoadoutUpdate(tx, userId, characterId, body);
  const [updated] = await tx
    .update(characterLoadouts)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(characterLoadouts.id, loadoutId), eq(characterLoadouts.characterId, characterId)))
    .returning();
  return updated;
}

export async function deleteLoadout(
  tx: AuditTx,
  characterId: string,
  loadoutId: string,
): Promise<boolean> {
  const removed = await tx
    .delete(characterLoadouts)
    .where(and(eq(characterLoadouts.id, loadoutId), eq(characterLoadouts.characterId, characterId)))
    .returning({ id: characterLoadouts.id });
  return removed.length > 0;
}

async function readSwitchInventory(
  tx: AuditTx,
  characterId: string,
): Promise<LoadoutInventoryItem[]> {
  return tx
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      parentId: inventoryItems.parentId,
      worn: inventoryItems.worn,
      externalLocation: inventoryItems.externalLocation,
      equipped: inventoryItems.equipped,
      quantity: inventoryItems.quantity,
      isContainer: inventoryItems.isContainer,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.characterId, characterId));
}

/**
 * Apply a switch record atomically: every changed item and the character's
 * Last Equipped record commit together, or the whole switch is refused.
 * Returns the character's new revision.
 */
export async function applyEquipmentSwitch(
  tx: AuditTx,
  userId: string,
  characterId: string,
  input: unknown,
): Promise<number> {
  const record = equipmentSwitch.parse(input);
  await lockLibraryReferenceScope(tx, characterId, userId);
  const current = await readLastEquipmentSwitch(tx, characterId);
  if (current && isDeepStrictEqual(current, record)) {
    // A retried delivery of a switch that already committed (its timestamp
    // identifies it): acknowledge it rather than refusing it as stale.
    const [row] = await tx
      .select({ revision: characters.revision })
      .from(characters)
      .where(eq(characters.id, characterId));
    return Number(row?.revision ?? 0);
  }
  const problem = equipmentSwitchProblem(await readSwitchInventory(tx, characterId), record);
  if (problem) throw new HTTPException(400, { message: `Couldn't switch equipment: ${problem}` });
  if (record.activeLoadoutId !== null) {
    const [loadout] = await tx
      .select({ id: characterLoadouts.id })
      .from(characterLoadouts)
      .where(
        and(
          eq(characterLoadouts.id, record.activeLoadoutId.toLowerCase()),
          eq(characterLoadouts.characterId, characterId),
        ),
      );
    // A restore may name a loadout deleted since; it must be the recorded one.
    const restoredId =
      record.kind === 'restore' &&
      current?.previousActiveLoadoutId?.toLowerCase() === record.activeLoadoutId.toLowerCase();
    if (!loadout && !restoredId)
      throw new HTTPException(400, { message: 'The loadout must belong to this character' });
  }
  const now = new Date();
  for (const change of record.changes) {
    await tx
      .update(inventoryItems)
      .set({
        equipped: change.after.equipped,
        worn: change.after.worn,
        parentId: change.after.parentId?.toLowerCase() ?? null,
        externalLocation: change.after.externalLocation,
        updatedAt: now,
      })
      .where(
        and(
          eq(inventoryItems.id, change.itemId.toLowerCase()),
          eq(inventoryItems.characterId, characterId),
        ),
      );
  }
  await enforceEquippedOnPlayer(
    tx,
    characterId,
    record.changes.filter((change) => change.after.equipped).map((change) => change.itemId),
  );
  const [updated] = await tx
    .update(characters)
    .set({ lastEquipmentSwitch: record, updatedAt: now })
    .where(eq(characters.id, characterId))
    .returning({ revision: characters.revision });
  if (!updated) throw new HTTPException(404, { message: 'character not found' });
  return Number(updated.revision);
}

/** REST/MCP: plan and apply a switch under the tree lock. */
export async function equipLoadout(
  tx: AuditTx,
  userId: string,
  characterId: string,
  loadoutId: string,
): Promise<PlannedSwitch> {
  await lockLibraryReferenceScope(tx, characterId, userId);
  const [loadout] = await tx
    .select()
    .from(characterLoadouts)
    .where(
      and(eq(characterLoadouts.id, loadoutId), eq(characterLoadouts.characterId, characterId)),
    );
  if (!loadout) throw new HTTPException(404, { message: 'loadout not found' });
  const plan = planLoadoutSwitch(
    await readSwitchInventory(tx, characterId),
    loadout,
    await readLastEquipmentSwitch(tx, characterId),
    new Date().toISOString(),
  );
  await applyEquipmentSwitch(tx, userId, characterId, plan.record);
  return plan;
}

export async function restoreLastEquipped(
  tx: AuditTx,
  userId: string,
  characterId: string,
): Promise<PlannedSwitch> {
  await lockLibraryReferenceScope(tx, characterId, userId);
  const current = await readLastEquipmentSwitch(tx, characterId);
  if (!current) throw new HTTPException(404, { message: 'No Last Equipped loadout to restore' });
  const plan = planLastEquippedRestore(
    await readSwitchInventory(tx, characterId),
    current,
    new Date().toISOString(),
  );
  await applyEquipmentSwitch(tx, userId, characterId, plan.record);
  return plan;
}

export async function readLastEquipmentSwitch(
  tx: Pick<AuditTx, 'select'>,
  characterId: string,
): Promise<EquipmentSwitch | null> {
  const [row] = await tx
    .select({ lastEquipmentSwitch: characters.lastEquipmentSwitch })
    .from(characters)
    .where(eq(characters.id, characterId));
  const parsed = equipmentSwitch.nullable().safeParse(row?.lastEquipmentSwitch ?? null);
  return parsed.success ? parsed.data : null;
}
