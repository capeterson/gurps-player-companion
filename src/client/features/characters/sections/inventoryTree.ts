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

export interface InventoryTree {
  /** Children of each node, keyed by parentId (null = root). */
  readonly byParent: Map<string | null, InventoryItemOut[]>;
  /** Lookup by item id. */
  readonly byId: Map<string, InventoryItemOut>;
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
