import { useMemo, useState } from 'react';
import { groupIntoBatches } from '../../../shared/history/summarize.ts';
import type { HistoryEventOut } from '../../../shared/schemas/history.ts';
import { HistoryGroupRow } from './HistoryGroupRow.tsx';

const ENTITY_FILTERS = [
  { label: 'Attributes', match: (e: HistoryEventOut) => e.entityClass === 'character' },
  {
    label: 'Traits',
    match: (e: HistoryEventOut) => e.entityClass === 'character_trait',
  },
  {
    label: 'Skills',
    match: (e: HistoryEventOut) =>
      e.entityClass === 'character_skill' || e.entityClass === 'character_spell',
  },
  {
    label: 'Inventory',
    match: (e: HistoryEventOut) => e.entityClass === 'character_inventory',
  },
  {
    label: 'Combat',
    match: (e: HistoryEventOut) => e.entityClass === 'character_combat',
  },
] as const;

// History rows store the DB-level op values (`insert` / `update` /
// `delete`), so filters must match those — not the outbox command names
// (`create` / `patch`). The labels are the user-facing verbs.
const OP_FILTERS = [
  { op: 'insert', label: 'Added' },
  { op: 'update', label: 'Changed' },
  { op: 'delete', label: 'Removed' },
] as const;
type OpFilter = (typeof OP_FILTERS)[number]['op'];

interface HistoryListProps {
  events: HistoryEventOut[];
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

export function HistoryList({
  events,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: HistoryListProps) {
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [opFilter, setOpFilter] = useState<OpFilter | null>(null);

  const filtered = useMemo(() => {
    let list = events;
    if (entityFilter) {
      const def = ENTITY_FILTERS.find((f) => f.label === entityFilter);
      if (def) list = list.filter(def.match);
    }
    if (opFilter) {
      list = list.filter((e) => e.op === opFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) => e.summary.toLowerCase().includes(q));
    }
    return list;
  }, [events, entityFilter, opFilter, search]);

  const groups = useMemo(() => groupIntoBatches(filtered), [filtered]);

  if (isLoading) {
    return <p className="text-sm text-base-content/50 p-4">Loading history…</p>;
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          placeholder="Search history…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input input-sm input-bordered flex-1 min-w-40 max-w-xs"
        />
        <div className="flex gap-1 flex-wrap">
          {ENTITY_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setEntityFilter(entityFilter === f.label ? null : f.label)}
              className={`chip text-xs ${entityFilter === f.label ? 'on' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {OP_FILTERS.map(({ op, label }) => (
            <button
              key={op}
              type="button"
              onClick={() => setOpFilter(opFilter === op ? null : op)}
              className={`chip text-xs ${opFilter === op ? 'on' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* History list */}
      {groups.length === 0 ? (
        <p className="text-sm text-base-content/50 p-4 text-center">
          {search || entityFilter || opFilter ? 'No matches.' : 'No history yet.'}
        </p>
      ) : (
        <div className="rounded-lg border border-base-300 bg-base-100 overflow-hidden">
          {groups.map((g) => (
            <HistoryGroupRow key={g.batchId ?? g.events[0]?.id ?? Math.random()} group={g} />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="btn btn-ghost btn-sm"
          >
            {isFetchingNextPage ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </div>
  );
}
