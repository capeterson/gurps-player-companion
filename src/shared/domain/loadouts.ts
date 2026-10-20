/**
 * Equipment loadouts: named sets of inventory items that one Equip gesture
 * moves onto the player and equips, unequipping everything else. The switch
 * record doubles as the Last Equipped loadout; restoring it is a full undo
 * that produces its own record, so Restore toggles between the two states.
 *
 * Pure and shared: the PWA applies a planned switch locally and queues it,
 * and the server validates and applies the same record (REST and sync).
 */
import type {
  EquipmentSwitch,
  EquipmentSwitchChange,
  InventorySwitchState,
} from '../schemas/loadout.ts';
import { equippedOffPlayer, inventoryAvailability } from './inventoryAvailability.ts';

export interface LoadoutInventoryItem {
  readonly id: string;
  readonly name?: string | undefined;
  readonly parentId: string | null;
  readonly worn: boolean;
  readonly externalLocation: string | null;
  readonly equipped: boolean;
  readonly quantity: number;
  readonly isContainer: boolean;
}

export interface LoadoutRef {
  readonly id: string;
  readonly name: string;
  readonly itemIds: readonly string[];
}

export interface SkippedLoadoutItem {
  readonly itemId: string;
  readonly reason: 'quantity' | 'unavailable';
}

export interface PlannedSwitch {
  readonly record: EquipmentSwitch;
  /** Loadout items that stay unequipped because nothing of them is carried. */
  readonly skipped: readonly SkippedLoadoutItem[];
  /** Items Last Equipped could not return to their recorded container. */
  readonly unrestored: readonly string[];
}

const SWITCH_FIELDS = ['equipped', 'worn', 'parentId', 'externalLocation'] as const;
const ON_PLAYER_ROOT = { parentId: null, worn: true, externalLocation: null } as const;

const key = (id: string) => id.toLowerCase();

function stateOf(item: LoadoutInventoryItem): InventorySwitchState {
  return {
    equipped: item.equipped,
    worn: item.worn,
    parentId: item.parentId === null ? null : key(item.parentId),
    externalLocation: item.externalLocation,
  };
}

function sameState(a: InventorySwitchState, b: InventorySwitchState): boolean {
  return SWITCH_FIELDS.every((field) => a[field] === b[field]);
}

function sameLocation(a: InventorySwitchState, b: InventorySwitchState): boolean {
  return (
    a.worn === b.worn && a.parentId === b.parentId && a.externalLocation === b.externalLocation
  );
}

/** Working copy of the four switch fields, keyed by lowercase id. */
class Workspace {
  readonly byId = new Map<string, LoadoutInventoryItem>();
  readonly state = new Map<string, InventorySwitchState>();

  constructor(items: readonly LoadoutInventoryItem[]) {
    for (const item of items) {
      this.byId.set(key(item.id), item);
      this.state.set(key(item.id), stateOf(item));
    }
  }

  get(id: string): InventorySwitchState {
    const state = this.state.get(id);
    if (!state) throw new Error(`Unknown inventory item ${id}`);
    return state;
  }

  set(id: string, patch: Partial<InventorySwitchState>) {
    this.state.set(id, { ...this.get(id), ...patch });
  }

  rows(): (LoadoutInventoryItem & InventorySwitchState)[] {
    return [...this.byId.entries()].map(([id, item]) => ({ ...item, id, ...this.get(id) }));
  }

  depth(id: string): number {
    let depth = 0;
    const seen = new Set<string>();
    let current = this.state.get(id)?.parentId ?? null;
    while (current && !seen.has(current) && this.state.has(current)) {
      seen.add(current);
      depth += 1;
      current = this.get(current).parentId;
    }
    return depth;
  }

  onPlayer(id: string): boolean {
    const seen = new Set<string>();
    let current: string | null = id;
    while (current) {
      if (seen.has(current)) return false;
      seen.add(current);
      const state = this.state.get(current);
      if (!state) return false;
      if (state.parentId === null) return state.worn && !state.externalLocation;
      current = state.parentId;
    }
    return false;
  }

