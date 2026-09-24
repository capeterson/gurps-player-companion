import { useState } from 'react';
import { HistoryList } from '../history/HistoryList.tsx';
import { fetchCampaignHistoryEventDetail, useCampaignHistory } from '../history/useHistoryQuery.ts';

interface CampaignHistoryPanelProps {
  campaignId: string;
  isOwner: boolean;
}

export function CampaignHistoryPanel({ campaignId, isOwner }: CampaignHistoryPanelProps) {
  const [scope, setScope] = useState<'campaign' | 'character'>('campaign');

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
  } = useCampaignHistory(campaignId, scope);

  const events = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-3 py-2">
      {isOwner && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setScope('campaign')}
            aria-pressed={scope === 'campaign'}
            className={`chip text-xs ${scope === 'campaign' ? 'on' : ''}`}
          >
            Campaign changes
          </button>
          <button
            type="button"
            onClick={() => setScope('character')}
            aria-pressed={scope === 'character'}
            className={`chip text-xs ${scope === 'character' ? 'on' : ''}`}
          >
            Character changes
          </button>
        </div>
      )}
      <HistoryList
        events={events}
        isLoading={isLoading}
        error={isError ? error : null}
        onRetry={() => void (isFetchNextPageError ? fetchNextPage() : refetch())}
        hasNextPage={hasNextPage ?? false}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={fetchNextPage}
        showDetails={(event) => event.entityClass.startsWith('campaign_library_')}
        loadDetails={(event) => fetchCampaignHistoryEventDetail(campaignId, event)}
      />
    </div>
  );
}
