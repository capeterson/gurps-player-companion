import type { CharacterDetail } from '../schemas/character.ts';
import type { InventoryItemDetail } from '../schemas/details.ts';
import type { InventoryItemOut } from '../schemas/inventory.ts';

/** Select from the authoritative sheet so weights/enchantments/effects agree. */
export function selectInventoryItemDetail(
  character: CharacterDetail,
  itemId: string,
): InventoryItemDetail | null {
  const item = character.inventory.find((entry) => entry.id === itemId);
  if (!item) return null;
  const byParent = new Map<string, InventoryItemOut[]>();
  for (const entry of character.inventory) {
    if (!entry.parentId) continue;
    const siblings = byParent.get(entry.parentId) ?? [];
    siblings.push(entry);
    byParent.set(entry.parentId, siblings);
  }
  const contents: InventoryItemOut[] = [];
  const visited = new Set([item.id]);
  const visit = (container: InventoryItemOut) => {
    if (!container.isContainer) return;
    for (const child of byParent.get(container.id) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      contents.push(child);
      visit(child);
    }
  };
  visit(item);
  return {
    kind: 'inventory_item',
    characterId: character.id,
    characterName: character.name,
    item,
    contents,
  };
}
