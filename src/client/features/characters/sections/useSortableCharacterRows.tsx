import { useState } from 'react';
import { type TableColumnGrouping, TableHeader } from '../../../components/ui/Table.tsx';
import type { TablePreferences } from './tablePreferences.ts';

type Comparator<Row> = (left: Row, right: Row) => number;

export function compareTableText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

export function compareOptionalLevel(left: number | null, right: number | null): number {
  if (left == null || right == null) {
    if (left == null && right == null) return 0;
    return left == null ? 1 : -1;
  }
  return left - right;
}

/** Shared sorting, filtering, persistence and accessible reorder state for sheet tables. */
export function useSortableCharacterRows<Row extends { id: string }, Sort extends string>({
  rows,
  characterId,
  query,
  readPreferences,
  savePreferences,
  comparators,
  matchesSearch,
  announcementName,
}: {
  rows: readonly Row[];
  characterId: string;
  query: string;
  readPreferences: (characterId: string) => TablePreferences<Sort>;
  savePreferences: (characterId: string, preferences: TablePreferences<Sort>) => boolean;
  comparators: Record<Exclude<Sort, 'custom'>, Comparator<Row>>;
  matchesSearch: (row: Row, normalizedQuery: string) => boolean;
  announcementName: (row: Row) => string;
}) {
  const [preferences, setPreferences] = useState(() => readPreferences(characterId));
  const [saveFailed, setSaveFailed] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const customOrder = [
    ...preferences.order.filter((id) => rowsById.has(id)),
    ...rows.filter((row) => !preferences.order.includes(row.id)).map((row) => row.id),
  ];
  const customPosition = new Map(customOrder.map((id, index) => [id, index]));
  const positionOf = (id: string) => customPosition.get(id) ?? Number.MAX_SAFE_INTEGER;
  const sortedRows = [...rows].sort((left, right) => {
    const tieBreak = positionOf(left.id) - positionOf(right.id);
    if (preferences.sort === 'custom') return tieBreak;
    const compare = comparators[preferences.sort as Exclude<Sort, 'custom'>];
    const result = compare(left, right);
    return (preferences.descending ? -result : result) || tieBreak;
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRows = sortedRows.filter(
    (row) => !normalizedQuery || matchesSearch(row, normalizedQuery),
  );
  const visibleIds = new Set(visibleRows.map((row) => row.id));

  function save(next: TablePreferences<Sort>) {
    setPreferences(next);
    setSaveFailed(!savePreferences(characterId, next));
  }

  function sortBy(sort: Exclude<Sort, 'custom'>) {
    save({
      ...preferences,
      sort,
      descending: preferences.sort === sort ? !preferences.descending : false,
    });
  }

  function move(id: string, targetId: string) {
    const movingRow = rowsById.get(id);
    if (!movingRow) return;
    const displayedOrder = sortedRows.map((row) => row.id);
    const from = displayedOrder.indexOf(id);
    const to = displayedOrder.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...displayedOrder];
    next.splice(from, 1);
    next.splice(to, 0, id);
    save({ order: next, sort: 'custom' as Sort, descending: false });
    const visiblePosition = visibleRows.findIndex((row) => row.id === targetId) + 1;
    setAnnouncement(`${announcementName(movingRow)} moved to position ${visiblePosition}.`);
  }

  function moveBy(id: string, direction: -1 | 1) {
    const visibleOrder = visibleRows.map((row) => row.id);
    const current = visibleOrder.indexOf(id);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= visibleOrder.length) return;
    move(id, visibleOrder[target] ?? id);
  }

  return {
    preferences,
    saveFailed,
    draggingId,
    setDraggingId,
    announcement,
    sortedRows,
    visibleRows,
    visibleIds,
    sortBy,
    move,
    moveBy,
  };
}

export function SortableHeader<Sort extends string>({
  label,
  sort,
  preferences,
  onSort,
  headerClassName = '',
  shortLabel,
  hideButtonOnMobile = false,
  filterable = true,
  filterLabel,
  rangeStep,
  grouping,
}: {
  label: string;
  sort: Exclude<Sort, 'custom'>;
  preferences: TablePreferences<Sort>;
  onSort: (sort: Exclude<Sort, 'custom'>) => void;
  headerClassName?: string;
  shortLabel?: string;
  hideButtonOnMobile?: boolean;
  filterable?: boolean;
  filterLabel?: string;
  rangeStep?: number;
  grouping?: TableColumnGrouping;
}) {
  const active = preferences.sort === sort;
  const alignRight = headerClassName.includes('text-right');
  // Only the active column shows its direction; idle columns reveal ↕ on
  // hover/focus. Right-aligned columns put the glyph before the label so the
  // label's edge, not the glyph, lines up with the values below.
  const indicator = (
    <span
      aria-hidden="true"
      className={active ? '' : 'opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60'}
    >
      {active ? (preferences.descending ? '↓' : '↑') : '↕'}
    </span>
  );
  return (
    <TableHeader
      filterable={filterable}
      indicatorClassName={hideButtonOnMobile ? 'hidden sm:inline' : ''}
      column={sort}
      label={label}
      {...(filterLabel ? { filterLabel } : {})}
      {...(rangeStep ? { rangeStep } : {})}
      {...(grouping ? { grouping } : {})}
      scope="col"
      className={headerClassName}
      aria-sort={active ? (preferences.descending ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        className={`group btn btn-ghost btn-xs -mx-1 h-auto min-h-0 gap-1 whitespace-nowrap px-1 py-1 font-semibold ${hideButtonOnMobile ? 'hidden sm:inline-flex' : ''} ${alignRight ? 'w-[calc(100%+0.5rem)] justify-end' : 'justify-start'}`}
        onClick={() => onSort(sort)}
        aria-label={`Sort by ${label}`}
      >
        {alignRight && indicator}
        <span className={shortLabel ? 'hidden sm:inline' : undefined}>{label}</span>
        {shortLabel && <span className="sm:hidden">{shortLabel}</span>}
        {!alignRight && indicator}
      </button>
    </TableHeader>
  );
}
