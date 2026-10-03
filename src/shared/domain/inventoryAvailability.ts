/** Physical availability follows the whole containment path (B266).
 * Optional fields permit small legacy calculation inputs; real inventory rows
 * always provide quantity, parentId and the root's carried/location fields. */
export interface AvailabilityItem {
  readonly id?: string | undefined;
  readonly parentId?: string | null | undefined;
  readonly quantity?: number | undefined;
  readonly worn?: boolean | undefined;
  readonly externalLocation?: string | null | undefined;
  readonly equipped?: boolean | undefined;
}

export function inventoryAvailability(items: readonly AvailabilityItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result = new Map<string | undefined, { carried: boolean; equipped: boolean }>();
  function carried(item: AvailabilityItem, seen: Set<AvailabilityItem>): boolean {
    if ((item.quantity ?? 1) <= 0 || seen.has(item)) return false;
    seen.add(item);
    if (item.parentId) {
      const parent = byId.get(item.parentId);
      return parent != null && carried(parent, seen);
    }
    return item.worn !== false && !item.externalLocation;
  }
  for (const item of items) {
    const available = carried(item, new Set());
    result.set(item.id, { carried: available, equipped: available && Boolean(item.equipped) });
  }
  return result;
}

export function availableEquipment<T extends AvailabilityItem>(items: readonly T[]): T[] {
  const keyed = items.map((item, index) => ({ ...item, id: item.id ?? `legacy-${index}` }));
  const availability = inventoryAvailability(keyed);
  return items.filter((_, index) => availability.get(keyed[index]?.id)?.equipped);
}

/** A deleted container's children retain its root location when promoted. */
export function promotedInventoryLocation(item: {
  parentId: string | null;
  worn: boolean;
  externalLocation: string | null;
}) {
  return {
    parentId: item.parentId,
    ...(item.parentId === null ? { worn: item.worn, externalLocation: item.externalLocation } : {}),
  };
}
