import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
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
