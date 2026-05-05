import { useMemo, useRef, useState } from 'react';
import type { LibraryItemOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { useDraftToggle } from '../../../hooks/useDraftToggle.ts';
import { type RangeSelectClickEvent, useRangeSelect } from '../../../hooks/useRangeSelect.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueFieldPatch,
  newClientId,
} from '../../../sync/outbox.ts';
import { type InventoryTree, buildTree, flattenDFS, validateReparent } from './inventoryTree.ts';
import { useLibraryFetcher } from './useLibraryFetcher.ts';

function fmtWeight(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

// ---------- Add form (unchanged) ----------

interface ItemSnapshot {
  name: string;
  nameRaw: string;
  quantity: number;
  quantityRaw: string;
  weightLbs: number;
  weightRaw: string;
  libraryItemId: string | null;
}

function AddItemForm({
  characterId,
  campaignId,
  canWrite,
}: {
  characterId: string;
  campaignId: string | null;
  canWrite: boolean;
}) {
  const toasts = useToasts();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [weight, setWeight] = useState('0');
  const [creating, setCreating] = useState(false);
  const [pickedLibraryId, setPickedLibraryId] = useState<string | null>(null);

  const { fetchOptions } = useLibraryFetcher<LibraryItemOut>('items', campaignId);

  async function submit(snap: ItemSnapshot) {
    setCreating(true);
    try {
      await enqueueCreate({
        entityClass: 'character_inventory',
        entityId: newClientId(),
        humanName: 'item',
        characterId,
        attemptedValue: {
          name: snap.name,
          quantity: snap.quantity,
          weightLbs: snap.weightLbs,
          characterId,
          ...(snap.libraryItemId ? { libraryItemId: snap.libraryItemId } : {}),
        },
      });
      // Per AGENTS.md (rule 1: never silently discard user edits): only
      // reset fields whose current value still matches what we
      // submitted.  If the user has started typing the next item while
      // this enqueue was in flight, leave that draft in place.
      if (name === snap.nameRaw) setName('');
      if (quantity === snap.quantityRaw) setQuantity('1');
      if (weight === snap.weightRaw) setWeight('0');
      setPickedLibraryId(null);
    } catch (err) {
      toasts.push(`Couldn't add item — ${(err as Error).message}`, { kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

  if (!canWrite) return null;

  return (
    <form
      className="flex flex-wrap items-end gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        // `Number.isFinite` preserves valid 0 (e.g. a quest token with
        // 0 weight or a quantity-tracked stack at 0).  `Number(...) || 1`
        // would silently coerce 0 to 1.
        const qParsed = Number(quantity);
        const wParsed = Number(weight);
        void submit({
          name: name.trim(),
          nameRaw: name,
          quantity: Number.isFinite(qParsed) ? qParsed : 1,
          quantityRaw: quantity,
          weightLbs: Number.isFinite(wParsed) ? wParsed : 0,
          weightRaw: weight,
          libraryItemId: pickedLibraryId,
        });
      }}
    >
      <div className="form-control flex-1 min-w-[12rem]">
        <span className="label-text text-xs" id="add-item-name-label">
          Item name
        </span>
        {campaignId ? (
          <LibraryAutocomplete<LibraryItemOut>
            value={name}
            onChange={(v) => {
              setName(v);
              setPickedLibraryId(null);
            }}
            onPick={(opt) => {
              setName(opt.name);
              setQuantity(String(opt.defaultQuantity));
              setWeight(String(opt.weightLbs));
              setPickedLibraryId(opt.id);
            }}
            fetchOptions={fetchOptions}
            getOptionKey={(o) => o.id}
            renderOption={(o) => (
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate">
                  {o.name}
                  {o.category && o.category !== 'general' ? (
                    <span className="ml-1 text-[10px] uppercase tracking-wider text-base-content/50">
                      {o.category}
                    </span>
                  ) : null}
                </span>
                <span className="num text-xs text-base-content/70">
                  {o.weightLbs.toFixed(2)} lb
                </span>
              </span>
            )}
            placeholder="e.g. Backpack"
            inputProps={{ 'aria-labelledby': 'add-item-name-label' }}
          />
        ) : (
          <input
            aria-labelledby="add-item-name-label"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Backpack"
          />
        )}
      </div>
      <label className="form-control w-20">
        <span className="label-text text-xs">Qty</span>
        <input
          className="input input-bordered input-sm num"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>
      <label className="form-control w-24">
        <span className="label-text text-xs">Wt (lb)</span>
        <input
          className="input input-bordered input-sm num"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={creating}>
        {creating ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}

// ---------- Drag-and-drop wiring ----------
//
// A drop target is either a container row (drop into that container)
// or the root drop zone (drop at top level). The drag uses the HTML5
// drag-and-drop API, with `dataTransfer.setData('text/inventory-item-id',
// id)` as the payload so we can ignore unrelated drags (e.g. text
// drops from outside the page).

type DropTarget = { kind: 'container'; id: string } | { kind: 'root' };

function dropTargetKey(t: DropTarget): string {
  return t.kind === 'container' ? `container:${t.id}` : 'root';
}

interface DragApi {
  draggingId: string | null;
  hoverKey: string | null;
  hoverValid: boolean;
  onDragStart(id: string, dt: DataTransfer | null): void;
  onDragEnd(): void;
  onDragOver(target: DropTarget, dt: DataTransfer | null): void;
  onDragLeave(target: DropTarget): void;
  onDrop(target: DropTarget): void;
}

const MIME = 'text/x-inventory-item-id';

function useInventoryDrag(
  items: readonly InventoryItemOut[],
  tree: InventoryTree,
  onReparent: (itemId: string, newParentId: string | null) => void,
  onValidationFail: (reason: string) => void,
): DragApi {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverValid, setHoverValid] = useState(true);
  // Mirror of draggingId in a ref so dragover handlers can read the
  // current value synchronously without going through state.
  const draggedIdRef = useRef<string | null>(null);

  function evaluate(target: DropTarget): { ok: boolean; reason: string } {
    const draggedId = draggedIdRef.current;
    if (!draggedId) return { ok: false, reason: 'Nothing being dragged.' };
    if (target.kind === 'container') {
      const container = tree.byId.get(target.id);
      if (!container) return { ok: false, reason: 'Drop target not found.' };
      if (!container.isContainer) {
        return { ok: false, reason: 'That item is not a container.' };
      }
    }
    const newParent = target.kind === 'container' ? target.id : null;
    const v = validateReparent(draggedId, newParent, tree.byParent);
    return v.ok ? { ok: true, reason: '' } : { ok: false, reason: v.reason };
  }

  return {
    draggingId,
    hoverKey,
    hoverValid,
    onDragStart(id, dt) {
      draggedIdRef.current = id;
      setDraggingId(id);
      if (dt) {
        try {
          dt.setData(MIME, id);
          dt.effectAllowed = 'move';
        } catch {
          /* drag types are immutable mid-drag in some browsers; ignore */
        }
      }
    },
    onDragEnd() {
      draggedIdRef.current = null;
      setDraggingId(null);
      setHoverKey(null);
      setHoverValid(true);
    },
    onDragOver(target, dt) {
      const result = evaluate(target);
      setHoverKey(dropTargetKey(target));
      setHoverValid(result.ok);
      if (dt) dt.dropEffect = result.ok ? 'move' : 'none';
    },
    onDragLeave(target) {
      const key = dropTargetKey(target);
      setHoverKey((cur) => (cur === key ? null : cur));
    },
    onDrop(target) {
      const draggedId = draggedIdRef.current;
      const result = evaluate(target);
      draggedIdRef.current = null;
      setDraggingId(null);
      setHoverKey(null);
      setHoverValid(true);
      if (!draggedId) return;
      if (!result.ok) {
        onValidationFail(result.reason);
        return;
      }
      const newParentId = target.kind === 'container' ? target.id : null;
      // Touch unused list for type safety
      void items;
      onReparent(draggedId, newParentId);
    },
  };
}

// ---------- Item row ----------

interface ItemRowProps {
  characterId: string;
  item: InventoryItemOut;
  canWrite: boolean;
  drag: DragApi | null;
  selected: boolean;
  /** Click handler that drives range-select. */
  onSelect(id: string, ev: RangeSelectClickEvent): void;
  /** Children to render nested below the row (for containers). */
  children?: React.ReactNode;
  /** Indent level for nested rendering (0 = root). */
  depth: number;
}

function ItemRow({
  characterId,
  item,
  canWrite,
  drag,
  selected,
  onSelect,
  children,
  depth,
}: ItemRowProps) {
  const toasts = useToasts();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const patchItem = (field: string, value: unknown) =>
    enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId: item.id,
      fieldPath: field,
      attemptedValue: value,
      humanName: `${item.name} ${field}`,
      flashKey: makeFlashKey('character_inventory', item.id, field),
      characterId,
    });

  const nameField = useDraftField<string>({
    name: `${item.name} name`,
    serverValue: item.name,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    onSave: (v) => patchItem('name', v),
    flashKey: makeFlashKey('character_inventory', item.id, 'name'),
  });
  const qtyField = useDraftField<number>({
    name: `${item.name} quantity`,
    serverValue: item.quantity,
    parse: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0)
        throw new Error('non-negative integer only');
      return n;
    },
    onSave: (v) => patchItem('quantity', v),
    flashKey: makeFlashKey('character_inventory', item.id, 'quantity'),
  });
  const weightField = useDraftField<number>({
    name: `${item.name} weight`,
    serverValue: item.weightLbs,
    parse: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) throw new Error('non-negative number only');
      return n;
    },
    format: (v) => fmtWeight(v),
    onSave: (v) => patchItem('weightLbs', v),
    flashKey: makeFlashKey('character_inventory', item.id, 'weightLbs'),
  });

  // Use the same draft-with-queue pattern as text fields so rapid
  // toggles (check, then immediately uncheck) serialize through the
  // outbox with the latest click winning.
  const wornToggle = useDraftToggle({
    name: `${item.name} worn`,
    serverValue: item.worn,
    onSave: (v) => patchItem('worn', v),
    flashKey: makeFlashKey('character_inventory', item.id, 'worn'),
  });
  const equippedToggle = useDraftToggle({
    name: `${item.name} equipped`,
    serverValue: item.equipped,
    onSave: (v) => patchItem('equipped', v),
    flashKey: makeFlashKey('character_inventory', item.id, 'equipped'),
  });

  const removeItem = async () => {
    try {
      await enqueueDelete({
        entityClass: 'character_inventory',
        entityId: item.id,
        humanName: `item "${item.name}"`,
        characterId,
        prevValue: item,
      });
    } catch (err) {
      toasts.push(`Couldn't delete item — ${(err as Error).message}`, { kind: 'error' });
    }
  };

  const isContainerTarget =
    drag !== null &&
    item.isContainer &&
    drag.hoverKey === `container:${item.id}` &&
    drag.draggingId !== item.id;
  const dropToneClass = isContainerTarget
    ? drag.hoverValid
      ? 'ring-2 ring-success/60 bg-success/5'
      : 'ring-2 ring-error/60 bg-error/5'
    : '';
  const draggingClass = drag?.draggingId === item.id ? 'opacity-50' : '';
  const selectedClass = selected ? 'bg-primary/10' : '';

  // Keyboard parity for the row's mouse-click selection: Space/Enter
  // toggles selection of the focused row, matching the ⌘/Ctrl-click
  // behaviour. Range/extend selection still requires a mouse — keyboard
  // multi-select is out of scope for this PR.
  const onRowKeyDown = (e: React.KeyboardEvent<HTMLLIElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      // Don't hijack inputs that should handle their own Space / Enter.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLButtonElement ||
        e.target instanceof HTMLLabelElement
      ) {
        return;
      }
      e.preventDefault();
      onSelect(item.id, { shiftKey: false, metaKey: true, ctrlKey: e.ctrlKey });
    }
  };

  return (
    <>
      <li
        className={`grid grid-cols-[auto_1fr_4rem_5rem_5rem_auto_auto] gap-2 items-center py-2 border-b border-base-300 last:border-0 ${dropToneClass} ${draggingClass} ${selectedClass}`}
        style={{ paddingLeft: `${depth * 16}px` }}
        draggable={canWrite && drag !== null}
        // tabIndex=-1 makes the row programmatically focusable (so the
        // browser will dispatch keydown to it) without putting it in
        // the tab order — keyboard tabbing still flows through the
        // inputs inside the row, matching the legacy gurps-player-web UX.
        tabIndex={-1}
        onDragStart={(e) => {
          if (!canWrite || !drag) return;
          drag.onDragStart(item.id, e.dataTransfer);
        }}
        onDragEnd={() => drag?.onDragEnd()}
        onDragOver={(e) => {
          if (!drag || !item.isContainer) return;
          if (drag.draggingId === item.id) return;
          // Without preventDefault here, the browser refuses to fire `drop`.
          e.preventDefault();
          drag.onDragOver({ kind: 'container', id: item.id }, e.dataTransfer);
        }}
        onDragLeave={() => drag?.onDragLeave({ kind: 'container', id: item.id })}
        onDrop={(e) => {
          if (!drag || !item.isContainer) return;
          e.preventDefault();
          drag.onDrop({ kind: 'container', id: item.id });
        }}
        onClick={(e) => onSelect(item.id, e)}
        onKeyDown={onRowKeyDown}
      >
        <span aria-hidden="true" className="text-base-content/30 cursor-grab select-none">
          {drag !== null && canWrite ? '⋮⋮' : ''}
        </span>
        <div className="min-w-0">
          {canWrite ? (
            <input
              aria-label={`${item.name} name`}
              className={`${DRAFT_FIELD_CLASS} input input-ghost input-sm font-medium w-full`}
              {...nameField.inputProps}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="font-medium">{item.name}</span>
          )}
          <div className="flex gap-2 text-xs">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the onClick on the <label> only stops
                the row's mouse-click selection from firing when the user is hitting the inner
                checkbox; keyboard activation lands on the <input> directly and never bubbles to
                this label, so an onKeyDown here would be dead code. */}
            <label className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                className={`${DRAFT_FIELD_CLASS} checkbox checkbox-xs`}
                checked={canWrite ? wornToggle.checked : item.worn}
                onChange={() => canWrite && wornToggle.toggle()}
                disabled={!canWrite}
                aria-label={`${item.name} worn`}
                {...wornToggle.flashProps}
              />
              worn
            </label>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the onClick on the <label> only stops
                the row's mouse-click selection from firing when the user is hitting the inner
                checkbox; keyboard activation lands on the <input> directly and never bubbles to
                this label, so an onKeyDown here would be dead code. */}
            <label className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                className={`${DRAFT_FIELD_CLASS} checkbox checkbox-xs`}
                checked={canWrite ? equippedToggle.checked : item.equipped}
                onChange={() => canWrite && equippedToggle.toggle()}
                disabled={!canWrite}
                aria-label={`${item.name} equipped`}
                {...equippedToggle.flashProps}
              />
              equipped
            </label>
            {item.isContainer && (
              <span
                className="badge badge-ghost badge-xs"
                title="Container — items can be dropped into this row"
              >
                container
              </span>
            )}
          </div>
        </div>
        {canWrite ? (
          <input
            aria-label={`${item.name} quantity`}
            className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
            {...qtyField.inputProps}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="num text-right">{item.quantity}</span>
        )}
        {canWrite ? (
          <input
            aria-label={`${item.name} weight`}
            className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
            {...weightField.inputProps}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="num text-right">{fmtWeight(item.weightLbs)}</span>
        )}
        <span
          className="num text-right text-base-content/70"
          aria-label={`${item.name} effective weight`}
        >
          {fmtWeight(item.effectiveWeightLbs)}
        </span>
        <span className="text-xs text-base-content/50">
          {item.worn ? 'worn' : item.equipped ? 'equip' : 'pack'}
        </span>
        {canWrite && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
            aria-label={`Delete item ${item.name}`}
          >
            ✕
          </button>
        )}
        {canWrite && (
          <ConfirmDialog
            open={confirmOpen}
            title="Delete item?"
            confirmLabel="Delete"
            tone="error"
            onConfirm={() => {
              setConfirmOpen(false);
              void removeItem();
            }}
            onCancel={() => setConfirmOpen(false)}
          >
            Permanently remove <strong>{item.name}</strong> from this character's inventory.
          </ConfirmDialog>
        )}
      </li>
      {children}
    </>
  );
}

