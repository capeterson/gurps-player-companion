/** Toast wording for a loadout switch. */
import { computeEncumbrance, computeWeights } from '../../../../../shared/domain/encumbrance.ts';
import {
  type PlannedSwitch,
  equipmentSwitchUpdates,
} from '../../../../../shared/domain/loadouts.ts';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';

function encumbranceLabel(items: readonly InventoryItemOut[], basicLift: number) {
  const weights = computeWeights(
    items.map((item) => ({
      ...item,
      weightReductionPercent: item.effectiveWeightReductionPercent ?? item.weightReductionPercent,
    })),
  );
  return computeEncumbrance(weights.playerWeightLbs, basicLift).label;
}

function names(ids: readonly string[], items: readonly InventoryItemOut[]): string {
  return ids.map((id) => items.find((item) => item.id === id)?.name ?? 'An item').join(', ');
}

/**
 * The success toast for a switch: what changed, what could not be equipped
 * or returned, and the encumbrance level when it changed.
 */
export function describeSwitch(
  title: string,
  plan: PlannedSwitch,
  items: readonly InventoryItemOut[],
  basicLift: number | undefined,
): string {
  const { changes } = plan.record;
  const equipped = changes.filter((c) => c.after.equipped && !c.before.equipped).length;
  const unequipped = changes.filter((c) => !c.after.equipped && c.before.equipped).length;
  const moved = changes.filter(
    (c) =>
      c.after.worn !== c.before.worn ||
      c.after.parentId !== c.before.parentId ||
      c.after.externalLocation !== c.before.externalLocation,
  ).length;
  const parts = [
    equipped && `${equipped} equipped`,
    unequipped && `${unequipped} unequipped`,
    moved && `${moved} moved`,
  ].filter(Boolean);
  const sentences = [parts.length ? `${title}: ${parts.join(', ')}.` : `${title}: no changes.`];
  const quantity = plan.skipped.filter((s) => s.reason === 'quantity').map((s) => s.itemId);
  const notCarried = plan.skipped.filter((s) => s.reason === 'unavailable').map((s) => s.itemId);
  if (quantity.length) sentences.push(`Skipped ${names(quantity, items)} (quantity 0).`);
  if (notCarried.length) sentences.push(`Skipped ${names(notCarried, items)} (not carried).`);
  if (plan.unrestored.length === 1)
    sentences.push(`${names(plan.unrestored, items)} kept its place; its container is gone.`);
  else if (plan.unrestored.length > 1)
    sentences.push(
      `${names(plan.unrestored, items)} kept their places; their containers are gone.`,
    );
  if (basicLift !== undefined) {
    const updates = equipmentSwitchUpdates(plan.record);
    const after = items.map((item) => ({ ...item, ...updates.get(item.id) }));
    const before = encumbranceLabel(items, basicLift);
    const now = encumbranceLabel(after, basicLift);
    if (now !== before) sentences.push(`Encumbrance now ${now}.`);
  }
  return sentences.join(' ');
}
