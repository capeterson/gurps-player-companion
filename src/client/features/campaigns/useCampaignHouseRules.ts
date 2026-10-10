import { useLiveQuery } from 'dexie-react-hooks';
import { type CampaignHouseRules, campaignHouseRules } from '../../../shared/schemas/campaign.ts';
import { getLocalDb } from '../../db/dexie.ts';

const DEFAULT_HOUSE_RULES = campaignHouseRules.parse({});

/** The mirrored campaign's house rules, or the defaults when unavailable. */
export function useCampaignHouseRules(campaignId: string | null | undefined): CampaignHouseRules {
  const stored = useLiveQuery(
    async () =>
      campaignId ? (await getLocalDb().campaigns.get(campaignId))?.houseRules : undefined,
    [campaignId],
  );
  if (!stored) return DEFAULT_HOUSE_RULES;
  const parsed = campaignHouseRules.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_HOUSE_RULES;
}