  createsCycle(id: string): boolean {
    const seen = new Set<string>([id]);
    let current = this.get(id).parentId;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      const state = this.state.get(current);
      if (!state) return false;
      current = state.parentId;
    }
    return false;
  }

  carried(): Map<string | undefined, { carried: boolean; equipped: boolean }> {
    return inventoryAvailability(this.rows());
  }

  /** Move every target that is off the player to its root, ancestors first so
   * a container brought in carries its contents. */
  bringOntoPlayer(targets: readonly string[]) {
    for (const id of [...targets].sort((a, b) => this.depth(a) - this.depth(b))) {
      if (!this.onPlayer(id)) this.set(id, ON_PLAYER_ROOT);
    }
  }

  /** Equip exactly the carried targets; report targets nothing of which is carried. */
  equipExactly(targets: ReadonlySet<string>): SkippedLoadoutItem[] {
    const availability = this.carried();
    const skipped: SkippedLoadoutItem[] = [];
    for (const id of this.state.keys()) {
      const wanted = targets.has(id);
      const carried = availability.get(id)?.carried === true;
      this.set(id, { equipped: wanted && carried });
      if (wanted && !carried)
        skipped.push({
          itemId: id,
          reason: (this.byId.get(id)?.quantity ?? 0) <= 0 ? 'quantity' : 'unavailable',
        });
    }
    return skipped;
  }

  changes(original: readonly LoadoutInventoryItem[]): EquipmentSwitchChange[] {
    return original.flatMap((item) => {
      const id = key(item.id);
      const before = stateOf(item);
      const after = this.get(id);
      return sameState(before, after) ? [] : [{ itemId: id, before, after }];
    });
  }
}

function equippedIds(items: readonly LoadoutInventoryItem[]): string[] {
  return items.filter((item) => item.equipped).map((item) => key(item.id));
}

/** Plan equipping `loadout`: its items end up on the player and equipped. */
export function planLoadoutSwitch(
  items: readonly LoadoutInventoryItem[],
  loadout: LoadoutRef,
  current: EquipmentSwitch | null,
  now: string,
): PlannedSwitch {
  const work = new Workspace(items);
  const targets = [...new Set(loadout.itemIds.map(key))].filter((id) => work.byId.has(id));
  work.bringOntoPlayer(targets);
  const skipped = work.equipExactly(new Set(targets));
  return {
    record: {
      kind: 'loadout',
      activeLoadoutId: key(loadout.id),
      activeLoadoutName: loadout.name,
      previousActiveLoadoutId: current?.activeLoadoutId ?? null,
      previousActiveLoadoutName: current?.activeLoadoutName ?? null,
      switchedAt: now,
      previousEquippedIds: equippedIds(items),
      changes: work.changes(items),
    },
    skipped,
    unrestored: [],
  };
}

/** Plan restoring Last Equipped: the previous equipped set and locations. */
export function planLastEquippedRestore(
  items: readonly LoadoutInventoryItem[],
  current: EquipmentSwitch,
  now: string,
): PlannedSwitch {
  const work = new Workspace(items);
  const restored: string[] = [];
  const unrestored: string[] = [];
  for (const change of current.changes) {
    const id = key(change.itemId);
    if (!work.byId.has(id) || sameLocation(change.before, change.after)) continue;
    const parentId = change.before.parentId === null ? null : key(change.before.parentId);
    if (parentId !== null && work.byId.get(parentId)?.isContainer !== true) {
      unrestored.push(id);
      continue;
    }
    work.set(id, {
      worn: change.before.worn,
      parentId,
      externalLocation: change.before.externalLocation,
    });
    restored.push(id);
  }
  // A later reorganization can make a recorded parent a descendant. Such an
  // item keeps its current location rather than forming a cycle.
  for (const id of restored) {
    if (!work.createsCycle(id)) continue;
    const original = work.byId.get(id);
    if (original) work.set(id, stateOf(original));
    unrestored.push(id);
  }
  const targets = current.previousEquippedIds.map(key).filter((id) => work.byId.has(id));
  work.bringOntoPlayer(targets);
  const skipped = work.equipExactly(new Set(targets));
  return {
    record: {
      kind: 'restore',
      activeLoadoutId: current.previousActiveLoadoutId,
      activeLoadoutName: current.previousActiveLoadoutName,
      previousActiveLoadoutId: current.activeLoadoutId,
      previousActiveLoadoutName: current.activeLoadoutName,
      switchedAt: now,
      previousEquippedIds: equippedIds(items),
      changes: work.changes(items),
    },
    skipped,
    unrestored,
  };
}

/** The four switch fields each changed item takes. */
export function equipmentSwitchUpdates(record: EquipmentSwitch): Map<string, InventorySwitchState> {
  return new Map(record.changes.map((change) => [key(change.itemId), change.after]));
}

