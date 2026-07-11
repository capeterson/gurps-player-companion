import { useState } from 'react';
import type { HistoryGroup } from '../../../shared/history/summarize.ts';
import type { HistoryEventOut } from '../../../shared/schemas/history.ts';

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function SingleRow({ event }: { event: HistoryEventOut }) {
  return (
    <div className="flex items-start gap-2 py-2 px-3 border-b border-base-200 last:border-0 hover:bg-base-200/40 transition-colors text-sm">
      <span className="text-base-content/40 text-xs tabular-nums w-16 shrink-0 pt-0.5">
        {formatRelative(event.createdAt)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="text-base-content">{event.summary}</span>
      </span>
      {event.actorDisplayName && (
        <span className="text-base-content/50 text-xs truncate max-w-24 shrink-0 pt-0.5">
          {event.actorDisplayName}
        </span>
      )}
    </div>
  );
}

interface GroupRowProps {
  group: HistoryGroup;
}

export function HistoryGroupRow({ group }: GroupRowProps) {
  const [open, setOpen] = useState(false);

  if (!group.foldable && group.events[0]) {
    return <SingleRow event={group.events[0]} />;
  }

  const first = group.events[0];

  return (
    <div className="border-b border-base-200 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-2 py-2 px-3 hover:bg-base-200/40 transition-colors text-sm text-left"
      >
        <span className="text-base-content/40 text-xs tabular-nums w-16 shrink-0 pt-0.5">
          {first ? formatRelative(first.createdAt) : ''}
        </span>
        <span className="flex-1 min-w-0 text-base-content">{group.groupSummary}</span>
        <span className="text-base-content/40 text-xs shrink-0 pt-0.5 select-none">
          {open ? '▾' : '▸'} {group.events.length}
        </span>
      </button>
      {open && (
        <div className="pl-4 bg-base-200/20">
          {group.events.map((ev) => (
            <SingleRow key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </div>
  );
}
