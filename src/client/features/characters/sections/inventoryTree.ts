/**
 * Pure helpers for the inventory tree.  `parentId === null` means the
 * item is at the character's root; otherwise it lives inside the
 * container with that id.  All functions are O(n) with at most one
 * pass over the input list.
 *
 * Mirrors the legacy `gurps-player-web/frontend/src/features/characters/
 * inventoryTree.ts` so the drag-and-drop validation and recursive
 * descent rules match what playtesters are already used to.
 */

import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import { CATEGORY_LABELS, categories } from './inventory/itemCategories.ts';

export interface InventoryTree {
  /** Children of each node, keyed by parentId (null = root). */
  readonly byParent: Map<string | null, InventoryItemOut[]>;
  /** Lookup by item id. */
  readonly byId: Map<string, InventoryItemOut>;
}

export interface FilteredInventoryTree extends InventoryTree {
  /** Items matching the filters directly; ancestor containers are not counted. */
  readonly matchedIds: ReadonlySet<string>;
}

/** Type filter value for items without any category. */
export const INVENTORY_OTHER_TYPE = 'Other';

/** The item's category labels, so new categories join the type filter automatically. */
export function inventoryTypeLabels(item: InventoryItemOut): string[] {
  const labels = categories(item).map((category) => CATEGORY_LABELS[category]);
  return labels.length > 0 ? labels : [INVENTORY_OTHER_TYPE];
}

export type InventorySort = 'item' | 'qty' | 'wt' | 'cost';

/** Rounded to cents/hundredths so range filters compare what the row shows. */
const roundForDisplay = (value: number) => Math.round(value * 100) / 100;

/** Price × quantity, plus the full value of everything inside a container. */
export function inventoryCostTotals(
  items: readonly InventoryItemOut[],
): ReadonlyMap<string, number> {
  const { byParent } = buildTree(items);
  const totals = new Map<string, number>();
  const visit = (item: InventoryItemOut, path: ReadonlySet<string>): number => {
    const known = totals.get(item.id);
    if (known !== undefined) return known;
    let total = item.cost * item.quantity;
    for (const child of byParent.get(item.id) ?? []) {
      if (!path.has(child.id)) total += visit(child, new Set([...path, child.id]));
    }
    totals.set(item.id, total);
    return total;
  };
  for (const item of items) visit(item, new Set([item.id]));
  return totals;
}

/** Stashed rows show their own raw weight; carried rows show encumbrance weight. */
export function inventoryRowWeight(item: InventoryItemOut, stashed: boolean): number {
  return stashed ? item.weightLbs * item.quantity : item.effectiveWeightLbs;
}

/** Declarative column values shared by the column filters and their option lists. */
export function inventoryFilterValues(
  item: InventoryItemOut,
  stashed: boolean,
  costTotals: ReadonlyMap<string, number>,
) {
  return {
    item: inventoryTypeLabels(item),
    qty: item.quantity,
    wt: roundForDisplay(inventoryRowWeight(item, stashed)),
    cost: roundForDisplay(costTotals.get(item.id) ?? item.cost * item.quantity),
  };
}

/**
 * Sort each container's contents (and the roots) by the chosen column.
 * Containers move with their contents; ties fall back to item name.
 */
export function sortInventoryTree(
  byParent: Map<string | null, InventoryItemOut[]>,
  sort: InventorySort,
  descending: boolean,
  stashed: boolean,
  costTotals: ReadonlyMap<string, number>,
): Map<string | null, InventoryItemOut[]> {
  const value = (item: InventoryItemOut): number =>
    sort === 'qty'
      ? item.quantity
      : sort === 'wt'
        ? inventoryRowWeight(item, stashed)
        : (costTotals.get(item.id) ?? item.cost * item.quantity);
  const byName = (a: InventoryItemOut, b: InventoryItemOut) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const compare = (a: InventoryItemOut, b: InventoryItemOut) => {
    const primary = sort === 'item' ? byName(a, b) : value(a) - value(b);
    return (descending ? -primary : primary) || byName(a, b);
  };
  return new Map([...byParent].map(([parentId, bucket]) => [parentId, [...bucket].sort(compare)]));
}

