import { type AvailabilityItem, availableEquipment } from './inventoryAvailability.ts';

/** Deflect affects all active defenses (M67), regardless of hit location.
 * Its presence on a weapon does not make that weapon a shield. */
export function magicalDefenseBonus(
  items: readonly (AvailabilityItem & {
    enchantmentBreakdown?:
      | readonly {
          target: string;
          active: boolean;
          suppressedByStacking: boolean;
          stackingKey: string | null;
          value: number;
        }[]
      | undefined;
  })[],
): number {
  const groups = new Map<string, number>();
  for (const [index, item] of availableEquipment(items).entries()) {
    const perItem = new Map<string, number>();
    for (const line of item.enchantmentBreakdown ?? []) {
      if (!line.active || line.suppressedByStacking || line.target !== 'db') continue;
      const key = line.stackingKey ?? `item:${item.id ?? index}`;
      perItem.set(key, (perItem.get(key) ?? 0) + line.value);
    }
    for (const [key, value] of perItem)
      groups.set(key, Math.max(groups.get(key) ?? Number.NEGATIVE_INFINITY, value));
  }
  return [...groups.values()].reduce((sum, value) => sum + value, 0);
}
