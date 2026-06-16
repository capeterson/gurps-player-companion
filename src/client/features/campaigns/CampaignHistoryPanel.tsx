import { useState } from 'react';
import { HistoryList } from '../history/HistoryList.tsx';
import { useCampaignHistory } from '../history/useHistoryQuery.ts';

interface CampaignHistoryPanelProps {
  campaignId: string;
  isOwner: boolean;
}

export function CampaignHistoryPanel({ campaignId, isOwner }: CampaignHistoryPanelProps) {
  const [scope, setScope] = useState<'campaign' | 'character'>('campaign');

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useCampaignHistory(
    campaignId,
    scope,
  );

  const events = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-3 py-2">
      {isOwner && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setScope('campaign')}
            className={`chip text-xs ${scope === 'campaign' ? 'on' : ''}`}
          >
            Campaign changes
          </button>
          <button
            type="button"
            onClick={() => setScope('character')}
            className={`chip text-xs ${scope === 'character' ? 'on' : ''}`}
          >
            Character changes
          </button>
        </div>
      )}
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
