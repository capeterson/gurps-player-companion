import { useEffect, useRef, useState } from 'react';
import type { HistoryEventOut } from '../../../shared/schemas/history.ts';
import { useCampaignHistory } from '../history/useHistoryQuery.ts';

interface Props {
  campaignId: string;
  characterNames: ReadonlyMap<string, string>;
}

export function GmChangeFeed({ campaignId, characterNames }: Props) {
  const history = useCampaignHistory(campaignId, 'character', 5_000);
  const events = history.data?.pages.flatMap((page) => page.items) ?? [];
  const initialized = useRef(false);
  const observed = useRef(new Set<string>());
  const [highlighted, setHighlighted] = useState(() => new Set<string>());
  const fadeTimers = useRef(new Set<number>());

  // Un-highlight timers must NOT be cleared by the effect below re-running
  // (it re-runs on every render — `events` is rebuilt each time — so a
  // per-effect cleanup would cancel the fade whenever the 5s poll
  // re-rendered within the 30s window, leaving rows highlighted forever).
  // They're only cleared on unmount.
  useEffect(() => {
    const timers = fadeTimers.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!initialized.current) {
      for (const event of events) observed.current.add(event.id);
      initialized.current = true;
      return;
    }
    const fresh = events.filter((event) => !observed.current.has(event.id));
    if (fresh.length === 0) return;
    for (const event of fresh) observed.current.add(event.id);
    setHighlighted((current) => new Set([...current, ...fresh.map((event) => event.id)]));
    const timer = window.setTimeout(() => {
      fadeTimers.current.delete(timer);
      setHighlighted((current) => {
        const next = new Set(current);
        for (const event of fresh) next.delete(event.id);
        return next;
      });
    }, 30_000);
    fadeTimers.current.add(timer);
  }, [events]);

  return (
    <aside className="card border border-base-300 bg-base-100 overflow-hidden xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)]">
      <header className="flex items-center justify-between border-b border-base-300 px-4 py-3">
        <div>
          <p className="label-eyebrow">Live activity</p>
          <h2 className="font-display text-xl">Character changes</h2>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => history.refetch()}
          disabled={history.isFetching}
        >
          Refresh
        </button>
      </header>
      <div className="overflow-y-auto">
        {history.isLoading && <p className="p-4 text-sm text-base-content/50">Loading changes…</p>}
        {!history.isLoading && events.length === 0 && (
          <p className="p-4 text-sm text-base-content/50">No character changes yet.</p>
        )}
        {events.map((event) => {
          const characterName = event.characterId
            ? characterNames.get(event.characterId)
            : undefined;
          return (
            <ChangeRow
              key={event.id}
              event={event}
              {...(characterName ? { characterName } : {})}
              highlighted={highlighted.has(event.id)}
            />
          );
        })}
      </div>
    </aside>
  );
}

function ChangeRow({
  event,
  characterName,
  highlighted,
}: { event: HistoryEventOut; characterName?: string; highlighted: boolean }) {
  return (
    <div
      className={`border-b border-base-300 px-4 py-3 transition-colors duration-[30000ms] ${highlighted ? 'bg-warning/25' : 'bg-transparent'}`}
    >
      <div className="flex justify-between gap-2 text-xs text-base-content/50">
        <strong className="truncate text-base-content/70">{characterName ?? 'Character'}</strong>
        <time dateTime={event.createdAt}>
          {new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
      <p className="mt-1 text-sm leading-snug">{event.summary}</p>
      {event.actorDisplayName && (
        <p className="mt-1 text-xs text-base-content/40">by {event.actorDisplayName}</p>
      )}
    </div>
  );
}
