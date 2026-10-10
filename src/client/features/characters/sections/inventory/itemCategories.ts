import type { InventoryItemUpdate } from '../../../../../shared/schemas/inventory.ts';

/** The item categories a player can add; inventory tags and filters derive from this list. */
export const CATEGORY_LABELS = {
  armor: 'Armor',
  weapon: 'Weapon',
  container: 'Container',
  powerstone: 'Powerstone',
  magicItem: 'Magic item',
  enchantments: 'Enchantments',
} as const;
export type ItemCategory = keyof typeof CATEGORY_LABELS;

export function categories(item: InventoryItemUpdate): ItemCategory[] {
  return (Object.keys(CATEGORY_LABELS) as ItemCategory[]).filter((category) => {
    switch (category) {
      case 'armor':
        return item.isArmor;
      case 'weapon':
        return item.weaponData != null;
      case 'container':
        return item.isContainer;
      case 'powerstone':
        return item.powerstoneData != null;
      case 'magicItem':
        return item.magicItemData != null;
      case 'enchantments':
        return (item.enchantments?.length ?? 0) > 0;
    }
  });
}
