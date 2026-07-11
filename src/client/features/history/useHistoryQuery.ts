import { useInfiniteQuery } from '@tanstack/react-query';
import type { HistoryEventOut } from '../../../shared/schemas/history.ts';
import { api } from '../../lib/api.ts';

interface HistoryPage {
  items: HistoryEventOut[];
  nextCursor: number | null;
}

async function fetchHistoryPage(url: string, before?: number): Promise<HistoryPage> {
  const params = new URLSearchParams();
  if (before !== undefined) params.set('before', String(before));
  params.set('limit', '50');
  const fullUrl = params.size > 0 ? `${url}?${params}` : url;
  const items = await api<HistoryEventOut[]>(fullUrl);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: items.length === 50 && last ? last.revision : null,
  };
}

export function useCharacterHistory(characterId: string) {
  return useInfiniteQuery({
    queryKey: ['history', 'character', characterId],
    queryFn: ({ pageParam }) =>
      fetchHistoryPage(`/characters/${characterId}/history`, pageParam as number | undefined),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: characterId.length > 0,
  });
}

export function useCampaignHistory(
  campaignId: string,
  scope?: 'campaign' | 'character',
  refetchInterval?: number,
) {
  return useInfiniteQuery<HistoryPage, Error>({
    queryKey: ['history', 'campaign', campaignId, scope],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam !== undefined) params.set('before', String(pageParam));
      params.set('limit', '50');
      if (scope) params.set('scope', scope);
      return api<HistoryEventOut[]>(`/campaigns/${campaignId}/history?${params}`).then((items) => ({
        items,
        nextCursor: items.length === 50 ? (items[items.length - 1]?.revision ?? null) : null,
      }));
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: campaignId.length > 0,
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
  });
}
