import { HistoryList } from '../../../features/history/HistoryList.tsx';
import { useCharacterHistory } from '../../../features/history/useHistoryQuery.ts';

interface HistoryPanelProps {
  characterId: string;
}

export function HistoryPanel({ characterId }: HistoryPanelProps) {
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useCharacterHistory(characterId);

  const events = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-3 py-2">
      <HistoryList
        events={events}
        isLoading={isLoading}
        hasNextPage={hasNextPage ?? false}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={fetchNextPage}
      />
    </div>
  );
}
