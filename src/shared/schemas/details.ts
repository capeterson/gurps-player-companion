import { z } from '@hono/zod-openapi';
import { librarySkillOut } from './campaignLibrary.ts';
import { uuid } from './common.ts';
import { inventoryItemOut } from './inventory.ts';

/** Focused read contracts, shared by REST, MCP, and the embedded cards. */
export const inventoryItemDetail = z
  .object({
    kind: z.literal('inventory_item'),
    characterId: uuid,
    characterName: z.string(),
    item: inventoryItemOut,
    contents: z.array(inventoryItemOut),
  })
  .openapi('InventoryItemDetail');

export const librarySkillDetail = z
  .object({
    kind: z.literal('library_skill'),
    skill: librarySkillOut,
    experimentalActiveEffects: z.boolean(),
  })
  .openapi('LibrarySkillDetail');

export const focusedDetail = z.discriminatedUnion('kind', [
  inventoryItemDetail,
  librarySkillDetail,
]);
export type InventoryItemDetail = z.infer<typeof inventoryItemDetail>;
export type LibrarySkillDetail = z.infer<typeof librarySkillDetail>;
export type FocusedDetail = z.infer<typeof focusedDetail>;
