import { useLiveQuery } from 'dexie-react-hooks';
import { getLocalDb } from '../db/dexie.ts';

/** Unknown, old cached, and unassigned campaigns never opt into experiments. */
export function useExperimentalActiveEffects(campaignId: string | null | undefined): boolean {
  return useLiveQuery(
    async () =>
      !!campaignId &&
      (await getLocalDb().campaigns.get(campaignId))?.experimentalActiveEffects === true,
    [campaignId],
    false,
  );
}
