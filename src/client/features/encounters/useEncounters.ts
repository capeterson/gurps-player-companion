import { useQuery } from '@tanstack/react-query';
import { encounterKeys, encountersApi } from './encountersApi.ts';

export function useEncounters(campaignId: string) {
  return useQuery({
    queryKey: encounterKeys.list(campaignId),
    queryFn: () => encountersApi.list(campaignId),
    enabled: campaignId.length > 0,
  });
}

export function useEncounter(campaignId: string, encounterId: string) {
  return useQuery({
    queryKey: encounterKeys.detail(campaignId, encounterId),
    queryFn: () => encountersApi.get(campaignId, encounterId),
    enabled: campaignId.length > 0 && encounterId.length > 0,
  });
}
