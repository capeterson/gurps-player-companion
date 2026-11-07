import { useState } from 'react';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { AppIcon } from '../../../../components/ui/AppIcon.tsx';
import { useTableFiltersActive, useTableRowMatches } from '../../../../components/ui/Table.tsx';
import { InventoryRow, type InventoryRowProps } from '../InventoryRow.tsx';
import { readTypeGroupExpanded, writeTypeGroupExpanded } from '../inventoryContainerState.ts';
import {
  type InventoryLocationGroup as Group,
  flattenDFS,
  inventoryFilterValues,
} from '../inventoryTree.ts';

/** Heading for stashed items that have no stash location. */
export const NO_STASH_LOCATION_LABEL = 'No location';

/**
 * One folding stash-location section of the Stashed list. A view over the
 * list, never a container or drop target. It folds with a chevron, remembers
 * that choice per character on this device, opens while searching or
 * filtering, and opens to reveal a deep-linked item; collapsing deselects what
 * it hides.
 */
export function InventoryLocationGroup({
  characterId,
  group,
  byParent,
  revealItemId,
  forceOpen,
  onCollapse,
  rowProps,
}: {
  characterId: string;
  group: Group;
  byParent: ReadonlyMap<string | null, InventoryItemOut[]>;
  revealItemId: string | null;
  forceOpen: boolean;
  onCollapse: (itemIds: ReadonlySet<string>) => void;
  rowProps: Omit<InventoryRowProps, 'item' | 'depth' | 'flat' | 'containerName'>;
}) {
  const label = group.location ?? NO_STASH_LOCATION_LABEL;
  const foldKey = `location:${group.key}`;
  const [open, setOpen] = useState(() => readTypeGroupExpanded(characterId, 'stashed', foldKey));
  const columnFiltersActive = useTableFiltersActive();
  const matchesRow = useTableRowMatches();
  const everyItem = flattenDFS([...group.items], byParent);
  const forced = forceOpen || columnFiltersActive;
  const revealed = everyItem.some((item) => item.id === revealItemId);
  const expanded = forced || revealed || open;
  const visibleCount = everyItem.filter((item) =>
    matchesRow(inventoryFilterValues(item, true, rowProps.costTotals)),
  ).length;
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
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
                onClick={() => {
                  const next = !expanded;
                  setOpen(next);
                  writeTypeGroupExpanded(characterId, 'stashed', foldKey, next);
                  if (!next) onCollapse(new Set(everyItem.map((item) => item.id)));
                }}
              >
                <AppIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={15} />
              </button>
            )}
            <span className="font-display text-base break-words min-w-0">{label}</span>
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
          hideStashLocation
          item={item}
          depth={0}
          ancestorHidden={!expanded}
        />
      ))}
    </tbody>
  );
}
