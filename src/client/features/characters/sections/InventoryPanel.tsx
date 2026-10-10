import { inventoryAvailability } from '../../../../shared/domain/inventoryAvailability.ts';
import { formatEquipmentNumber } from '../../../../shared/format/number.ts';
import type { PricingResolution } from '../../../../shared/schemas/calculation.ts';
import { Table } from '../../../components/ui/Table.tsx';
import { PricingResolver } from '../../library/PricingResolver.tsx';
import { pricingDisplayValue } from '../../library/pricingDisplay.ts';
/**
 * Inventory location and equipment workspace:
 *  - "On the player" / "Stashed" location uses the legacy `worn` root flag
 *  - Encumbrance + Basic Lift header with InfoTooltip explainers
 *  - Selection-driven bulk toolbar (equipped majority toggle +
 *    location dropdown + bulk delete)
 *  - Add form with location, library autocomplete and a "More options" expander
 *    (container / armor / equipped flags at create time)
 *  - Per-row inline category editors, with autosaved fields and optional details
 *  - DnD between rows / character / stashed targets, with valid/invalid
 *    visual feedback
 *
 * Mutations route through this repo's outbox (`useAddEntityForm`'s
 * `enqueueCreate`, plus direct `enqueueDelete` / `enqueueFieldPatch`
 * calls) instead of the original TanStack `useMutation` calls;
 * everything else mirrors the source.
 */

