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

const GROUPING_PREFIX = 'gurps:inventoryGroupByType:';

/** Whether a list shows type sections instead of its container tree. */
export function readInventoryGroupByType(characterId: string, list: InventoryList): boolean {
  try {
    return localStorage.getItem(`${GROUPING_PREFIX}${characterId}:${list}`) === 'true';
  } catch {
    return false;
  }
}

export function saveInventoryGroupByType(
  characterId: string,
  list: InventoryList,
  grouped: boolean,
): boolean {
  try {
    localStorage.setItem(`${GROUPING_PREFIX}${characterId}:${list}`, String(grouped));
    return true;
  } catch {
    return false;
  }
}

export function clearAllInventoryTablePreferences(): void {
  codec.clearAll();
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(GROUPING_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
}
