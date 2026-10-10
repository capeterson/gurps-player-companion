import type { InventorySort } from './inventoryTree.ts';
import { type TablePreferences, tablePreferencesCodec } from './tablePreferences.ts';

/** “On the player” and “Stashed” keep separate sorts. */
export type InventoryList = 'worn' | 'stashed';

const codec = tablePreferencesCodec<InventorySort>(
  'gurps:inventoryTable:',
  ['item', 'qty', 'wt', 'cost'],
  'item',
);

export function readInventoryTablePreferences(
  characterId: string,
  list: InventoryList,
): TablePreferences<InventorySort> {
  return codec.read(`${characterId}:${list}`);
}

export function saveInventoryTablePreferences(
  characterId: string,
  list: InventoryList,
  preferences: TablePreferences<InventorySort>,
): boolean {
  return codec.save(`${characterId}:${list}`, preferences);
}

export const clearAllInventoryTablePreferences = codec.clearAll;
