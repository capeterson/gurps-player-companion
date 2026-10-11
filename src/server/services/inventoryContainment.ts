import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { equippedOffPlayer } from '../../shared/domain/inventoryAvailability.ts';
import type { AuditTx } from '../db/auditContext.ts';
import { inventoryItems } from '../db/schema.ts';

/** Both API doors run these checks under the character's tree lock. */
export async function assertInventoryContainer(tx: AuditTx, parentId: string, characterId: string) {
  const [parent] = await tx
    .select({ isContainer: inventoryItems.isContainer })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, parentId), eq(inventoryItems.characterId, characterId)));
  if (!parent)
    throw new HTTPException(400, { message: 'parentId must reference an item on this character' });
  if (!parent.isContainer)
    throw new HTTPException(400, { message: 'parentId must reference a container' });
}

export async function assertEmptyInventoryContainer(
  tx: AuditTx,
  itemId: string,
  characterId: string,
) {
  const [child] = await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.parentId, itemId), eq(inventoryItems.characterId, characterId)))
    .limit(1);
  if (child)
    throw new HTTPException(400, {
      message: 'Move the contents before removing the Container category',
    });
}

export const EQUIPPED_OFF_PLAYER_MESSAGE = 'Equipped items must be on the player';

/**
 * Equipped means worn or wielded, so it is valid only on the player. Run
 * after an inventory write, under the character's tree lock: equipping an
 * item off the player is rejected (rolling the write back), and a move off
 * the player unequips the moved item and its contents.
 */
export async function enforceEquippedOnPlayer(
  tx: AuditTx,
  characterId: string,
  equippedByWrite: readonly string[],
): Promise<void> {
  const rows = await tx
    .select({
      id: inventoryItems.id,
      parentId: inventoryItems.parentId,
      worn: inventoryItems.worn,
      externalLocation: inventoryItems.externalLocation,
      equipped: inventoryItems.equipped,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.characterId, characterId));
  const invalid = equippedOffPlayer(rows);
  if (invalid.length === 0) return;
  const requested = new Set(equippedByWrite.map((id) => id.toLowerCase()));
  if (invalid.some((item) => requested.has(item.id)))
    throw new HTTPException(400, { message: EQUIPPED_OFF_PLAYER_MESSAGE });
  await tx
    .update(inventoryItems)
    .set({ equipped: false, updatedAt: new Date() })
    .where(
      and(
        eq(inventoryItems.characterId, characterId),
        inArray(
          inventoryItems.id,
          invalid.map((item) => item.id),
        ),
      ),
    );
}
