import { buildInventoryItemOut } from '../../../../../shared/domain/characterDetail.ts';
import {
  type InventoryItemOut,
  type InventoryItemUpdate,
  armorData,
  inventoryItemOut,
  inventoryItemUpdate,
  weaponData,
} from '../../../../../shared/schemas/inventory.ts';
import { getLocalDb } from '../../../../db/dexie.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { enqueueFieldPatches } from '../../../../sync/outbox.ts';

export const CATEGORY_LABELS = {
  armor: 'Armor',
  weapon: 'Weapon',
  container: 'Container',
  powerstone: 'Powerstone',
  magicItem: 'Magic item',
  enchantments: 'Enchantments',
} as const;
export type ItemCategory = keyof typeof CATEGORY_LABELS;
export type ItemSection = ItemCategory | 'basics' | 'add';

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

/** Read/modify/write in the same IndexedDB transaction. Two inputs editing
 * different properties of armor/weaponData must never overwrite one another
 * with JSON built from a stale React render. The wire still uses whole fields. */
export async function mutateItem(
  id: string,
  label: string,
  update: (current: InventoryItemOut) => InventoryItemUpdate,
): Promise<void> {
  const db = getLocalDb();
  await db.transaction('rw', [db.characterInventory, db.outbox], async () => {
    const stored = await db.characterInventory.get(id);
    if (!stored) throw new Error('This inventory item no longer exists');
    // Sync cursor rows retain Postgres numeric strings; use the same
    // normalization as the character sheet before validating/editing them.
    const current = inventoryItemOut.parse(buildInventoryItemOut(stored, new Map()));
    const patch = inventoryItemUpdate.parse(update(current));
    if (
      patch.isContainer === false &&
      (await db.characterInventory.filter((child) => child.parentId === id).count())
    ) {
      throw new Error('Move the contents before removing the Container category');
    }
    await enqueueFieldPatches(
      Object.entries(patch)
        .filter(
          ([key, value]) =>
            JSON.stringify(current[key as keyof InventoryItemOut]) !== JSON.stringify(value),
        )
        .map(([fieldPath, attemptedValue]) => ({
          entityClass: 'character_inventory' as const,
          entityId: id,
          characterId: current.characterId,
          fieldPath,
          attemptedValue,
          humanName: `${current.name}: ${label}`,
          flashKey: makeFlashKey('character_inventory', id, fieldPath),
        })),
    );
  });
}

export function readPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (current, key) => (current == null ? undefined : (current as Record<string, unknown>)[key]),
      value,
    );
}

export async function readItemPath(id: string, path: string): Promise<unknown> {
  return readPath(await getLocalDb().characterInventory.get(id), path);
}

export function writeItemPath(id: string, path: string, value: unknown, label: string) {
  return mutateItem(id, label, (current) => {
    const [field, ...keys] = path.split('.');
    if (!field || !(field in inventoryItemUpdate.shape)) throw new Error('Unknown item field');
    if (keys.length === 0) return { [field]: value };
    const root = structuredClone(current[field as keyof InventoryItemOut]);
    if (root == null) throw new Error('This category was removed; add it again before editing');
    let target = root as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) {
      if (target[key] == null) target[key] = {};
      target = target[key] as Record<string, unknown>;
    }
    target[keys[keys.length - 1] as string] = value;
    if (field === 'weaponData') {
      const weapon = root as unknown as Record<string, unknown>;
      if (
        weapon.ranged &&
        Object.values(weapon.ranged).every((entry) => entry == null || entry === '')
      )
        weapon.ranged = null;
    }
    return { [field]: root };
  });
}

export function addCategory(id: string, category: ItemCategory, spellName = '') {
  return mutateItem(id, `Add ${CATEGORY_LABELS[category]}`, (current) => {
    if (categories(current).includes(category)) return {};
    switch (category) {
      case 'armor':
        return { isArmor: true, armor: armorData.parse({}) };
      case 'weapon':
        return { weaponData: weaponData.parse({}) };
      case 'container':
        return { isContainer: true };
      case 'powerstone':
        return { powerstoneData: { maxEnergy: 5, currentEnergy: 0 } };
      case 'magicItem':
        return {
          magicItemData: {
            spellName: spellName.trim(),
            spellSkillLevel: 15,
            mode: 'charged',
            chargesMax: 10,
            chargesCurrent: 10,
          },
        };
      case 'enchantments':
        return {};
    }
  });
}

export function removeCategory(id: string, category: ItemCategory) {
  return mutateItem(id, `Remove ${CATEGORY_LABELS[category]}`, () => {
    switch (category) {
      case 'armor':
        return { isArmor: false, armor: null };
      case 'weapon':
        return { weaponData: null };
      case 'powerstone':
        return { powerstoneData: null };
      case 'magicItem':
        return { magicItemData: null };
      case 'enchantments':
        return { enchantments: [] };
      case 'container':
        return { isContainer: false, hideawayCapacityLbs: 0, weightReductionPercent: 0 };
    }
  });
}
