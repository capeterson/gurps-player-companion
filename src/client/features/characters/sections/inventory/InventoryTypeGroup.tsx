import { useState } from 'react';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { AppIcon } from '../../../../components/ui/AppIcon.tsx';
import { useTableFiltersActive, useTableRowMatches } from '../../../../components/ui/Table.tsx';
import { CATEGORY_ICONS, InventoryRow, type InventoryRowProps } from '../InventoryRow.tsx';
import { readTypeGroupExpanded, writeTypeGroupExpanded } from '../inventoryContainerState.ts';
import { type InventoryTypeGroup as Group, inventoryFilterValues } from '../inventoryTree.ts';
import { CATEGORY_LABELS, type ItemCategory } from './itemCategories.ts';

const ICON_BY_LABEL = new Map(
  (Object.keys(CATEGORY_LABELS) as ItemCategory[]).map((category) => [
    CATEGORY_LABELS[category] as string,
    CATEGORY_ICONS[category],
  ]),
);

/**
 * One folding type section. It is a presentation over the list, never a
 * container: it is not a drop target, and moving or editing an item never
 * refers to it. Like a container, it folds, remembers that choice on this
 * device, opens while filtering or revealing a linked item, and collapsing
 * it deselects the items inside.
 */
export function InventoryTypeGroup({
  characterId,
  list,
  group,
  byId,
  revealItemId,
  forceOpen,
  onCollapse,
  rowProps,
}: {
  characterId: string;
  list: string;
  group: Group;
  byId: ReadonlyMap<string, InventoryItemOut>;
  revealItemId: string | null;
  forceOpen: boolean;
  onCollapse: (itemIds: ReadonlySet<string>) => void;
  rowProps: Omit<InventoryRowProps, 'item' | 'depth' | 'flat' | 'containerName'>;
}) {
  const [open, setOpen] = useState(() => readTypeGroupExpanded(characterId, list, group.type));
  const columnFiltersActive = useTableFiltersActive();
  const matchesRow = useTableRowMatches();
  const forced = forceOpen || columnFiltersActive;
  const revealed = group.items.some((item) => item.id === revealItemId);
  const expanded = forced || revealed || open;
  const visibleCount = group.items.filter((item) =>
    matchesRow(inventoryFilterValues(item, Boolean(rowProps.inStashed), rowProps.costTotals)),
  ).length;
  const icon = ICON_BY_LABEL.get(group.type);
  const countLabel = `${visibleCount} ${visibleCount === 1 ? 'item' : 'items'}`;
  return (
    <tbody className="inventory-type-group" hidden={visibleCount === 0}>
      <tr className="inventory-type-group-row">
        <th scope="rowgroup" colSpan={5}>
          <span className="flex min-w-0 items-center gap-2">
            {forced ? (
              <span className="inventory-slot text-base-content/60" aria-hidden>
                <AppIcon name="chevronDown" size={15} />
              </span>
            ) : (
              <button
                type="button"
                className="inventory-slot inventory-expand btn btn-ghost btn-xs text-base-content/60"
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.type}`}
                onClick={() => {
                  const next = !expanded;
                  setOpen(next);
                  writeTypeGroupExpanded(characterId, list, group.type, next);
                  if (!next) onCollapse(new Set(group.items.map((item) => item.id)));
                }}
              >
                <AppIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={15} />
              </button>
            )}
            {icon && <AppIcon name={icon} size={16} className="text-base-content/65" />}
            <span className="font-display text-base">{group.type}</span>
            {!expanded && (
              <span className="badge badge-sm badge-ghost" aria-label={countLabel}>
                {countLabel}
              </span>
            )}
          </span>
        </th>
      </tr>
      {group.items.map((item) => (
        <InventoryRow
          key={item.id}
          {...rowProps}
          item={item}
          depth={0}
          flat
          ancestorHidden={!expanded}
          containerName={item.parentId ? (byId.get(item.parentId)?.name ?? null) : null}
        />
      ))}
    </tbody>
  );
}
