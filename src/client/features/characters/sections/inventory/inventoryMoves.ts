import { inventoryAvailability } from '../../../../../shared/domain/inventoryAvailability.ts';
import type { InventoryItemUpdate } from '../../../../../shared/schemas/inventory.ts';
import { getLocalDb } from '../../../../db/dexie.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { type EnqueueFieldPatchArgs, enqueueFieldPatches } from '../../../../sync/outbox.ts';

/** Where an item can go. The bulk menu, drag and drop, and the item editor's
 * Location control all move items through this one module. */
export type InventoryMoveTarget =
  | { kind: 'player' }
  | { kind: 'stashed' }
  | { kind: 'container'; id: string };

export interface MovableRow {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly worn: boolean;
  readonly externalLocation: string | null;
  readonly equipped: boolean;
  readonly quantity: number;
  readonly isContainer: boolean;
}

/** A root on the player clears its stash label; Stashed keeps an earlier one. */
export function moveTargetPatch(target: InventoryMoveTarget): InventoryItemUpdate {
  switch (target.kind) {
    case 'player':
      return { parentId: null, worn: true, externalLocation: null };
    case 'stashed':
      return { parentId: null, worn: false };
    case 'container':
      return { parentId: target.id, worn: false, externalLocation: null };
  }
}

/** The editor's select value for an item's current location. */
export function locationValue(row: Pick<MovableRow, 'parentId' | 'worn' | 'externalLocation'>) {
  if (row.parentId) return row.parentId;
  return row.worn && !row.externalLocation ? 'player' : 'stashed';
}

export function targetFromValue(value: string): InventoryMoveTarget {
  if (value === 'player') return { kind: 'player' };
  if (value === 'stashed') return { kind: 'stashed' };
  return { kind: 'container', id: value };
}

/** Every id inside `id` (children, grandchildren, ...). */
function descendants(rows: readonly MovableRow[], id: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    byParent.set(row.parentId, [...(byParent.get(row.parentId) ?? []), row.id]);
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    for (const child of byParent.get(stack.pop() as string) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

/** The same self, container and cycle checks the server applies to parentId. */
export function moveBlockReason(
  rows: readonly MovableRow[],
  id: string,
  target: InventoryMoveTarget,
): string | null {
  if (target.kind !== 'container') return null;
  if (target.id === id) return "Can't put an item inside itself.";
  const container = rows.find((row) => row.id === target.id);
  if (!container) return 'That container no longer exists.';
  if (!container.isContainer) return `${container.name} isn't a container.`;
  if (descendants(rows, id).has(target.id)) return "Can't move a container into its own contents.";
  return null;
}

/** Containers that every moving item may enter, sorted by name. */
export function moveTargetContainers<T extends MovableRow>(
  rows: readonly T[],
  movingIds: Iterable<string>,
): T[] {
  const ids = [...movingIds];
  return rows
    .filter(
      (row) =>
        row.isContainer &&
        ids.every((id) => moveBlockReason(rows, id, { kind: 'container', id: row.id }) === null),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

const FIELD_NAMES: Record<string, string> = {
  parentId: 'container',
  worn: 'location',
  externalLocation: 'stash location',
};

/** Unequip anything (including contents) that the move takes off the player. */
function unequipOps(
  rows: readonly MovableRow[],
  ids: readonly string[],
  patch: InventoryItemUpdate,
  characterId: string,
): EnqueueFieldPatchArgs[] {
  const before = inventoryAvailability(rows);
  const after = inventoryAvailability(
    rows.map((row) => (ids.includes(row.id) ? { ...row, ...patch } : row)),
  );
  return rows
    .filter((row) => row.equipped && before.get(row.id)?.equipped && !after.get(row.id)?.equipped)
    .map((row) => ({
      entityClass: 'character_inventory' as const,
      entityId: row.id,
      characterId,
      fieldPath: 'equipped',
      attemptedValue: false,
      humanName: 'Equipped',
      flashKey: makeFlashKey('character_inventory', row.id, 'equipped'),
    }));
}

/**
 * Move items in one local transaction, validated against the stored tree.
 * Unequips go first: the server unequips anything moved off the player, so
 * a later unequip would arrive against a newer revision.
 */
export async function moveInventoryItems({
  characterId,
  ids,
  target,
  label,
}: {
  characterId: string;
  ids: readonly string[];
  target: InventoryMoveTarget;
  label: string;
}): Promise<void> {
  const db = getLocalDb();
  await db.transaction('rw', [db.characterInventory, db.outbox], async () => {
    const rows = (await db.characterInventory
      .where('characterId')
      .equals(characterId)
      .toArray()) as MovableRow[];
    for (const id of ids) {
      if (!rows.some((row) => row.id === id)) throw new Error('This item no longer exists');
      const blocked = moveBlockReason(rows, id, target);
      if (blocked) throw new Error(blocked);
    }
    const patch = moveTargetPatch(target);
    await enqueueFieldPatches([
      ...unequipOps(rows, ids, patch, characterId),
      ...ids.flatMap((id) =>
        Object.entries(patch).map(([field, value]) => ({
          entityClass: 'character_inventory' as const,
          entityId: id,
          characterId,
          fieldPath: field,
          attemptedValue: value,
          humanName: `${label} ${FIELD_NAMES[field] ?? field}`,
          flashKey: makeFlashKey('character_inventory', id, field),
        })),
      ),
    ]);
  });
}
