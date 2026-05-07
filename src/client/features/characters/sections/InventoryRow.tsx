import { type DragEvent, Fragment, type MouseEvent, useState } from 'react';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import type { InventoryDragApi } from './InventoryPanel.tsx';

export interface InventoryRowProps {
  item: InventoryItemOut;
  depth: number;
  byParent: Map<string | null, InventoryItemOut[]>;
  isSelected: (id: string) => boolean;
  onRowClick: (id: string, e: MouseEvent) => void;
  canEdit: boolean;
  onEdit: (item: InventoryItemOut) => void;
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

function EditIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M14.5 4.5l5 5L9 20H4v-5l10.5-10.5z" />
      <path d="M13 6l5 5" />
    </svg>
  );
}

export function InventoryRow(props: InventoryRowProps) {
  const { item, depth, byParent, isSelected, onRowClick, canEdit, onEdit, drag, inStashed } = props;
  const children = byParent.get(item.id) ?? [];
  const isRoot = item.parentId === null;
  const hasChildren = item.isContainer && children.length > 0;
  const [open, setOpen] = useState(true);
  const sel = isSelected(item.id);

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
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: row click drives mouse-only range selection;
          the per-row Edit button + cell inputs remain keyboard-reachable for the actual content edits. */}
      <tr
        onClick={canEdit ? (e) => onRowClick(item.id, e) : undefined}
        draggable={canEdit && !!drag}
        onDragStart={canEdit && drag ? handleDragStart : undefined}
        onDragEnd={canEdit && drag ? drag.onDragEnd : undefined}
        onDragOver={canEdit && drag ? handleDragOver : undefined}
        onDragLeave={canEdit && drag ? handleDragLeave : undefined}
        onDrop={canEdit && drag ? handleDrop : undefined}
        className={[
          'transition-colors',
          canEdit ? 'cursor-pointer' : '',
          isDragging ? 'opacity-40' : '',
          hoverValid ? '!bg-success/20 outline outline-2 outline-success/50' : '',
          hoverInvalid ? '!bg-error/15 outline outline-2 outline-error/40 cursor-not-allowed' : '',
          sel && !isHovered ? '!bg-primary/15 hover:!bg-primary/20' : '',
          !sel && !isHovered ? 'hover:bg-base-200/50' : '',
        ].join(' ')}
        aria-selected={sel}
      >
        <td className="align-top sm:align-middle">
          <div
            className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2"
            style={{ paddingLeft: `${depth * 1.25}rem` }}
          >
            <span className="flex items-center gap-2">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => {
                    stop(e);
                    setOpen((o) => !o);
                  }}
                  className="btn btn-ghost btn-xs px-1 text-base-content/50"
                  aria-expanded={open}
                  aria-label={open ? 'Collapse contents' : 'Expand contents'}
                >
                  {open ? '▾' : '▸'}
                </button>
              ) : (
                <span className="inline-block w-5" aria-hidden />
              )}
              <span className="font-medium">{item.name}</span>
            </span>
            <span className="flex flex-wrap items-center gap-1 pl-7 sm:pl-0">
              {isRoot && item.worn && <span className="badge badge-sm badge-primary">Worn</span>}
              {item.equipped && <span className="badge badge-sm badge-secondary">Equipped</span>}
              {item.isContainer && (
                <span className="badge badge-sm badge-ghost">
                  Container
                  {isRoot && item.worn && reductionLabel && (
                    <span className="text-base-content/50 text-[10px] ml-1">{reductionLabel}</span>
                  )}
                </span>
              )}
              {item.isArmor && item.armor && (
                <span className="badge badge-sm badge-ghost">
                  Armor DR {item.armor.dr}
                  <span className="text-base-content/50 text-[10px] ml-1">
                    {locationSummary(item.armor.locations)}
                  </span>
                </span>
              )}
            </span>
          </div>
          {isRoot && !item.worn && item.externalLocation && (
            <div
              className="text-base-content/60 text-xs mt-0.5"
              style={{ paddingLeft: `${depth * 1.25 + 1.5}rem` }}
            >
              {item.externalLocation}
            </div>
          )}
        </td>
        <td className="num text-right align-top sm:align-middle">{item.quantity}</td>
        <td
          className={`num text-right align-top sm:align-middle ${netWeight === 0 ? 'text-base-content/50' : ''}`}
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
                <span className="text-[11px] text-base-content/60">
                  {grossWeight.toFixed(1)} <span className="italic text-info">+ contents</span>
                </span>
              ) : (
                <span className="text-[11px] text-base-content/60">
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
        <td className="num text-right text-base-content/60 align-top sm:align-middle">
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
              onClick={(e) => {
                e.stopPropagation();
                onEdit(item);
              }}
            >
              <EditIcon />
            </button>
          </td>
        )}
      </tr>
      {hasChildren &&
        open &&
        children.map((child) => (
          <InventoryRow key={child.id} {...props} item={child} depth={depth + 1} />
        ))}
    </Fragment>
  );
}
