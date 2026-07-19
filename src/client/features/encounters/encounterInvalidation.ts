import type { QueryClient } from '@tanstack/react-query';
import { encounterKeys } from './encountersApi.ts';

let invalidate: ((campaignId: string, encounterId: string) => void) | null = null;

export function mountEncounterInvalidations(queryClient: QueryClient): () => void {
  invalidate = (campaignId, encounterId) => {
    void queryClient.invalidateQueries({ queryKey: encounterKeys.detail(campaignId, encounterId) });
    void queryClient.invalidateQueries({ queryKey: encounterKeys.list(campaignId) });
  };
  return () => {
    invalidate = null;
  };
}

export function invalidateEncounter(campaignId: string, encounterId: string): void {
  invalidate?.(campaignId, encounterId);
}
