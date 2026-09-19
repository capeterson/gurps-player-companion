import { useState } from 'react';
import { type HistoryGroup, summarizeEvent } from '../../../shared/history/summarize.ts';
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

/** Full localized timestamp down to the second, for the hover tooltip. */
function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

function actorName(event: HistoryEventOut): string | null | undefined {
  return event.actorDisplayName
    ? `${event.actorDisplayName}${event.agentClientName ? ` via ${event.agentClientName}` : ''}`
    : event.agentClientName;
}

function SingleRow({
  event,
  showDetails,
  loadDetails,
}: {
  event: HistoryEventOut;
  showDetails?: ((event: HistoryEventOut) => boolean) | undefined;
  loadDetails?: ((event: HistoryEventOut) => Promise<HistoryEventOut>) | undefined;
}) {
  const actor = actorName(event);
  const hasSnapshots = event.oldRow !== undefined || event.newRow !== undefined;
  const expandable = showDetails?.(event) === true && (hasSnapshots || loadDetails !== undefined);
  const [detailEvent, setDetailEvent] = useState<HistoryEventOut | null>(
    hasSnapshots ? event : null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const requestDetails = async () => {
    if (detailEvent || detailLoading || !loadDetails) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetailEvent(await loadDetails(event));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Could not load history details.');
    } finally {
      setDetailLoading(false);
    }
  };
  const content = (
    <>
      <span
        className="text-base-content/40 text-xs tabular-nums w-16 shrink-0 pt-0.5"
        title={formatAbsolute(event.createdAt)}
      >
        {formatRelative(event.createdAt)}
      </span>
      {expandable && (
        <span
          aria-hidden="true"
          className="inline-block shrink-0 text-base-content/40 transition-transform group-open:rotate-90"
        >
          ›
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="text-base-content">{event.summary}</span>
      </span>
      {actor && (
        <span className="text-base-content/50 text-xs truncate max-w-24 shrink-0 pt-0.5">
          {actor}
        </span>
      )}
    </>
  );

  if (expandable) {
    return (
      <details
        className="group border-b border-base-200 last:border-0"
        onToggle={(toggleEvent) => {
          if (toggleEvent.currentTarget.open) void requestDetails();
        }}
      >
        <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2 text-sm transition-colors hover:bg-base-200/40">
          {content}
        </summary>
        {detailEvent ? (
          <HistoryEventDetails event={detailEvent} />
        ) : (
          <div className="border-t border-base-300 bg-base-200/40 px-3 py-2 text-xs text-base-content/60">
            {detailLoading ? (
              'Loading details…'
            ) : detailError ? (
              <span className="flex flex-wrap items-center gap-2 text-error">
                {detailError}
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => void requestDetails()}
                >
                  Retry
                </button>
              </span>
            ) : null}
          </div>
        )}
      </details>
    );
  }

  return (
    <div className="flex items-start gap-2 py-2 px-3 border-b border-base-200 last:border-0 hover:bg-base-200/40 transition-colors text-sm">
      {content}
    </div>
  );
}

function HistoryEventDetails({ event }: { event: HistoryEventOut }) {
  const { changes } = summarizeEvent({
    entityClass: event.entityClass,
    op: event.op,
    oldRow: event.oldRow ?? null,
    newRow: event.newRow ?? null,
  });

  return (
    <div className="border-t border-base-300 bg-base-200/40 px-3 py-2 text-xs">
      {changes.length > 0 ? (
        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-2">
          {changes.map((change) => (
            <div key={change.field} className="contents">
              <dt className="text-base-content/60">{change.label}</dt>
              <dd className="min-w-0 break-words font-mono">
                <HistoryValue value={change.oldValue} />
                <span className="px-2 text-base-content/40">→</span>
                <HistoryValue value={change.newValue} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-base-content/60">
          {event.op === 'insert'
            ? 'The complete added definition is available below.'
            : event.op === 'delete'
              ? 'The complete removed definition is available below.'
              : 'No field-level differences were recorded.'}
        </p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-base-content/60">Raw</summary>
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all">
          {JSON.stringify({ before: event.oldRow ?? null, after: event.newRow ?? null }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function HistoryValue({ value }: { value: unknown }) {
  if (value === undefined) return <span className="text-base-content/50">(not recorded)</span>;
  if (value === null) return <span className="text-base-content/50">(empty)</span>;
  if (typeof value === 'string') {
    return value.length === 0 ? <span className="text-base-content/50">(blank)</span> : value;
  }
  if (typeof value !== 'object') return String(value);
  return (
    <pre className="inline-block max-h-40 max-w-full overflow-auto whitespace-pre-wrap break-all align-top">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

interface GroupRowProps {
  group: HistoryGroup;
  showDetails?: ((event: HistoryEventOut) => boolean) | undefined;
  loadDetails?: ((event: HistoryEventOut) => Promise<HistoryEventOut>) | undefined;
}

export function HistoryGroupRow({ group, showDetails, loadDetails }: GroupRowProps) {
  const [open, setOpen] = useState(false);

  if (!group.foldable && group.events[0]) {
    return (
      <SingleRow event={group.events[0]} showDetails={showDetails} loadDetails={loadDetails} />
    );
  }

  const first = group.events[0];
  const actor = group.events.every(
    (event) =>
      event.actorDisplayName === first?.actorDisplayName &&
      event.agentClientName === first?.agentClientName,
  )
    ? first?.actorDisplayName
      ? `${first.actorDisplayName}${first.agentClientName ? ` via ${first.agentClientName}` : ''}`
      : first?.agentClientName
    : null;

  return (
    <div className="border-b border-base-200 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-2 py-2 px-3 hover:bg-base-200/40 transition-colors text-sm text-left"
      >
        <span
          className="text-base-content/40 text-xs tabular-nums w-16 shrink-0 pt-0.5"
          title={first ? formatAbsolute(first.createdAt) : undefined}
        >
          {first ? formatRelative(first.createdAt) : ''}
        </span>
        <span className="flex-1 min-w-0 text-base-content">{group.groupSummary}</span>
        {actor && (
          <span className="text-base-content/40 text-xs truncate max-w-24 shrink-0 pt-0.5">
            {actor}
          </span>
        )}
        <span className="text-base-content/40 text-xs shrink-0 pt-0.5 select-none">
          {open ? '▾' : '▸'} {group.events.length}
        </span>
      </button>
      {open && (
        <div className="pl-4 bg-base-200/20">
          {group.events.map((ev) => (
            <SingleRow key={ev.id} event={ev} showDetails={showDetails} loadDetails={loadDetails} />
          ))}
        </div>
      )}
    </div>
  );
}
