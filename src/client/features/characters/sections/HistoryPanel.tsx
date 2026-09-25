import { type KeyboardEvent, useRef, useState } from 'react';
import { HistoryList } from '../../../features/history/HistoryList.tsx';
import { useCharacterHistory } from '../../../features/history/useHistoryQuery.ts';
import { RollHistoryPanel } from './RollHistoryPanel.tsx';

interface HistoryPanelProps {
  characterId: string;
}

export function HistoryPanel({ characterId }: HistoryPanelProps) {
  const [view, setView] = useState<'changes' | 'rolls'>('changes');
  const changeTabRef = useRef<HTMLButtonElement>(null);
  const rollTabRef = useRef<HTMLButtonElement>(null);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextView: 'changes' | 'rolls' | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextView = view === 'changes' ? 'rolls' : 'changes';
    } else if (event.key === 'Home') {
      nextView = 'changes';
    } else if (event.key === 'End') {
      nextView = 'rolls';
    }
    if (!nextView) return;

    event.preventDefault();
    setView(nextView);
    (nextView === 'changes' ? changeTabRef : rollTabRef).current?.focus();
  }

  return (
    <div className="space-y-4 py-2">
      <div className="panel-tabs" role="tablist" aria-label="History views">
        <button
          ref={changeTabRef}
          id="character-change-history-tab"
          type="button"
          role="tab"
          aria-selected={view === 'changes'}
          aria-controls="character-change-history-panel"
          tabIndex={view === 'changes' ? 0 : -1}
          className={`panel-tab ${view === 'changes' ? 'active' : ''}`}
          onClick={() => setView('changes')}
          onKeyDown={handleTabKeyDown}
        >
          Change history
        </button>
        <button
          ref={rollTabRef}
          id="character-roll-history-tab"
          type="button"
          role="tab"
          aria-selected={view === 'rolls'}
          aria-controls="character-roll-history-panel"
          tabIndex={view === 'rolls' ? 0 : -1}
          className={`panel-tab ${view === 'rolls' ? 'active' : ''}`}
          onClick={() => setView('rolls')}
          onKeyDown={handleTabKeyDown}
        >
          Roll history
        </button>
      </div>
      {view === 'changes' ? (
        <div
          id="character-change-history-panel"
          role="tabpanel"
          aria-labelledby="character-change-history-tab"
        >
          <ChangeHistory characterId={characterId} />
        </div>
      ) : (
        <div
          id="character-roll-history-panel"
          role="tabpanel"
          aria-labelledby="character-roll-history-tab"
        >
          <RollHistoryPanel characterId={characterId} />
        </div>
      )}
    </div>
  );
}

function ChangeHistory({ characterId }: HistoryPanelProps) {
  const {
    data,
    isLoading,
    isError,
    error,
    isFetchNextPageError,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useCharacterHistory(characterId);

  const events = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-3">
      <HistoryList
        events={events}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => void (isFetchNextPageError ? fetchNextPage() : refetch())}
        hasNextPage={hasNextPage ?? false}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={fetchNextPage}
      />
    </div>
  );
}
