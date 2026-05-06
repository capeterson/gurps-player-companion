/**
 * Literal port of the gurps-player-web (archived) inventory UI:
 *  - "On the player" / "Stashed" sections segregated by `worn` on root items
 *  - Encumbrance + Basic Lift header with InfoTooltip explainers
 *  - Selection-driven bulk toolbar (worn / equipped majority toggles +
 *    move-to-container dropdown + bulk delete)
 *  - Add form with library autocomplete and a "More options" expander
 *    (container / armor / worn / equipped flags at create time)
 *  - Per-row Edit dialog (`ItemEditDialog`) with full container/armor editing
 *  - DnD between rows / character / stashed targets, with valid/invalid
 *    visual feedback
 *
 * Mutations route through this repo's outbox (`enqueueCreate` /
 * `enqueueDelete` / `enqueueFieldPatch`) instead of the original
 * TanStack `useMutation` calls; everything else mirrors the source.
 */

import { type FormEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import type { LibraryItemOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type {
  InventoryItemOut,
  InventoryItemUpdate,
} from '../../../../shared/schemas/inventory.ts';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { InfoTooltip } from '../../../components/ui/InfoTooltip.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { useRangeSelect } from '../../../hooks/useRangeSelect.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueFieldPatch,
  newClientId,
} from '../../../sync/outbox.ts';
import { InventoryRow } from './InventoryRow.tsx';
import { ItemEditDialog } from './ItemEditDialog.tsx';
import { buildTree, descendantsOf, flattenDFS } from './inventoryTree.ts';
import { useLibraryFetcher } from './useLibraryFetcher.ts';

const LEVEL_LABELS = ['None', 'Light', 'Medium', 'Heavy', 'X-Heavy'] as const;

export type DragTarget =
  | { kind: 'container'; id: string }
  | { kind: 'character' }
  | { kind: 'stashed' };

export interface InventoryDragApi {
  draggingId: string | null;
  hoverKey: string | null;
  hoverValid: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverTarget: (target: DragTarget, dt: DataTransfer | null) => void;
  onDragLeaveTarget: (target: DragTarget) => void;
  onDrop: (target: DragTarget) => void;
}

function dragTargetKey(t: DragTarget): string {
  return t.kind === 'container' ? `container:${t.id}` : t.kind;
}

export function InventoryPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const characterId = character.id;
  const campaignId = character.campaignId ?? null;
  const encumbrance = character.encumbrance;
  const items = character.inventory;
  const toasts = useToasts();

  const tree = useMemo(() => buildTree(items), [items]);
  const roots = tree.byParent.get(null) ?? [];
  const wornRoots = roots.filter((r) => r.worn);
  const carriedRoots = roots.filter((r) => !r.worn);

  const orderedIds = useMemo(
    () => flattenDFS([...wornRoots, ...carriedRoots], tree.byParent).map((i) => i.id),
    [wornRoots, carriedRoots, tree.byParent],
  );
  const { selectedIds, isSelected, handleClick, clear, count } = useRangeSelect(orderedIds);

  // Add-form state
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [weight, setWeight] = useState('');
  const [cost, setCost] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [newIsContainer, setNewIsContainer] = useState(false);
  const [newIsArmor, setNewIsArmor] = useState(false);
  const [newWorn, setNewWorn] = useState(false);
  const [newEquipped, setNewEquipped] = useState(false);
  const [creating, setCreating] = useState(false);

  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [editing, setEditing] = useState<InventoryItemOut | null>(null);
  const [pickedLibraryItem, setPickedLibraryItem] = useState<LibraryItemOut | null>(null);

  const containers = useMemo(() => items.filter((i) => i.isContainer), [items]);

  const { fetchOptions } = useLibraryFetcher<LibraryItemOut>('items', campaignId);

  function onPickLibraryItem(opt: LibraryItemOut) {
    setPickedLibraryItem(opt);
    setName(opt.name);
    if (opt.weightLbs != null) setWeight(String(opt.weightLbs));
    if (opt.cost != null) setCost(String(opt.cost));
    if (opt.isArmor) setNewIsArmor(true);
  }

  async function patchField(
    id: string,
    field: keyof InventoryItemUpdate,
    value: unknown,
    humanName: string,
  ): Promise<void> {
    await enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId: id,
      fieldPath: field as string,
      attemptedValue: value,
      humanName,
      flashKey: makeFlashKey('character_inventory', id, field as string),
      characterId,
    });
  }

  async function patchMany(id: string, patch: InventoryItemUpdate, label: string): Promise<void> {
    for (const [field, value] of Object.entries(patch)) {
      await patchField(id, field as keyof InventoryItemUpdate, value, `${label} ${field}`);
    }
  }

  async function bulkPatch(patch: InventoryItemUpdate, label: string): Promise<void> {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      for (const [field, value] of Object.entries(patch)) {
        await patchField(id, field as keyof InventoryItemUpdate, value, `${label} ${field}`);
      }
    }
    toasts.push(`${label} ${ids.length} item${ids.length === 1 ? '' : 's'}`, { kind: 'success' });
  }

  async function bulkDelete(): Promise<void> {
    setConfirmBulkDelete(false);
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      const target = tree.byId.get(id);
      if (!target) continue;
      try {
        await enqueueDelete({
          entityClass: 'character_inventory',
          entityId: id,
          humanName: `item "${target.name}"`,
          characterId,
          prevValue: target,
        });
      } catch (err) {
        toasts.push(`Couldn't delete "${target.name}" — ${(err as Error).message}`, {
          kind: 'error',
        });
      }
    }
    clear();
    toasts.push(`Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`, { kind: 'success' });
  }

  async function onCreate(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) {
      toasts.push('Item name cannot be blank', { kind: 'error' });
      return;
    }
    const parsedQty = Math.floor(Number(qty));
    if (!Number.isFinite(parsedQty) || parsedQty < 1) {
      toasts.push('Quantity must be at least 1', { kind: 'error' });
      return;
    }
    const parsedWeight = weight === '' ? 0 : Number(weight);
    if (!Number.isFinite(parsedWeight)) {
      toasts.push('Weight must be a number', { kind: 'error' });
      return;
    }
    const parsedCost = cost === '' ? 0 : Number(cost);
    if (!Number.isFinite(parsedCost)) {
      toasts.push('Cost must be a number', { kind: 'error' });
      return;
    }
    const parent = parentId === '' ? null : parentId;
    // If a library item was picked AND the user hasn't deviated from the
    // pick's name, link the new row back to the library entry.
    const linkedLibraryId =
      pickedLibraryItem && pickedLibraryItem.name === name.trim() ? pickedLibraryItem.id : null;
    const armorFromLibrary =
      linkedLibraryId && pickedLibraryItem?.isArmor && pickedLibraryItem.armor
        ? pickedLibraryItem.armor
        : null;

    setCreating(true);
    try {
      // Include every column on the LocalCharacterInventory row so the
      // encumbrance computation (which reads e.g. hideawayCapacityLbs from
      // the Dexie row) doesn't see `undefined` values and emit NaN.
      await enqueueCreate({
        entityClass: 'character_inventory',
        entityId: newClientId(),
        humanName: 'item',
        characterId,
        attemptedValue: {
          characterId,
          name: name.trim(),
          quantity: Math.max(1, parsedQty),
          weightLbs: parsedWeight,
          cost: parsedCost,
          notes: null,
          parentId: parent,
          externalLocation: null,
          worn: parent === null && newWorn,
          equipped: newEquipped,
          isContainer: newIsContainer,
          hideawayCapacityLbs: 0,
          weightReductionPercent: 0,
          isArmor: newIsArmor,
          armor: newIsArmor
            ? (armorFromLibrary ?? {
                locations: [],
                dr: 0,
                drCrushing: null,
                flexible: false,
                frontOnly: false,
                backOnly: false,
                notes: null,
              })
            : null,
          weaponData: null,
          libraryItemId: linkedLibraryId,
        },
      });
      setName('');
      setQty('1');
      setWeight('');
      setCost('');
      setParentId('');
      setNewIsContainer(false);
      setNewIsArmor(false);
      setNewWorn(false);
      setNewEquipped(false);
      setMoreOpen(false);
      setPickedLibraryItem(null);
    } catch (err) {
      toasts.push(`Couldn't add item — ${(err as Error).message}`, { kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

  // Containers eligible as a bulk-move target — exclude every selected item
  // and any of their descendants to avoid cycles.
  const bulkMoveTargets = useMemo(() => {
    if (count === 0) return [] as InventoryItemOut[];
    const blocked = new Set<string>();
    for (const id of selectedIds) {
      blocked.add(id);
      for (const d of descendantsOf(id, tree.byParent)) blocked.add(d);
    }
    return containers.filter((c) => !blocked.has(c.id));
  }, [containers, selectedIds, count, tree.byParent]);

  // ── Drag & drop ────────────────────────────────────────────────────────
  const draggedIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverValid, setHoverValid] = useState(true);

  function validateDrop(target: DragTarget): { ok: boolean; reason: string } {
    const draggedId = draggedIdRef.current;
    if (!draggedId) return { ok: false, reason: 'Nothing being dragged.' };
    const dragged = items.find((i) => i.id === draggedId);
    if (!dragged) return { ok: false, reason: 'Dragged item not found.' };
    if (target.kind === 'container') {
      if (target.id === draggedId) {
        return { ok: false, reason: "Can't drop an item onto itself." };
      }
      const targetItem = items.find((i) => i.id === target.id);
      if (!targetItem) return { ok: false, reason: 'Target not found.' };
      if (!targetItem.isContainer) {
        return { ok: false, reason: `${targetItem.name} isn't a container.` };
      }
      const blocked = descendantsOf(draggedId, tree.byParent);
      if (blocked.has(target.id)) {
        return { ok: false, reason: "Can't move a container into its own contents." };
      }
    }
    return { ok: true, reason: '' };
  }

  const dragApi: InventoryDragApi = {
    draggingId,
    hoverKey,
    hoverValid,
    onDragStart: (id) => {
      draggedIdRef.current = id;
      setDraggingId(id);
      setHoverKey(null);
    },
    onDragEnd: () => {
      draggedIdRef.current = null;
      setDraggingId(null);
      setHoverKey(null);
    },
    onDragOverTarget: (target, dt) => {
      if (!draggedIdRef.current) return;
      const v = validateDrop(target);
      const key = dragTargetKey(target);
      if (dt) dt.dropEffect = v.ok ? 'move' : 'none';
      if (hoverKey !== key) setHoverKey(key);
      if (hoverValid !== v.ok) setHoverValid(v.ok);
    },
    onDragLeaveTarget: (target) => {
      const key = dragTargetKey(target);
      setHoverKey((prev) => (prev === key ? null : prev));
    },
    onDrop: (target) => {
      const draggedId = draggedIdRef.current;
      if (!draggedId) {
        setHoverKey(null);
        return;
      }
      const v = validateDrop(target);
      draggedIdRef.current = null;
      setDraggingId(null);
      setHoverKey(null);
      if (!v.ok) {
        toasts.push(v.reason, { kind: 'error' });
        return;
      }
      let patch: InventoryItemUpdate;
      if (target.kind === 'container') patch = { parentId: target.id, worn: false };
      else if (target.kind === 'character') patch = { parentId: null, worn: true };
      else patch = { parentId: null, worn: false };
      void patchMany(draggedId, patch, 'Moved');
    },
  };

  // Selected items, used to drive the "majority" pressed state of the
  // Worn/Equipped toggles in the bulk header.
  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );
  const majorityWorn =
    selectedItems.length > 0 &&
    selectedItems.filter((i) => i.worn).length * 2 >= selectedItems.length;
  const majorityEquipped =
    selectedItems.length > 0 &&
    selectedItems.filter((i) => i.equipped).length * 2 >= selectedItems.length;

  const sumEffective = items.reduce((acc, i) => acc + i.effectiveWeightLbs, 0);
  const sumRaw = items.reduce((acc, i) => acc + i.weightLbs * i.quantity, 0);
  const totalCost = items.reduce((acc, i) => acc + i.cost * i.quantity, 0);

  // Aggregate counts/weight/cost for items in the Stashed section.
  const stashedSubtree = useMemo(
    () => flattenDFS(carriedRoots, tree.byParent),
    [carriedRoots, tree.byParent],
  );
  const stashedCount = stashedSubtree.reduce((acc, i) => acc + i.quantity, 0);
  const stashedWeight = stashedSubtree.reduce((acc, i) => acc + i.weightLbs * i.quantity, 0);
  const stashedCost = stashedSubtree.reduce((acc, i) => acc + i.cost * i.quantity, 0);

  function renderRows(rootList: InventoryItemOut[], opts: { inStashed?: boolean } = {}): ReactNode {
    return rootList.map((r) => (
      <InventoryRow
        key={r.id}
        item={r}
        depth={0}
        byParent={tree.byParent}
        isSelected={isSelected}
        onRowClick={handleClick}
        canEdit={canWrite}
        onEdit={(it) => setEditing(it)}
        {...(canWrite ? { drag: dragApi } : {})}
        {...(opts.inStashed ? { inStashed: true } : {})}
      />
    ));
  }

  const tableHead = (
    <thead>
      <tr className="text-base-content/50 text-[10px] uppercase tracking-wider">
        <th>Item</th>
        <th className="text-right">Qty</th>
        <th className="text-right">Wt</th>
        <th className="text-right">Cost</th>
        {canWrite && <th />}
      </tr>
    </thead>
  );

  return (
    <section className="card border border-base-300/60 bg-base-100 rounded-2xl overflow-visible">
      <header className="flex flex-wrap items-baseline gap-2 border-b border-base-300/60 px-5 py-3 text-sm">
        <span className="num text-base-content/60">
          {encumbrance.playerWeightLbs.toFixed(1)} lbs
        </span>
        <span className="text-base-content/40">·</span>
        <InfoTooltip
          content={
            <div className="grid gap-1.5">
              <div className="font-semibold text-base-content">Basic Lift</div>
              <div>
                How much you can lift overhead with one hand for a second. Drives encumbrance,
                hand-to-hand damage, and shove distance.
              </div>
              <div className="num text-base-content/60">
                BL = ST² ÷ 5 ={' '}
                <span className="text-base-content">{encumbrance.basicLift.toFixed(1)} lbs</span>
              </div>
            </div>
          }
        >
          <span className="num text-base-content/60">
            BL {encumbrance.basicLift.toFixed(1)} lbs
          </span>
        </InfoTooltip>
        <span className="text-base-content/40">·</span>
        <InfoTooltip
          content={
            <div className="grid gap-1.5">
              <div className="font-semibold text-base-content">Encumbrance</div>
              <div className="text-base-content/60">
                Carried weight relative to your Basic Lift.
              </div>
              <ul className="num grid gap-0.5">
                {[
                  { label: 'None', from: 0, to: encumbrance.basicLift, level: 0 },
                  {
                    label: 'Light',
                    from: encumbrance.basicLift,
                    to: encumbrance.basicLift * 2,
                    level: 1,
                  },
                  {
                    label: 'Medium',
                    from: encumbrance.basicLift * 2,
                    to: encumbrance.basicLift * 3,
                    level: 2,
                  },
                  {
                    label: 'Heavy',
                    from: encumbrance.basicLift * 3,
                    to: encumbrance.basicLift * 6,
                    level: 3,
                  },
                  {
                    label: 'X-Heavy',
                    from: encumbrance.basicLift * 6,
                    to: encumbrance.basicLift * 10,
                    level: 4,
                  },
                ].map((row) => (
                  <li
                    key={row.label}
                    className={`flex justify-between gap-3 ${
                      row.level === encumbrance.level
                        ? 'text-base-content font-semibold'
                        : 'text-base-content/60'
                    }`}
                  >
                    <span>{row.label}</span>
                    <span>
                      {row.from.toFixed(1)} – {row.to.toFixed(1)} lbs
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          }
        >
          <span className="inline-flex items-center gap-1">
            Encumbrance{' '}
            <span className="font-semibold text-base-content">
              {LEVEL_LABELS[encumbrance.level]}
            </span>
          </span>
        </InfoTooltip>
        <span className="grow" />
        <span className="num text-base-content/40 text-xs">
          tip: shift-click to select a range; ⌘/ctrl-click to toggle
        </span>
      </header>

      {canWrite && count > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-base-300/60 bg-primary/5 px-5 py-2.5 text-sm">
          <span className="num font-medium">{count} selected</span>
          <button
            type="button"
            onClick={clear}
            className="btn btn-ghost btn-xs text-base-content/60"
          >
            Clear
          </button>
          <span className="grow" />
          <div className="join">
            <button
              type="button"
              aria-pressed={majorityWorn}
              onClick={() =>
                void bulkPatch(
                  majorityWorn ? { worn: false } : { worn: true, parentId: null },
                  majorityWorn ? 'Unwore' : 'Wore',
                )
              }
              className={`btn btn-sm join-item ${majorityWorn ? 'btn-primary' : ''}`}
            >
              Worn
            </button>
            <button
              type="button"
              aria-pressed={majorityEquipped}
              onClick={() =>
                void bulkPatch(
                  { equipped: !majorityEquipped },
                  majorityEquipped ? 'Unequipped' : 'Equipped',
                )
              }
              className={`btn btn-sm join-item ${majorityEquipped ? 'btn-primary' : ''}`}
            >
              Equipped
            </button>
          </div>
          <div className="dropdown dropdown-end">
            <button type="button" className="btn btn-sm">
              Move to container ▾
            </button>
            <ul className="dropdown-content menu menu-sm bg-base-100 border border-base-300/60 rounded-box shadow-lg z-30 w-56 max-h-72 overflow-y-auto">
              <li>
                <button
                  type="button"
                  className="text-primary font-medium"
                  onClick={() =>
                    void bulkPatch({ parentId: null, worn: true }, 'Moved to Character:')
                  }
                >
                  Character
                  <span className="text-base-content/40 text-[10px]">worn</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="text-primary font-medium"
                  onClick={() =>
                    void bulkPatch({ parentId: null, worn: false }, 'Moved to Stashed:')
                  }
                >
                  Stashed
                  <span className="text-base-content/40 text-[10px]">off-player</span>
                </button>
              </li>
              <li className="border-b border-base-300/60 my-1" aria-hidden />
              {bulkMoveTargets.length === 0 && (
                <li className="text-base-content/40 text-xs px-2 py-1">No other containers</li>
              )}
              {bulkMoveTargets.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() =>
                      void bulkPatch({ parentId: c.id, worn: false }, `Moved to ${c.name}:`)
                    }
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => setConfirmBulkDelete(true)}
            className="btn btn-sm btn-error btn-outline"
          >
            Delete {count}
          </button>
        </div>
      )}

      {items.length === 0 && (
        <div className="p-8 text-center text-base-content/60 text-sm">
          No items yet. Add your first below.
        </div>
      )}

      {items.length > 0 && (
        <div className="px-5 py-4 space-y-6">
          <section
            onDragOver={
              canWrite
                ? (e) => {
                    if (!draggedIdRef.current) return;
                    e.preventDefault();
                    dragApi.onDragOverTarget({ kind: 'character' }, e.dataTransfer);
                  }
                : undefined
            }
            onDragLeave={
              canWrite
                ? (e) => {
                    if (e.currentTarget !== e.target) return;
                    dragApi.onDragLeaveTarget({ kind: 'character' });
                  }
                : undefined
            }
            onDrop={
              canWrite
                ? (e) => {
                    e.preventDefault();
                    dragApi.onDrop({ kind: 'character' });
                  }
                : undefined
            }
            className={`rounded-xl py-2 transition-colors ${
              hoverKey === 'character'
                ? hoverValid
                  ? 'ring-2 ring-success/40 bg-success/5'
                  : 'ring-2 ring-error/40 bg-error/5'
                : ''
            }`}
          >
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="font-display text-lg">On the player</h3>
              <span className="label-eyebrow">
                {wornRoots.length} worn item{wornRoots.length === 1 ? '' : 's'}
              </span>
            </div>
            {wornRoots.length === 0 ? (
              <p className="text-base-content/60 text-sm">
                Nothing worn — encumbrance is 0. Drop items here to wear them.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-base-300/60">
                <table className="table table-zebra">
                  {tableHead}
                  <tbody>{renderRows(wornRoots)}</tbody>
                </table>
              </div>
            )}
          </section>

          <section
            onDragOver={
              canWrite
                ? (e) => {
                    if (!draggedIdRef.current) return;
                    e.preventDefault();
                    dragApi.onDragOverTarget({ kind: 'stashed' }, e.dataTransfer);
                  }
                : undefined
            }
            onDragLeave={
              canWrite
                ? (e) => {
                    if (e.currentTarget !== e.target) return;
                    dragApi.onDragLeaveTarget({ kind: 'stashed' });
                  }
                : undefined
            }
            onDrop={
              canWrite
                ? (e) => {
                    e.preventDefault();
                    dragApi.onDrop({ kind: 'stashed' });
                  }
                : undefined
            }
            className={`rounded-xl py-2 transition-colors ${
              hoverKey === 'stashed'
                ? hoverValid
                  ? 'ring-2 ring-success/40 bg-success/5'
                  : 'ring-2 ring-error/40 bg-error/5'
                : ''
            }`}
          >
            <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
              <h3 className="font-display text-lg">Stashed</h3>
              <span className="num text-xs text-base-content/60 flex items-baseline gap-3">
                <span>
                  <span className="text-base-content/40">qty </span>
                  <span className="font-semibold text-base-content">{stashedCount}</span>
                </span>
                <span>
                  <span className="text-base-content/40">wt </span>
                  <span className="font-semibold text-base-content">
                    {stashedWeight.toFixed(1)} lb
                  </span>
                </span>
                <span>
                  <span className="text-base-content/40">cost </span>
                  <span className="font-semibold text-base-content">{stashedCost.toFixed(0)}</span>
                </span>
              </span>
            </div>
            {carriedRoots.length === 0 ? (
              <p className="text-base-content/60 text-sm">
                Nothing stashed. Drop items here to set them aside.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-base-300/60">
                <table className="table table-zebra">
                  {tableHead}
                  <tbody>{renderRows(carriedRoots, { inStashed: true })}</tbody>
                </table>
              </div>
            )}
          </section>

          <div className="flex flex-wrap items-baseline gap-4 border-t border-base-300/60 pt-3 text-xs">
            <span className="label-eyebrow">Totals</span>
            <span className="num">
              <span className="text-base-content/40">encumbrance </span>
              <span className="font-semibold text-base-content">{sumEffective.toFixed(1)} lb</span>
            </span>
            <span className="num">
              <span className="text-base-content/40">raw </span>
              {sumRaw.toFixed(1)} lb
            </span>
            <span className="num">
              <span className="text-base-content/40">cost </span>
              {totalCost.toFixed(0)}
            </span>
            <span className="num text-base-content/40">
              BL {encumbrance.basicLift.toFixed(0)} → {LEVEL_LABELS[encumbrance.level]}
            </span>
          </div>
        </div>
      )}

      {canWrite && (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="flex flex-col gap-2 border-t border-base-300/60 bg-base-200/40 px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            {campaignId ? (
              <div className="flex-1 min-w-[200px]">
                <LibraryAutocomplete<LibraryItemOut>
                  value={name}
                  onChange={(v) => {
                    setName(v);
                    if (pickedLibraryItem && v !== pickedLibraryItem.name) {
                      setPickedLibraryItem(null);
                    }
                  }}
                  onPick={onPickLibraryItem}
                  fetchOptions={fetchOptions}
                  getOptionKey={(o) => o.id}
                  renderOption={(o) => (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{o.name}</span>
                      <span className="text-xs text-base-content/60">
                        {o.category} · {o.weightLbs} lb · ${o.cost}
                      </span>
                    </div>
                  )}
                  placeholder="Item name (type to search library)"
                  aria-label="Item name"
                />
              </div>
            ) : (
              <input
                placeholder="Item name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input input-sm input-bordered flex-1 min-w-[200px]"
                aria-label="Item name"
              />
            )}
            <input
              placeholder="Qty"
              value={qty}
              inputMode="numeric"
              onChange={(e) => setQty(e.target.value)}
              className="num input input-sm input-bordered w-16 text-right"
              aria-label="Quantity"
            />
            <input
              placeholder="Weight"
              value={weight}
              inputMode="decimal"
              onChange={(e) => setWeight(e.target.value)}
              className="num input input-sm input-bordered w-24 text-right"
              aria-label="Weight (lbs)"
            />
            <input
              placeholder="Cost"
              value={cost}
              inputMode="decimal"
              onChange={(e) => setCost(e.target.value)}
              className="num input input-sm input-bordered w-24 text-right"
              aria-label="Cost"
            />
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="select select-sm select-bordered"
              aria-label="Parent container"
            >
              <option value="">— No parent —</option>
              {containers.map((c) => (
                <option key={c.id} value={c.id}>
                  in {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className="btn btn-ghost btn-sm text-base-content/60"
              aria-expanded={moreOpen}
            >
              {moreOpen ? 'Less' : 'More'} options
            </button>
            <button type="submit" disabled={creating} className="btn btn-sm btn-primary">
              Add
            </button>
          </div>
          {moreOpen && (
            <div className="flex flex-wrap items-center gap-4 border-t border-base-300/60 pt-2 text-xs">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={newIsContainer}
                  onChange={(e) => setNewIsContainer(e.target.checked)}
                />
                <span>Container</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={newIsArmor}
                  onChange={(e) => setNewIsArmor(e.target.checked)}
                />
                <span>Armor</span>
              </label>
              {parentId === '' && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={newWorn}
                    onChange={(e) => setNewWorn(e.target.checked)}
                  />
                  <span>Worn</span>
                </label>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={newEquipped}
                  onChange={(e) => setNewEquipped(e.target.checked)}
                />
                <span>Equipped</span>
              </label>
              {(newIsContainer || newIsArmor) && (
                <span className="text-base-content/40">
                  Save first; tune capacity / DR / locations from the row's Edit menu.
                </span>
              )}
            </div>
          )}
        </form>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${count} item${count === 1 ? '' : 's'}?`}
        confirmLabel="Delete"
        tone="error"
        onConfirm={() => void bulkDelete()}
        onCancel={() => setConfirmBulkDelete(false)}
      >
        These items will be permanently removed from this character's inventory.
      </ConfirmDialog>

      <ItemEditDialog
        open={editing !== null}
        item={editing}
        onCancel={() => setEditing(null)}
        onSubmit={(patch) => {
          if (editing) {
            void patchMany(editing.id, patch, 'Updated').then(() => setEditing(null));
          }
        }}
      />
    </section>
  );
}