/**
 * Filter inventory without losing the hierarchy needed to locate a match.
 * Only direct name matches and their ancestor containers remain; a matching
 * container does not implicitly reveal any of its non-matching contents.
 */
export function filterInventoryTree(
  items: readonly InventoryItemOut[],
  query: string,
): FilteredInventoryTree {
  const fullTree = buildTree(items);
  const needle = query.trim().toLocaleLowerCase();
  const matchedIds = new Set<string>();
  const visibleIds = new Set<string>();

  for (const item of items) {
    if (!item.name.toLocaleLowerCase().includes(needle)) continue;
    matchedIds.add(item.id);
    visibleIds.add(item.id);

    let parentId = item.parentId;
    const seen = new Set<string>();
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = fullTree.byId.get(parentId);
      if (!parent) break;
      visibleIds.add(parent.id);
      parentId = parent.parentId;
    }
  }

  return { ...buildTree(items.filter((item) => visibleIds.has(item.id))), matchedIds };
}

/**
 * Build a parent→children index. Children are sorted by name (stable).
 *
 * Items whose `parentId` doesn't resolve to any other row in `items`
 * are treated as roots (added to the `null` bucket). This handles the
 * "deleted container" race: after an optimistic delete of a container
 * the children still carry a stale `parentId`, but until the server's
 * reparent-then-delete patch syncs back, the renderer would otherwise
 * lose them entirely. Surfacing them as roots keeps them visible and
 * editable; the next sync will move them under the correct new parent
 * (the deleted container's own parent, per the server's policy).
 */
export function buildTree(items: readonly InventoryItemOut[]): InventoryTree {
  const byParent = new Map<string | null, InventoryItemOut[]>();
  const byId = new Map<string, InventoryItemOut>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  for (const item of items) {
    // Items pointing at a parent that doesn't exist in this set are
    // orphans; promote them to roots.  The original `parentId` is left
    // alone — the next sync will fix it.
    const effectiveParent =
      item.parentId === null || byId.has(item.parentId) ? item.parentId : null;
    const bucket = byParent.get(effectiveParent);
    if (bucket) bucket.push(item);
    else byParent.set(effectiveParent, [item]);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { byParent, byId };
}

/**
 * Depth-first flatten of a roots list, useful for building a flat
 * order array that range-select can index into.
 */
export function flattenDFS(
  roots: readonly InventoryItemOut[],
  byParent: Map<string | null, InventoryItemOut[]>,
): InventoryItemOut[] {
  const out: InventoryItemOut[] = [];
  const walk = (node: InventoryItemOut) => {
    out.push(node);
    const children = byParent.get(node.id);
    if (children) for (const c of children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

/**
 * All ids reachable below `id` (exclusive). Used to block dropping a
 * container into one of its own descendants.
 */
export function descendantsOf(
  id: string,
  byParent: Map<string | null, InventoryItemOut[]>,
): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) continue;
    const kids = byParent.get(cur);
    if (!kids) continue;
    for (const k of kids) {
      if (!out.has(k.id)) {
        out.add(k.id);
        stack.push(k.id);
      }
    }
  }
  return out;
}

/** Containers a given item could legally be reparented into. */
export function eligibleContainers(
  items: readonly InventoryItemOut[],
  selfId: string,
): InventoryItemOut[] {
  const { byParent } = buildTree(items);
  const blocked = descendantsOf(selfId, byParent);
  return items
    .filter((i) => i.isContainer && i.id !== selfId && !blocked.has(i.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Validate a proposed reparent.  Returns `{ ok: false, reason }` for
 * the obvious cycle / self-drop cases that the UI surfaces as a toast,
 * `{ ok: true }` otherwise.  The server still owns the authoritative
 * cycle check — this is the optimistic UI guard.
 */
export function validateReparent(
  draggedId: string,
  newParentId: string | null,
  byParent: Map<string | null, InventoryItemOut[]>,
): { ok: true } | { ok: false; reason: string } {
  if (draggedId === newParentId) {
    return { ok: false, reason: "Can't drop an item onto itself." };
  }
  if (newParentId === null) return { ok: true };
  const blocked = descendantsOf(draggedId, byParent);
  if (blocked.has(newParentId)) {
    return { ok: false, reason: "Can't drop a container into its own descendant." };
  }
  return { ok: true };
}
