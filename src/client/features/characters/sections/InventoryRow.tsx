import {
  TableRow,
  useTableFiltersActive,
  useTableRowMatches,
} from '../../../components/ui/Table.tsx';
import './inventory/inventory.css';
import {
  type CSSProperties,
  type DragEvent,
  Fragment,
  type MouseEvent,
  type ReactNode,
  useRef,
  useState,
} from 'react';
import { formatSigned } from '../../../../shared/format/number.ts';
import type { LibraryEnchantmentOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import { AppIcon } from '../../../components/ui/AppIcon.tsx';
import { useFlashState } from '../../../hooks/useFlashState.ts';
import { sheetAnchor } from '../sheetAnchors.ts';
import type { InventoryDragApi } from './InventoryPanel.tsx';
import { InventoryItemEditor } from './inventory/InventoryItemEditor.tsx';
import { CATEGORY_LABELS, type ItemCategory, type ItemSection } from './inventory/itemMutations.ts';
import { readContainerExpanded, writeContainerExpanded } from './inventoryContainerState.ts';
import { descendantsOf } from './inventoryTree.ts';

export interface InventoryRowProps {
  item: InventoryItemOut;
  /** Keep previously revealed descendant editors mounted when an ancestor closes. */
  ancestorHidden?: boolean;
  depth: number;
  byParent: Map<string | null, InventoryItemOut[]>;
  isSelected: (id: string) => boolean;
  onRowClick: (id: string, e: MouseEvent) => void;
  canEdit: boolean;
  campaignId?: string | null | undefined;
  skillNames?: readonly string[];
  fetchEnchantmentOptions?: (query: string) => Promise<LibraryEnchantmentOut[]>;
  /** Filtering forces matching descendants open inside their ancestor containers. */
  expandContainers?: boolean;
  revealContainers?: ReadonlySet<string>;
  highlightItemId?: string | null;
  drag?: InventoryDragApi;
  // Stashed items don't count against encumbrance, so the row renders the
  // raw weight directly instead of the encumbrance-effective number plus a
  // confusing -100% reduction breakdown.
  inStashed?: boolean;
}

function locationSummary(locations: string[]): string {
  if (locations.length === 0) return '—';
  const fmt = (l: string) => l.replace(/_/g, ' ');
  const head = locations.slice(0, 3).map(fmt).join(', ');
  const extra = locations.length - 3;
  return extra > 0 ? `${head} +${extra}` : head;
}

export function InventoryRow(props: InventoryRowProps) {
  const {
    item,
    ancestorHidden = false,
    depth,
    byParent,
    isSelected,
    onRowClick,
    canEdit,
    campaignId,
    skillNames = [],
    fetchEnchantmentOptions,
    expandContainers = false,
    revealContainers,
    highlightItemId,
    drag,
    inStashed,
  } = props;
  const children = byParent.get(item.id) ?? [];
  const isRoot = item.parentId === null;
  const hasChildren = item.isContainer && children.length > 0;
  const [open, setOpen] = useState(() => readContainerExpanded(item.characterId, item.id));
  const columnFiltersActive = useTableFiltersActive();
  const matchesRow = useTableRowMatches();
  const filterValues = (entry: InventoryItemOut) => ({
    item: entry.name,
    qty: entry.quantity,
    wt: (inStashed ? entry.weightLbs * entry.quantity : entry.effectiveWeightLbs).toFixed(1),
    cost: entry.cost.toFixed(0),
  });
  // Retain a matching descendant's ancestry. Hidden rows remain mounted to
  // preserve open editor drafts.
  function subtreeMatches(entry: InventoryItemOut): boolean {
    return (
      matchesRow(filterValues(entry)) ||
      (entry.isContainer && (byParent.get(entry.id) ?? []).some(subtreeMatches))
    );
  }
  const filteredOut = !subtreeMatches(item);
  // Indent guides are drawn in CSS from the depth, so they need no per-row
  // sibling bookkeeping and stay correct while filtering or collapsing.
  const rowStyle = { '--inventory-depth': depth } as CSSProperties;
  const itemIcon = item.isContainer
    ? 'inventory'
    : item.isArmor || item.weaponData?.db != null
      ? 'defense'
      : item.weaponData != null
        ? 'combat'
        : item.powerstoneData != null ||
            item.magicItemData != null ||
            (item.enchantments?.length ?? 0) > 0
          ? 'modifier'
          : 'notes';
  const contentsForcedOpen =
    columnFiltersActive || expandContainers || Boolean(revealContainers?.has(item.id));
  const contentsOpen = contentsForcedOpen || open;
  const contentsVisited = useRef(false);
  if (contentsOpen) contentsVisited.current = true;
  const descendantCount = hasChildren ? descendantsOf(item.id, byParent).size : 0;
  const sel = isSelected(item.id);
  const highlighted = highlightItemId === item.id;
  const [section, setSection] = useState<ItemSection | null>(null);
  const [visited, setVisited] = useState<ItemSection[]>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const editorId = `inventory-editor-${item.id}`;
  function showSection(next: ItemSection) {
    setVisited((before) => (before.includes(next) ? before : [...before, next]));
    setSection(next);
  }
  function toggleSection(next: ItemSection, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    if (section === next) setSection(null);
    else showSection(next);
  }
  function closeEditor() {
    setSection(null);
    triggerRef.current?.focus();
  }
  function categoryChip(category: ItemCategory, children: ReactNode) {
    if (!canEdit)
      return <span className="inventory-chip badge badge-sm badge-ghost">{children}</span>;
    return (
      <button
        type="button"
        aria-label={`${CATEGORY_LABELS[category]} settings for ${item.name}`}
        aria-expanded={section === category}
        aria-controls={editorId}
        className={`inventory-chip badge badge-sm min-h-8 h-auto py-1 ${section === category ? 'badge-primary' : 'badge-ghost'}`}
        onClick={(event) => {
          event.stopPropagation();
          toggleSection(category, event.currentTarget);
        }}
      >
        {children}
      </button>
    );
  }

  // The row remains the rollback target when its inline editor is collapsed.
  const rowFlash = useFlashState(undefined, undefined, `character_inventory:${item.id}:`);

  function stop(e: MouseEvent) {
    e.stopPropagation();
  }

  const dropKey = `container:${item.id}`;
  const isHovered = drag?.hoverKey === dropKey;
  const hoverValid = isHovered && (drag?.hoverValid ?? false);
  const hoverInvalid = isHovered && !(drag?.hoverValid ?? false);
  const isDragging = drag?.draggingId === item.id;

  function handleDragStart(e: DragEvent<HTMLTableRowElement>) {
    if (!drag) return;
    // Don't initiate drag from the pencil button (or any nested button).
    const target = e.target as Element | null;
    if (target?.closest('button')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';
    drag.onDragStart(item.id);
  }

  function handleDragOver(e: DragEvent<HTMLTableRowElement>) {
    if (!drag || !drag.draggingId) return;
    e.preventDefault();
    e.stopPropagation();
    drag.onDragOverTarget({ kind: 'container', id: item.id }, e.dataTransfer);
  }

  // mobile-drag-drop polyfill only marks the element as a valid drop
  // target when dragenter calls preventDefault — without this, drops
  // on touch devices snap back to document.body and never fire onDrop.
  function handleDragEnter(e: DragEvent<HTMLTableRowElement>) {
    if (!drag || !drag.draggingId) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragLeave() {
    if (!drag) return;
    drag.onDragLeaveTarget({ kind: 'container', id: item.id });
  }

  function handleDrop(e: DragEvent<HTMLTableRowElement>) {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    drag.onDrop({ kind: 'container', id: item.id });
  }

  const reductionLabel = (() => {
    const parts: string[] = [];
    if (item.weightReductionPercent > 0) parts.push(`-${item.weightReductionPercent}%`);
    const hide = item.hideawayCapacityLbs;
    if (hide > 0) parts.push(`hide ${hide.toFixed(0)} lb`);
    return parts.join(' · ');
  })();

  const grossWeight = item.weightLbs * item.quantity;
  const netWeight = inStashed ? grossWeight : item.effectiveWeightLbs;
  const weightDelta = netWeight - grossWeight;
  // Tolerate float rounding — anything under 0.05 lb shouldn't render as a "modified" weight.
  const weightModified = !inStashed && Math.abs(weightDelta) >= 0.05;

  return (
    <Fragment>
      <TableRow
        hidden={ancestorHidden || filteredOut}
        id={sheetAnchor('inventory', item.id)}
        onClick={canEdit ? (e) => onRowClick(item.id, e) : undefined}
        draggable={canEdit && !!drag}
        onDragStart={canEdit && drag ? handleDragStart : undefined}
        onDragEnd={canEdit && drag ? drag.onDragEnd : undefined}
        onDragEnter={canEdit && drag ? handleDragEnter : undefined}
        onDragOver={canEdit && drag ? handleDragOver : undefined}
        onDragLeave={canEdit && drag ? handleDragLeave : undefined}
        onDrop={canEdit && drag ? handleDrop : undefined}
        className={[
          'inventory-item-row transition-colors scroll-mt-24',
          item.isContainer ? 'inventory-container-row' : '',
          highlighted ? '!bg-primary/20 outline outline-2 outline-primary' : '',
          rowFlash.flashing ? 'field-rollback-flash' : '',
          canEdit ? 'cursor-pointer' : '',
          isDragging ? 'opacity-40' : '',
          hoverValid ? '!bg-success/20 outline outline-2 outline-success/50' : '',
          hoverInvalid ? '!bg-error/15 outline outline-2 outline-error/40 cursor-not-allowed' : '',
          sel && !isHovered && !highlighted ? '!bg-primary/15 hover:!bg-primary/20' : '',
          !sel && !isHovered && !highlighted ? 'hover:bg-base-200/50' : '',
        ].join(' ')}
        style={rowStyle}
        aria-selected={sel}
        {...rowFlash.flashProps}
      >
        <td className="align-top sm:align-middle">
          <div className="inventory-item-heading flex flex-col flex-wrap items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
            <span className="inventory-item-name flex min-w-0 items-start gap-2">
              {hasChildren && !contentsForcedOpen ? (
                <button
                  type="button"
                  onClick={(e) => {
                    stop(e);
                    setOpen((before) => {
                      const next = !before;
                      writeContainerExpanded(item.characterId, item.id, next);
                      return next;
                    });
                  }}
                  className="inventory-slot inventory-expand btn btn-ghost btn-xs text-base-content/60"
                  aria-expanded={contentsOpen}
                  aria-label={contentsOpen ? 'Collapse contents' : 'Expand contents'}
                >
                  <AppIcon name={contentsOpen ? 'chevronDown' : 'chevronRight'} size={15} />
                </button>
              ) : hasChildren ? (
                <span className="inventory-slot text-base-content/60" aria-hidden>
                  <AppIcon name="chevronDown" size={15} />
                </span>
              ) : (
                <span className="inventory-slot text-base-content/60" aria-hidden>
                  <AppIcon name={itemIcon} size={15} />
                </span>
              )}
              <span className="inventory-item-title font-medium">{item.name}</span>
            </span>
            <span className="inventory-item-badges flex min-w-0 flex-wrap items-center gap-1">
              {isRoot && item.worn && (
                <span className="badge badge-sm badge-soft badge-secondary">Worn</span>
              )}
              {item.equipped && <span className="badge badge-sm badge-secondary">Equipped</span>}
              {item.isContainer &&
                categoryChip(
                  'container',
                  <>
                    Container
                    {isRoot && item.worn && reductionLabel && (
                      <span className="text-base-content/70 text-[10px] ml-1">
                        {reductionLabel}
                      </span>
                    )}
                  </>,
                )}
              {hasChildren && !contentsOpen && (
                <span
                  className="badge badge-sm badge-ghost"
                  aria-label={`${descendantCount} contained ${descendantCount === 1 ? 'item' : 'items'}`}
                >
                  {descendantCount} {descendantCount === 1 ? 'item' : 'items'}
                </span>
              )}
              {item.isArmor &&
                item.armor &&
                categoryChip(
                  'armor',
                  <>
                    Armor DR {item.armor.dr}
                    <span className="text-base-content/70 text-[10px] ml-1">
                      {locationSummary(item.armor.locations)}
                    </span>
                  </>,
                )}
              {item.weaponData != null &&
                (item.weaponData.db != null
                  ? categoryChip(
                      'weapon',
                      <>
                        Shield DB {item.weaponData.db}
                        {item.weaponData.skill && (
                          <span className="text-base-content/70 text-[10px] ml-1">
                            {item.weaponData.skill}
                          </span>
                        )}
                      </>,
                    )
                  : categoryChip(
                      'weapon',
                      <>
                        Weapon
                        {(item.weaponData.damage ||
                          item.weaponData.skill ||
                          item.weaponData.ranged != null) && (
                          <span className="text-base-content/70 text-[10px] ml-1">
                            {[
                              item.weaponData.damage || null,
                              item.weaponData.ranged != null ? 'ranged' : null,
                              item.weaponData.skill ? `· ${item.weaponData.skill}` : null,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          </span>
                        )}
                      </>,
                    ))}
              {item.powerstoneData != null &&
                categoryChip(
                  'powerstone',
                  <>
                    Powerstone
                    <span className="text-base-content/70 text-[10px] ml-1">
                      {item.powerstoneData.currentEnergy}/{item.powerstoneData.maxEnergy}
                    </span>
                  </>,
                )}
              {item.magicItemData != null &&
                categoryChip(
                  'magicItem',
                  <>
                    Magic
                    <span className="text-base-content/70 text-[10px] ml-1">
                      {item.magicItemData.spellName}
                      {item.magicItemData.mode === 'charged' &&
                        item.magicItemData.chargesCurrent != null &&
                        ` ${item.magicItemData.chargesCurrent}/${item.magicItemData.chargesMax ?? '—'}`}
                    </span>
                  </>,
                )}
              {(item.enchantments?.length ?? 0) > 0 &&
                categoryChip('enchantments', <>Enchantments · {item.enchantments.length}</>)}
            </span>
          </div>
          {isRoot && !item.worn && item.externalLocation && (
            <div className="inventory-item-detail text-base-content/60 text-xs mt-0.5">
              {item.externalLocation}
            </div>
          )}
          {(item.enchantmentBreakdown?.length ?? 0) > 0 && (
            <div className="inventory-item-detail mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-base-content/60">
              {item.enchantmentBreakdown?.map((effect, index) => (
                <span
                  key={`${effect.sourceName}:${effect.target}:${index}`}
                  className={
                    !effect.active || effect.suppressedByStacking ? 'line-through opacity-60' : ''
                  }
                >
                  {effect.sourceName}: {effect.target.replaceAll('_', ' ')}{' '}
                  {formatSigned(effect.value)}
                  {!effect.active
                    ? ' (inactive)'
                    : effect.suppressedByStacking
                      ? ' (suppressed)'
                      : ''}
                </span>
              ))}
            </div>
          )}
        </td>
        <td
          data-label="Qty"
          className={`inventory-qty num text-right align-top sm:align-middle ${item.quantity === 1 ? 'inventory-qty-one' : ''}`}
        >
          {item.quantity}
        </td>
        <td
          data-label="Weight (lb)"
          className={`inventory-weight num text-right align-top sm:align-middle ${netWeight === 0 ? 'text-base-content/50' : ''}`}
          title={
            weightModified
              ? item.isContainer && weightDelta > 0
                ? `empty ${grossWeight.toFixed(2)} lb + ${weightDelta.toFixed(2)} lb contents = ${netWeight.toFixed(2)} lb total`
                : `gross ${grossWeight.toFixed(2)} lb ${weightDelta >= 0 ? '+' : '-'}${Math.abs(weightDelta).toFixed(2)} lb container = net ${netWeight.toFixed(2)} lb`
              : `${netWeight.toFixed(2)} lb`
          }
        >
          <span className="inline-flex items-baseline justify-end gap-1.5">
            {weightModified &&
              (item.isContainer && weightDelta > 0 ? (
                <span className="inventory-weight-breakdown text-[11px] text-base-content/60">
                  {grossWeight.toFixed(1)} <span className="italic text-info">+ contents</span>
                </span>
              ) : (
                <span className="inventory-weight-breakdown text-[11px] text-base-content/60">
                  {grossWeight.toFixed(1)}{' '}
                  <span className="text-success">
                    {weightDelta >= 0 ? '+' : '-'}
                    {Math.abs(weightDelta).toFixed(1)}
                  </span>
                </span>
              ))}
            <span className={weightModified ? 'font-semibold' : ''}>{netWeight.toFixed(1)}</span>
          </span>
        </td>
        <td
          data-label="Cost"
          className="inventory-cost num text-right text-base-content/75 align-top sm:align-middle"
        >
          {item.cost.toFixed(0)}
        </td>
        {canEdit && (
          // The Edit button below already stopPropagation()s clicks, so the cell
          // itself doesn't need an onClick handler to keep row-selection inert.
          <td className="text-right align-top sm:align-middle">
            <button
              type="button"
              className="btn btn-ghost btn-xs text-base-content/50 hover:text-base-content"
              aria-label={`Edit ${item.name}`}
              title="Edit item"
              aria-expanded={section === 'basics'}
              aria-controls={editorId}
              onClick={(e) => {
                e.stopPropagation();
                toggleSection('basics', e.currentTarget);
              }}
            >
              <AppIcon name="edit" size={16} />
            </button>
          </td>
        )}
      </TableRow>
      {canEdit && visited.length > 0 && (
        <TableRow
          className="inventory-editor-row"
          style={rowStyle}
          hidden={ancestorHidden || filteredOut || section === null}
          id={editorId}
        >
          <td colSpan={5} className="!p-2 sm:!p-3">
            {visited.map((entry) => (
              <div key={entry} hidden={section !== entry}>
                <InventoryItemEditor
                  item={{
                    ...item,
                    armor: item.baseArmor ?? item.armor,
                    weaponData: item.baseWeaponData ?? item.weaponData,
                  }}
                  section={entry}
                  skillNames={skillNames}
                  campaignId={campaignId}
                  {...(fetchEnchantmentOptions ? { fetchEnchantmentOptions } : {})}
                  hasChildren={children.length > 0}
                  onSection={showSection}
                  onClose={closeEditor}
                />
              </div>
            ))}
          </td>
        </TableRow>
      )}
      {hasChildren &&
        contentsVisited.current &&
        children.map((child) => (
          <InventoryRow
            key={child.id}
            {...props}
            item={child}
            depth={depth + 1}
            ancestorHidden={ancestorHidden || !contentsOpen}
          />
        ))}
    </Fragment>
  );
}