import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { skillDisplayName } from '../../../../shared/domain/defenseCalc.ts';
import type {
  LibraryEnchantmentOut,
  LibraryItemOut,
} from '../../../../shared/schemas/campaignLibrary.ts';
import type {
  InventoryItemOut,
  InventoryItemUpdate,
} from '../../../../shared/schemas/inventory.ts';
import { AppIcon } from '../../../components/ui/AppIcon.tsx';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { InfoTooltip } from '../../../components/ui/InfoTooltip.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { useAppHeaderBottom } from '../../../hooks/useAppHeaderBottom.ts';
import { useDialogState } from '../../../hooks/useDialogState.ts';
import { useFlashState } from '../../../hooks/useFlashState.ts';
import { useRangeSelect } from '../../../hooks/useRangeSelect.ts';
import { useViewportBoundedOverlay } from '../../../hooks/useViewportBoundedOverlay.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import { enqueueDeletes, enqueueFieldPatches } from '../../../sync/outbox.ts';
import type { EffectAwareCharacterDetail as CharacterDetail } from '../useCharacterDetail.ts';
import { FacetChipRow } from './FacetChips.tsx';
import { InventoryRow } from './InventoryRow.tsx';
import {
  type InventoryList,
  readInventoryTablePreferences,
  saveInventoryTablePreferences,
} from './inventoryTablePreferences.ts';
import {
  type InventorySort,
  buildTree,
  descendantsOf,
  filterInventoryTree,
  flattenDFS,
  inventoryCostTotals,
  inventoryFilterValues,
  sortInventoryTree,
} from './inventoryTree.ts';
import type { TablePreferences } from './tablePreferences.ts';
import { useAddEntityForm } from './useAddEntityForm.ts';
import { useLibraryFetcher } from './useLibraryFetcher.ts';
import { SortableHeader } from './useSortableCharacterRows.tsx';

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
  anchorItemId,
}: {
  character: CharacterDetail;
  canWrite: boolean;
  anchorItemId?: string | null;
}) {
  const characterId = character.id;
  const campaignId = character.campaignId ?? null;
  const encumbrance = character.encumbrance;
  const items = character.inventory;
  const toasts = useToasts();
  const headerBottom = useAppHeaderBottom();
  const bulkMoveMenuRef = useViewportBoundedOverlay<HTMLUListElement>(true, undefined, {
    shiftVertically: true,
    minimumTop: headerBottom,
  });

  const [filterText, setFilterText] = useState('');
  const [sorts, setSorts] = useState(() => ({
    worn: readInventoryTablePreferences(characterId, 'worn'),
    stashed: readInventoryTablePreferences(characterId, 'stashed'),
  }));
  const [sortSaveFailed, setSortSaveFailed] = useState(false);
  function sortBy(list: InventoryList, sort: InventorySort) {
    const current = sorts[list];
    const next: TablePreferences<InventorySort> = {
      order: [],
      sort,
      descending: current.sort === sort ? !current.descending : false,
    };
    setSorts((before) => ({ ...before, [list]: next }));
    setSortSaveFailed(!saveInventoryTablePreferences(characterId, list, next));
  }
  const [resetForAnchor, setResetForAnchor] = useState<string | null>(null);
  const revealingNewAnchor = Boolean(anchorItemId && resetForAnchor !== anchorItemId);
  useEffect(() => {
    if (anchorItemId && resetForAnchor !== anchorItemId) {
      setFilterText('');
      setResetForAnchor(anchorItemId);
    }
  }, [anchorItemId, resetForAnchor]);
  const filterActive = !revealingNewAnchor && filterText.trim().length > 0;

  const tree = useMemo(() => buildTree(items), [items]);
  const filteredTree = useMemo(
    () => filterInventoryTree(items, revealingNewAnchor ? '' : filterText),
    [items, filterText, revealingNewAnchor],
  );
  const costTotals = useMemo(() => inventoryCostTotals(items), [items]);
  const wornByParent = useMemo(
    () =>
      sortInventoryTree(
        filteredTree.byParent,
        sorts.worn.sort,
        sorts.worn.descending,
        false,
        costTotals,
      ),
    [filteredTree.byParent, sorts.worn, costTotals],
  );
  const stashedByParent = useMemo(
    () =>
      sortInventoryTree(
        filteredTree.byParent,
        sorts.stashed.sort,
        sorts.stashed.descending,
        true,
        costTotals,
      ),
    [filteredTree.byParent, sorts.stashed, costTotals],
  );
  const revealContainers = useMemo(() => {
    const ancestors = new Set<string>();
    const byId = new Map(items.map((item) => [item.id, item]));
    let parentId = byId.get(anchorItemId ?? '')?.parentId;
    while (parentId && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
    return ancestors;
  }, [items, anchorItemId]);
  const carriedRoots = (wornByParent.get(null) ?? []).filter((r) => r.worn);
  const stashedRoots = (stashedByParent.get(null) ?? []).filter((r) => !r.worn);

  // Range selection follows the displayed order of each list.
  const orderedIds = useMemo(
    () =>
      [...flattenDFS(carriedRoots, wornByParent), ...flattenDFS(stashedRoots, stashedByParent)].map(
        (i) => i.id,
      ),
    [carriedRoots, stashedRoots, wornByParent, stashedByParent],
  );
  const { selectedIds, isSelected, handleClick, clear, count } = useRangeSelect(orderedIds);

  // Add-item dialog state
  const [addOpen, setAddOpen] = useState(false);
  const addDialogRef = useDialogState(addOpen);
  // A rejected create flashes the closed dialog's form, so the visible
  // Add item button flashes with it.
  const addButtonFlash = useFlashState(`character_inventory:${characterId}:create`);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [weight, setWeight] = useState('');
  const [cost, setCost] = useState('');
  const [newLocation, setNewLocation] = useState<string>('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [newIsContainer, setNewIsContainer] = useState(false);
  const [newIsArmor, setNewIsArmor] = useState(false);
  const [newIsWeapon, setNewIsWeapon] = useState(false);
  const [newEquipped, setNewEquipped] = useState(false);
  const [newEnchantmentQuery, setNewEnchantmentQuery] = useState('');
  const [newEnchantments, setNewEnchantments] = useState<InventoryItemOut['enchantments']>([]);
  const {
    creating,
    flashProps,
    submit: submitNewItem,
  } = useAddEntityForm({
    entityClass: 'character_inventory',
    characterId,
    label: 'item',
  });

  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [pricing, setPricing] = useState<PricingResolution | null>(null);
  const [resolverOpen, setResolverOpen] = useState(false);
  const [pickedLibraryItem, setPickedLibraryItem] = useState<LibraryItemOut | null>(null);

  const containers = useMemo(() => items.filter((i) => i.isContainer), [items]);

  const { fetchOptions, allSources, setAllSources } = useLibraryFetcher<LibraryItemOut>(
    'items',
    campaignId,
  );
  const { fetchOptions: fetchEnchantments } = useLibraryFetcher<LibraryEnchantmentOut>(
    'enchantments',
    campaignId,
  );

  function onPickLibraryItem(opt: LibraryItemOut) {
    setPickedLibraryItem(opt);
    setPricing(null);
    setResolverOpen(true);
    setName(opt.name);
    if (opt.weightLbs != null) setWeight(String(opt.weightLbs));
    if (opt.cost != null) setCost(String(opt.cost));
    if (opt.defaultQuantity != null) setQty(String(opt.defaultQuantity));
    // Set (not merely enable) each facet from the pick: a second pick of
    // a plain item must clear facets left over from an earlier pick, or
    // the add would create e.g. an empty container/armor row.
    setNewIsArmor(opt.isArmor);
    setNewIsWeapon(opt.weaponData != null);
    setNewIsContainer(opt.isContainer);
  }

  function clearUnavailableEquipment(ids: readonly string[], patch: InventoryItemUpdate) {
    const before = inventoryAvailability(items);
    const after = inventoryAvailability(
      items.map((item) => (ids.includes(item.id) ? { ...item, ...patch } : item)),
    );
    return items
      .filter(
        (item) => item.equipped && before.get(item.id)?.equipped && !after.get(item.id)?.equipped,
      )
      .map((item) => ({
        entityClass: 'character_inventory' as const,
        entityId: item.id,
        characterId,
        fieldPath: 'equipped',
        attemptedValue: false,
        humanName: 'Equipped',
        flashKey: makeFlashKey('character_inventory', item.id, 'equipped'),
      }));
  }

  async function patchMany(id: string, patch: InventoryItemUpdate, label: string): Promise<void> {
    await enqueueFieldPatches([
      ...Object.entries(patch).map(([field, value]) => ({
        entityClass: 'character_inventory' as const,
        entityId: id,
        fieldPath: field,
        attemptedValue: value,
        humanName: `${label} ${field}`,
        flashKey: makeFlashKey('character_inventory', id, field),
        characterId,
      })),
      ...clearUnavailableEquipment([id], patch),
    ]);
  }

  async function bulkPatch(patch: InventoryItemUpdate, label: string): Promise<void> {
    const ids = Array.from(selectedIds);
    try {
      if (
        patch.equipped === true &&
        ids.some((id) => !inventoryAvailability(items).get(id)?.carried)
      )
        throw new Error(
          'Move selected items on the player and set positive quantities before equipping them',
        );
      await enqueueFieldPatches([
        ...ids.flatMap((id) =>
          Object.entries(patch).map(([field, value]) => ({
            entityClass: 'character_inventory' as const,
            entityId: id,
            fieldPath: field,
            attemptedValue: value,
            humanName: `${label} ${field}`,
            flashKey: makeFlashKey('character_inventory', id, field),
            characterId,
          })),
        ),
        ...clearUnavailableEquipment(ids, patch),
      ]);
      toasts.push(`${label} ${ids.length} item${ids.length === 1 ? '' : 's'}`, { kind: 'success' });
    } catch (err) {
      toasts.push(`Couldn't ${label.toLowerCase()} — ${(err as Error).message}`, { kind: 'error' });
    }
  }

  async function bulkDelete(): Promise<void> {
    setConfirmBulkDelete(false);
    const ids = Array.from(selectedIds);
    try {
      const deletes = ids.flatMap((id) => {
        const target = tree.byId.get(id);
        return target
          ? [
              {
                entityClass: 'character_inventory',
                entityId: id,
                humanName: `item "${target.name}"`,
                characterId,
              } as const,
            ]
          : [];
      });
      await enqueueDeletes(deletes);
      clear();
      toasts.push(`Deleted ${deletes.length} item${deletes.length === 1 ? '' : 's'}`, {
        kind: 'success',
      });
    } catch (err) {
      toasts.push(`Couldn't delete selected items — ${(err as Error).message}`, { kind: 'error' });
    }
  }

  async function onCreate(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) {
      toasts.push('Item name cannot be blank', { kind: 'error' });
      return;
    }
    if (pickedLibraryItem?.calculation && !pricing) {
      setResolverOpen(true);
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
    const parent = newLocation === '' || newLocation === 'stashed' ? null : newLocation;
    // If a library item was picked AND the user hasn't deviated from the
    // pick's name, link the new row back to the library entry.
    const linkedLibraryId =
      pickedLibraryItem && pickedLibraryItem.name === name.trim() ? pickedLibraryItem.id : null;
    const armorFromLibrary =
      linkedLibraryId && pickedLibraryItem?.isArmor && pickedLibraryItem.armor
        ? pickedLibraryItem.armor
        : null;
    const weaponFromLibrary =
      linkedLibraryId && pickedLibraryItem?.weaponData ? pickedLibraryItem.weaponData : null;
    // Powerstone/magic-item charge state is part of the library template
    // (authors set currentEnergy/chargesCurrent to full); copied verbatim,
    // same as armor/weapon.
    const powerstoneFromLibrary =
      linkedLibraryId && pickedLibraryItem?.powerstoneData
        ? pickedLibraryItem.powerstoneData
        : null;
    const magicItemFromLibrary =
      linkedLibraryId && pickedLibraryItem?.magicItemData ? pickedLibraryItem.magicItemData : null;
    // Enchantments ride along with the library template like the other
    // magic metadata; an unlinked (hand-typed) item starts unenchanted.
    const enchantmentsFromLibrary = [
      ...(linkedLibraryId && pickedLibraryItem ? pickedLibraryItem.enchantments : []),
      ...newEnchantments,
    ];
    const requiresShieldMarker = enchantmentsFromLibrary.some(
      (entry) => entry.mechanics?.applicability === 'shield',
    );
    const containerFromLibrary =
      linkedLibraryId && pickedLibraryItem?.isContainer ? pickedLibraryItem : null;
    //  Mirrors the armor-from-library / default-armor fallback: checking
    //  "Weapon" without a library pick still creates a real (empty) weapon
    //  so AttacksCard recognises the row immediately — otherwise the user
    //  would check "Weapon", save, and see no weapon until they open Edit.
    const weaponDefault = {
      damage: undefined,
      reach: null,
      parry: null,
      stRequired: null,
      skill: null,
      db: requiresShieldMarker ? 0 : null,
      ranged: null,
      notes: null,
    };

    // Include every column on the LocalCharacterInventory row so the
    // encumbrance computation (which reads e.g. hideawayCapacityLbs from
    // the Dexie row) doesn't see `undefined` values and emit NaN.
    await submitNewItem(
      {
        characterId,
        name: name.trim(),
        quantity: Math.max(1, parsedQty),
        weightLbs: parsedWeight,
        cost: parsedCost,
        notes: null,
        parentId: parent,
        externalLocation: null,
        worn: newLocation === '',
        equipped: newEquipped,
        isContainer: newIsContainer,
        // Gated on the facet, not just the pick: encumbrance applies
        // these to carried root items regardless of isContainer, so a pick
        // whose Container chip was toggled off must not smuggle in an
        // invisible weight reduction.
        hideawayCapacityLbs: newIsContainer ? (containerFromLibrary?.hideawayCapacityLbs ?? 0) : 0,
        weightReductionPercent: newIsContainer
          ? (containerFromLibrary?.weightReductionPercent ?? 0)
          : 0,
        isArmor: newIsArmor,
        armor: newIsArmor
          ? (armorFromLibrary ?? {
              locations: [],
              dr: 0,
              drCrushing: null,
              typedDr: {},
              flexible: false,
              frontOnly: false,
              backOnly: false,
              db: null,
              notes: null,
            })
          : null,
        weaponData: newIsWeapon
          ? {
              ...(weaponFromLibrary ?? weaponDefault),
              ...(requiresShieldMarker && weaponFromLibrary?.db == null ? { db: 0 } : {}),
            }
          : null,
        powerstoneData: powerstoneFromLibrary,
        magicItemData: magicItemFromLibrary,
        enchantments: enchantmentsFromLibrary,
        libraryItemId: linkedLibraryId,
        pricingResolution: linkedLibraryId ? pricing : null,
      },
      () => {
        setName('');
        setQty('1');
        setWeight('');
        setCost('');
        setNewLocation('');
        setNewIsContainer(false);
        setNewIsArmor(false);
        setNewIsWeapon(false);
        setNewEquipped(false);
        setNewEnchantmentQuery('');
        setNewEnchantments([]);
        setMoreOpen(false);
        setPickedLibraryItem(null);
        setAddOpen(false);
      },
    );
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
      if (target.kind === 'container')
        patch = { parentId: target.id, worn: false, externalLocation: null };
      else if (target.kind === 'character')
        patch = { parentId: null, worn: true, externalLocation: null };
      else patch = { parentId: null, worn: false };
      void patchMany(draggedId, patch, 'Moved').catch((err) => {
        toasts.push(`Couldn't move item — ${(err as Error).message}`, { kind: 'error' });
      });
    },
  };

  // Selected items, used to drive the "majority" pressed state of the
  // Equipped toggle in the bulk header; location changes use the move menu.
  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );
  const majorityEquipped =
    selectedItems.length > 0 &&
    selectedItems.filter((i) => i.equipped).length * 2 >= selectedItems.length;

  const sumRaw = items.reduce((acc, i) => acc + i.weightLbs * i.quantity, 0);
  const totalCost = items.reduce((acc, i) => acc + i.cost * i.quantity, 0);

  // Aggregate counts/weight/cost for items in the Stashed section.
  const stashedSubtree = useMemo(
    () => flattenDFS(stashedRoots, tree.byParent),
    [stashedRoots, tree.byParent],
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
        byParent={opts.inStashed ? stashedByParent : wornByParent}
        costTotals={costTotals}
        equipmentAvailability={inventoryAvailability(items)}
        isSelected={isSelected}
        onRowClick={handleClick}
        canEdit={canWrite}
        campaignId={campaignId}
        skillNames={character.skills.map((s) => skillDisplayName(s.name, s.specialization))}
        fetchEnchantmentOptions={fetchEnchantments}
        expandContainers={filterActive}
        revealContainers={revealContainers}
        highlightItemId={anchorItemId ?? null}
        {...(canWrite ? { drag: dragApi } : {})}
        {...(opts.inStashed ? { inStashed: true } : {})}
      />
    ));
  }

  const tableHead = (list: InventoryList) => (
    <thead>
      <tr className="text-base-content/50 text-[10px] uppercase tracking-wider">
        <SortableHeader<InventorySort>
          label="Item"
          filterLabel="Item type"
          sort="item"
          preferences={sorts[list]}
          onSort={(sort) => sortBy(list, sort)}
        />
        <SortableHeader<InventorySort>
          label="Qty"
          sort="qty"
          rangeStep={1}
          preferences={sorts[list]}
          onSort={(sort) => sortBy(list, sort)}
          headerClassName="text-right"
        />
        <SortableHeader<InventorySort>
          label="Wt"
          sort="wt"
          rangeStep={0.1}
          preferences={sorts[list]}
          onSort={(sort) => sortBy(list, sort)}
          headerClassName="text-right"
        />
        <SortableHeader<InventorySort>
          label="Cost"
          sort="cost"
          rangeStep={1}
          preferences={sorts[list]}
          onSort={(sort) => sortBy(list, sort)}
          headerClassName="text-right"
        />
        <th scope="col">
          <span className="sr-only">Item details</span>
        </th>
      </tr>
    </thead>
  );

  return (
    <section className="card border border-base-300/60 bg-base-100 rounded-2xl overflow-visible">
      {character.libraryEffectsKnown !== false && (
        <header className="flex flex-wrap items-baseline gap-2 border-b border-base-300/60 px-2 py-2 sm:px-5 sm:py-3 text-sm">
          <span className="num text-base-content/60">
            {formatEquipmentNumber(encumbrance.playerWeightLbs)} lbs
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
                  <span className="text-base-content">
                    {formatEquipmentNumber(encumbrance.basicLift)} lbs
                  </span>
                </div>
              </div>
            }
          >
            <span className="num text-base-content/60">
              BL {formatEquipmentNumber(encumbrance.basicLift)} lbs
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
        </header>
      )}

      {(items.length > 0 || canWrite) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-base-300/60 px-2 sm:px-5 py-2">
          {items.length > 0 && (
            <>
              <input
                type="search"
                className="input input-bordered input-sm min-w-0 flex-1 sm:max-w-xs"
                value={filterText}
                onChange={(event) => {
                  clear();
                  setFilterText(event.target.value);
                }}
                placeholder="Filter item names…"
                aria-label="Filter inventory"
              />
              {filterActive && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => {
                    clear();
                    setFilterText('');
                  }}
                >
                  Clear
                </button>
              )}
              <output className="text-xs text-muted" aria-live="polite">
                {filteredTree.matchedIds.size} of {items.length}
              </output>
            </>
          )}
          {canWrite && count > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-field bg-primary/5 px-2 py-1 text-sm">
              <span className="num font-medium">{count} selected</span>
              <button
                type="button"
                onClick={clear}
                className="btn btn-ghost btn-xs text-base-content/60"
              >
                Clear
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
                className={`btn btn-sm ${majorityEquipped ? 'btn-primary' : ''}`}
              >
                Equipped
              </button>
              <div className="dropdown dropdown-end">
                <button type="button" className="btn btn-sm">
                  Move to ▾
                </button>
                <ul
                  ref={bulkMoveMenuRef}
                  style={{
                    marginRight: 'calc(0px - var(--viewport-overlay-shift-x, 0px))',
                    marginTop: 'var(--viewport-overlay-shift-y, 0px)',
                    maxHeight:
                      'min(18rem, calc(100dvh - 1rem), var(--viewport-overlay-available-height, 100dvh))',
                  }}
                  className="dropdown-content menu menu-sm z-30 flex-nowrap [&>li]:shrink-0 w-56 max-w-[min(calc(100dvw-1rem),var(--viewport-overlay-available-width,calc(100dvw-1rem)))] [overflow-wrap:anywhere] overflow-y-auto rounded-box border border-base-300/60 bg-base-100 shadow-lg"
                >
                  <li>
                    <button
                      type="button"
                      className="text-primary font-medium"
                      onClick={() =>
                        void bulkPatch(
                          { parentId: null, worn: true, externalLocation: null },
                          'Moved on the player:',
                        )
                      }
                    >
                      On the player
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
                          void bulkPatch(
                            { parentId: c.id, worn: false, externalLocation: null },
                            `Moved to ${c.name}:`,
                          )
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
          {canWrite && (
            <button
              type="button"
              {...addButtonFlash.flashProps}
              className="field-rollback-flash btn btn-sm btn-primary ml-auto"
              onClick={() => setAddOpen(true)}
            >
              Add item
            </button>
          )}
        </div>
      )}

      {sortSaveFailed && (
        <output className="block px-2 pt-2 text-xs text-warning sm:px-5">
          This browser could not save the inventory sort. It will reset when you leave this page.
        </output>
      )}

      {items.length === 0 && (
        <div className="p-8 text-center text-base-content/60 text-sm">No items yet.</div>
      )}

      {items.length > 0 && (
        <div className="px-0 py-2 space-y-3 sm:px-5 sm:py-4 sm:space-y-6">
          <section
            onDragEnter={
              canWrite
                ? (e) => {
                    if (!draggedIdRef.current) return;
                    e.preventDefault();
                  }
                : undefined
            }
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
                {carriedRoots.length} item{carriedRoots.length === 1 ? '' : 's'}
              </span>
            </div>
            {carriedRoots.length === 0 ? (
              <p className="text-base-content/60 text-sm">
                {filterActive
                  ? 'No matching items on the player.'
                  : 'Nothing on the player. Drop items here to carry them.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-base-300/60">
                <Table
                  preferenceKey={`${character.id}:inventory:worn`}
                  filterRows={flattenDFS(
                    (tree.byParent.get(null) ?? []).filter((item) => item.worn),
                    tree.byParent,
                  ).map((item) => inventoryFilterValues(item, false, costTotals))}
                  aria-label="Carried inventory"
                  className="table table-zebra inventory-table"
                >
                  {tableHead('worn')}
                  <tbody>{renderRows(carriedRoots)}</tbody>
                </Table>
              </div>
            )}
          </section>

          <section
            onDragEnter={
              canWrite
                ? (e) => {
                    if (!draggedIdRef.current) return;
                    e.preventDefault();
                  }
                : undefined
            }
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
                    {formatEquipmentNumber(stashedWeight)} lb
                  </span>
                </span>
                <span>
                  <span className="text-base-content/40">cost </span>
                  <span className="font-semibold text-base-content">
                    {formatEquipmentNumber(stashedCost)}
                  </span>
                </span>
              </span>
            </div>
            {stashedRoots.length === 0 ? (
              <p className="text-base-content/60 text-sm">
                {filterActive
                  ? 'No matching stashed items.'
                  : 'Nothing stashed. Drop items here to set them aside.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-base-300/60">
                <Table
                  preferenceKey={`${character.id}:inventory:stashed`}
                  filterRows={flattenDFS(
                    (tree.byParent.get(null) ?? []).filter((item) => !item.worn),
                    tree.byParent,
                  ).map((item) => inventoryFilterValues(item, true, costTotals))}
                  aria-label="Stashed inventory"
                  className="table table-zebra inventory-table"
                >
                  {tableHead('stashed')}
                  <tbody>{renderRows(stashedRoots, { inStashed: true })}</tbody>
                </Table>
              </div>
            )}
          </section>

          <div className="flex flex-wrap items-baseline gap-4 border-t border-base-300/60 pt-3 text-xs">
            <span className="label-eyebrow">Totals</span>
            <span className="num">
              <span className="text-base-content/40">encumbrance </span>
              <span className="font-semibold text-base-content">
                {character.libraryEffectsKnown === false
                  ? 'unavailable'
                  : `${formatEquipmentNumber(encumbrance.playerWeightLbs)} lb`}
              </span>
            </span>
            <span className="num">
              <span className="text-base-content/40">raw </span>
              {formatEquipmentNumber(sumRaw)} lb
            </span>
            <span className="num">
              <span className="text-base-content/40">cost </span>
              {formatEquipmentNumber(totalCost)}
            </span>
            {character.libraryEffectsKnown !== false && (
              <span className="num text-base-content/40">
                BL {formatEquipmentNumber(encumbrance.basicLift)} →{' '}
                {LEVEL_LABELS[encumbrance.level]}
              </span>
            )}
          </div>
        </div>
      )}

      {canWrite && (
        <dialog
          ref={addDialogRef}
          className="modal"
          aria-label="Add item"
          onClose={() => setAddOpen(false)}
          onCancel={() => setAddOpen(false)}
        >
          <form
            {...flashProps}
            onSubmit={(e) => void onCreate(e)}
            className="modal-box field-rollback-flash flex w-[calc(var(--dialog-viewport-width,100dvw)-2rem)] max-w-2xl max-h-[calc(var(--dialog-viewport-height,100dvh)-2rem)] flex-col gap-3 overflow-y-auto border border-base-300 bg-base-100"
          >
            <header className="flex items-center justify-between gap-2">
              <h3 className="font-display text-xl">Add item</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square min-h-11 min-w-11"
                aria-label="Close add item"
                onClick={() => setAddOpen(false)}
              >
                <AppIcon name="close" size={18} />
              </button>
            </header>
            {resolverOpen && pickedLibraryItem && campaignId && (
              <PricingResolver
                campaignId={campaignId}
                section="items"
                entry={pickedLibraryItem}
                initial={pricing}
                onCancel={() => setResolverOpen(false)}
                onResolve={(resolution) => {
                  setPricing(resolution);
                  setCost(String(resolution.outputs.cost));
                  setWeight(String(resolution.outputs.weightLbs));
                  setResolverOpen(false);
                }}
              />
            )}
            {pricing && (
              <button type="button" className="btn btn-sm" onClick={() => setResolverOpen(true)}>
                Change pricing choices
              </button>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {campaignId ? (
                <div className="flex-1 min-w-[200px]">
                  <LibraryAutocomplete<LibraryItemOut>
                    value={name}
                    onChange={(v) => {
                      setName(v);
                      if (pickedLibraryItem && v !== pickedLibraryItem.name) {
                        setPickedLibraryItem(null);
                        setPricing(null);
                        setResolverOpen(false);
                      }
                    }}
                    onPick={onPickLibraryItem}
                    fetchOptions={fetchOptions}
                    sourceSelection={
                      campaignId && setAllSources
                        ? { allSources, onChange: setAllSources }
                        : undefined
                    }
                    getOptionKey={(o) => o.id}
                    renderOption={(o) => (
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{o.name}</span>
                        <span className="text-xs text-base-content/60">
                          {o.category} ·{' '}
                          {pricingDisplayValue(o.calculation, 'weightLbs', o.weightLbs) ??
                            'Calculated'}{' '}
                          lb ·{' '}
                          {pricingDisplayValue(o.calculation, 'cost', o.cost) == null
                            ? 'Calculated cost'
                            : `${pricingDisplayValue(o.calculation, 'cost', o.cost)}`}
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
                className="num input input-sm input-bordered w-14 sm:w-16 min-w-0 text-right"
                aria-label="Quantity"
              />
              <input
                placeholder="Weight"
                value={weight}
                inputMode="decimal"
                onChange={(e) => setWeight(e.target.value)}
                className="num input input-sm input-bordered w-20 sm:w-24 min-w-0 text-right"
                aria-label="Weight (lbs)"
              />
              <input
                placeholder="Cost"
                value={cost}
                inputMode="decimal"
                onChange={(e) => setCost(e.target.value)}
                className="num input input-sm input-bordered w-20 sm:w-24 min-w-0 text-right"
                aria-label="Cost"
              />
              <select
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                className="select select-sm select-bordered max-w-full min-w-0"
                aria-label="Location"
              >
                <option value="">On the player</option>
                <option value="stashed">Stashed</option>
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
            </div>
            {moreOpen && (
              <div className="flex flex-wrap items-center gap-4 border-t border-base-300/60 pt-2 text-xs">
                <FacetChipRow
                  facets={['container', 'armor', 'weapon']}
                  active={{
                    container: newIsContainer,
                    armor: newIsArmor,
                    weapon: newIsWeapon,
                    // Not independently toggleable here (no manual "add a
                    // powerstone" control in the quick-add form); reflects
                    // whether the linked library pick carries that data,
                    // the same data onCreate copies onto the new row.
                    powerstone: pickedLibraryItem?.powerstoneData != null,
                    magicItem: pickedLibraryItem?.magicItemData != null,
                  }}
                  onToggle={(facet, next) => {
                    if (facet === 'container') setNewIsContainer(next);
                    else if (facet === 'armor') setNewIsArmor(next);
                    else if (facet === 'weapon') setNewIsWeapon(next);
                  }}
                />
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={newEquipped}
                    onChange={(e) => setNewEquipped(e.target.checked)}
                  />
                  <span>Equipped</span>
                </label>
                {campaignId && (
                  <div className="min-w-[16rem] flex-1">
                    <LibraryAutocomplete<LibraryEnchantmentOut>
                      value={newEnchantmentQuery}
                      onChange={setNewEnchantmentQuery}
                      onPick={(definition) => {
                        setNewEnchantments((current) => [
                          ...current,
                          {
                            spellName: definition.name,
                            definitionId: definition.id,
                            definitionRevision: definition.revision,
                            definitionSource: definition.source,
                            mechanics: {
                              applicability: definition.applicability,
                              effects: definition.effects,
                              levels: definition.levels,
                              stackingPolicy: definition.stackingPolicy,
                            },
                          },
                        ]);
                        setNewEnchantmentQuery('');
                        if (definition.applicability === 'armor') setNewIsArmor(true);
                        if (
                          definition.applicability === 'weapon' ||
                          definition.applicability === 'shield'
                        )
                          setNewIsWeapon(true);
                      }}
                      fetchOptions={fetchEnchantments}
                      getOptionKey={(option) => option.id}
                      renderOption={(option) => (
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">{option.name}</span>
                          <span className="text-base-content/60 text-xs">
                            {option.applicability}
                          </span>
                        </div>
                      )}
                      placeholder="Attach campaign enchantment"
                      aria-label="Attach campaign enchantment"
                    />
                  </div>
                )}
                {newEnchantments.map((enchantment, index) => (
                  <span
                    key={`${enchantment.definitionId ?? enchantment.spellName}:${index}`}
                    className="badge badge-secondary gap-1"
                  >
                    {enchantment.spellName}
                    <button
                      type="button"
                      aria-label={`Remove ${enchantment.spellName}`}
                      onClick={() =>
                        setNewEnchantments((current) =>
                          current.filter((_, entryIndex) => entryIndex !== index),
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <footer className="modal-action mt-1">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" disabled={creating} className="btn btn-sm btn-primary">
                Add
              </button>
            </footer>
          </form>
        </dialog>
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
    </section>
  );
}