/**
 * Why `record` cannot apply to `items` (the character's whole inventory), or
 * null. A switch planned against an inventory that has since changed (for
 * example on another device) is refused rather than half-applied.
 */
export function equipmentSwitchProblem(
  items: readonly LoadoutInventoryItem[],
  record: EquipmentSwitch,
): string | null {
  const work = new Workspace(items);
  const stale = 'the inventory changed on another device; equip it again';
  for (const change of record.changes) {
    const id = key(change.itemId);
    if (!work.byId.has(id)) return stale;
    if (!sameState(work.get(id), { ...change.before, parentId: lower(change.before.parentId) }))
      return stale;
  }
  const before = new Set(equippedIds(items));
  const recorded = new Set(record.previousEquippedIds.map(key));
  if (before.size !== recorded.size || [...before].some((id) => !recorded.has(id))) return stale;
  for (const change of record.changes) {
    const id = key(change.itemId);
    work.set(id, { ...change.after, parentId: lower(change.after.parentId) });
  }
  for (const change of record.changes) {
    const parentId = lower(change.after.parentId);
    if (parentId === null) continue;
    const parent = work.byId.get(parentId);
    if (!parent) return 'an item was moved into a container that is not on this character';
    if (!parent.isContainer) return 'an item was moved into an item that is not a container';
    if (work.createsCycle(key(change.itemId))) return 'the switch would create an inventory cycle';
  }
  if (equippedOffPlayer(work.rows()).length > 0) return 'Equipped items must be on the player';
  return null;
}

function lower(id: string | null): string | null {
  return id === null ? null : key(id);
}

export interface LoadoutDelta<T> {
  readonly exact: boolean;
  /** Equipped items outside the loadout. */
  readonly extraEquipped: T[];
  /** Loadout items that are not equipped. */
  readonly missing: T[];
}

/** How the current equipment differs from a loadout (deleted ids are ignored). */
export function loadoutDelta<T extends LoadoutInventoryItem>(
  items: readonly T[],
  loadout: Pick<LoadoutRef, 'itemIds'>,
): LoadoutDelta<T> {
  const ids = new Set(loadout.itemIds.map(key));
  const extraEquipped = items.filter((item) => item.equipped && !ids.has(key(item.id)));
  const missing = items.filter((item) => !item.equipped && ids.has(key(item.id)));
  return { exact: extraEquipped.length === 0 && missing.length === 0, extraEquipped, missing };
}

export interface SortableLoadout {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
}

export function sortLoadouts<T extends SortableLoadout>(loadouts: readonly T[]): T[] {
  return [...loadouts].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id),
  );
}

/** The sort order for a loadout appended to the end of the menu. */
export function nextLoadoutSortOrder(loadouts: readonly SortableLoadout[]): number {
  return loadouts.reduce((max, loadout) => Math.max(max, loadout.sortOrder), -1) + 1;
}

const MIN_SORT_GAP = 1e-6;

/**
 * Sort-order writes for moving `sorted[from]` to index `to`. Normally only the
 * moved loadout changes, to the midpoint of its new neighbours; when that gap
 * is exhausted every loadout is renumbered.
 */
export function loadoutMoveUpdates(
  sorted: readonly SortableLoadout[],
  from: number,
  to: number,
): { id: string; sortOrder: number }[] {
  const moved = sorted[from];
  if (!moved || from === to || to < 0 || to >= sorted.length) return [];
  const rest = sorted.filter((_, index) => index !== from);
  const before = rest[to - 1];
  const after = rest[to];
  let sortOrder: number;
  if (!before) sortOrder = (after?.sortOrder ?? 0) - 1;
  else if (!after) sortOrder = before.sortOrder + 1;
  else sortOrder = (before.sortOrder + after.sortOrder) / 2;
  const gapOk =
    (!before || sortOrder - before.sortOrder >= MIN_SORT_GAP) &&
    (!after || after.sortOrder - sortOrder >= MIN_SORT_GAP);
  if (gapOk) return [{ id: moved.id, sortOrder }];
  const reordered = [...rest.slice(0, to), moved, ...rest.slice(to)];
  return reordered
    .map((loadout, index) => ({ id: loadout.id, sortOrder: index }))
    .filter(
      (update) =>
        sorted.find((loadout) => loadout.id === update.id)?.sortOrder !== update.sortOrder,
    );
}