// ---------- Main panel ----------

export function InventoryPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const toasts = useToasts();
  const items = character.inventory;
  const tree = useMemo(() => buildTree(items), [items]);
  const roots = tree.byParent.get(null) ?? [];

  // Flat DFS order of all items so range-select indices are stable
  // even when containers reorder their children.
  const orderedIds = useMemo(
    () => flattenDFS(roots, tree.byParent).map((i) => i.id),
    [roots, tree.byParent],
  );
  const selection = useRangeSelect(orderedIds);

  function reparent(itemId: string, newParentId: string | null): void {
    void enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId: itemId,
      fieldPath: 'parentId',
      attemptedValue: newParentId,
      humanName: 'inventory parent',
      flashKey: makeFlashKey('character_inventory', itemId, 'parentId'),
      characterId: character.id,
    });
  }

  const drag = useInventoryDrag(items, tree, reparent, (reason) =>
    toasts.push(reason, { kind: 'error' }),
  );

  // Bulk-delete the current selection. Each delete enqueues its own
  // outbox op so a partial failure rolls back per-item.
  async function bulkDelete() {
    if (selection.count === 0) return;
    for (const id of selection.selectedIds) {
      const target = tree.byId.get(id);
      if (!target) continue;
      try {
        await enqueueDelete({
          entityClass: 'character_inventory',
          entityId: id,
          humanName: `item "${target.name}"`,
          characterId: character.id,
          prevValue: target,
        });
      } catch (err) {
        toasts.push(`Couldn't delete "${target.name}" — ${(err as Error).message}`, {
          kind: 'error',
        });
      }
    }
    selection.clear();
  }

  // Bulk-toggle worn for the selection. Sends `true` when at least one
  // selected item is currently `worn:false`, otherwise sends `false`.
  function bulkSetWorn(worn: boolean) {
    for (const id of selection.selectedIds) {
      const target = tree.byId.get(id);
      if (!target || target.worn === worn) continue;
      void enqueueFieldPatch({
        entityClass: 'character_inventory',
        entityId: id,
        fieldPath: 'worn',
        attemptedValue: worn,
        humanName: `${target.name} worn`,
        flashKey: makeFlashKey('character_inventory', id, 'worn'),
        characterId: character.id,
      });
    }
  }

  const totalRaw = items.reduce((sum, i) => sum + i.weightLbs * i.quantity, 0);

  // Recursive renderer — emits one <ItemRow> per node, with descendants
  // nested as the row's `children` so React keys + DnD targets stay stable.
  const renderNode = (node: InventoryItemOut, depth: number): React.ReactNode => {
    const kids = tree.byParent.get(node.id) ?? [];
    return (
      <ItemRow
        key={node.id}
        characterId={character.id}
        item={node}
        canWrite={canWrite}
        drag={canWrite ? drag : null}
        selected={selection.isSelected(node.id)}
        onSelect={selection.handleClick}
        depth={depth}
      >
        {kids.map((k) => renderNode(k, depth + 1))}
      </ItemRow>
    );
  };

  const rootHover = drag.hoverKey === 'root';
  const rootDropClass =
    rootHover && drag.draggingId !== null
      ? drag.hoverValid
        ? 'ring-2 ring-success/60 bg-success/5'
        : 'ring-2 ring-error/60 bg-error/5'
      : '';

  return (
    <section className="card space-y-3 p-5">
      <header className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <p className="label-eyebrow">Inventory</p>
          <h2 className="font-display text-2xl">Carried &amp; equipped</h2>
        </div>
        <div className="text-right">
          <p className="text-xs text-base-content/60">
            <span className="num">{items.length}</span> {items.length === 1 ? 'item' : 'items'}
          </p>
          <p className="text-xs text-base-content/60">
            <span className="num">{fmtWeight(character.encumbrance.playerWeightLbs)}</span>/
            <span className="num">{fmtWeight(totalRaw)}</span> lb worn/raw
          </p>
        </div>
      </header>

      <AddItemForm
        characterId={character.id}
        campaignId={character.campaignId ?? null}
        canWrite={canWrite}
      />

      {canWrite && selection.count > 0 && (
        <div
          className="flex items-center justify-between gap-2 rounded border border-primary/40 bg-primary/5 px-3 py-2 text-xs"
          aria-live="polite"
        >
          <span>
            <strong className="num">{selection.count}</strong> selected
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => bulkSetWorn(true)}
            >
              Mark worn
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => bulkSetWorn(false)}
            >
              Stash
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              onClick={() => void bulkDelete()}
            >
              Delete
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => selection.clear()}
            >
              Clear
            </button>
          </span>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-base-content/60">No items yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[auto_1fr_4rem_5rem_5rem_auto_auto] gap-2 label-eyebrow border-b border-base-300 pb-1">
            <span />
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Wt</span>
            <span className="text-right">Eff</span>
            <span />
            <span />
          </div>
          {/*
           * The <ul> doubles as the root drop zone. HTML5 DnD semantics
           * are inherently mouse/touch-driven; there's no a11y rule here
           * about adding keyboard parity to drag handlers because biome
           * v1.9 doesn't ship the corresponding rule and the legacy
           * gurps-player-web app shipped with the same accommodation.
           */}
          <ul
            className={`rounded ${rootDropClass}`}
            onDragOver={(e) => {
              if (!canWrite || !drag.draggingId) return;
              e.preventDefault();
              drag.onDragOver({ kind: 'root' }, e.dataTransfer);
            }}
            onDragLeave={() => drag.onDragLeave({ kind: 'root' })}
            onDrop={(e) => {
              if (!canWrite || !drag.draggingId) return;
              e.preventDefault();
              drag.onDrop({ kind: 'root' });
            }}
          >
            {roots.map((r) => renderNode(r, 0))}
          </ul>
          {canWrite && (
            <p className="text-[11px] text-base-content/50">
              Drag a row onto a container badge to nest it; drop onto the list edge to move it back
              to the top level. Click to select; shift-click for a range; ⌘/Ctrl-click to toggle.
            </p>
          )}
        </>
      )}
    </section>
  );
}
