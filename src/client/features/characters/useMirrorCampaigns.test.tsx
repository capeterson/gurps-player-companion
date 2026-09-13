import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type CampaignOut, campaignHouseRules } from '../../../shared/schemas/campaign.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { useMirrorCampaigns } from './useMirrorCampaigns.ts';

const CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-00000000ca01';

afterEach(async () => {
  await getLocalDb().campaigns.clear();
});

describe('useMirrorCampaigns', () => {
  it('retains REST campaign house rules when replacing a synced Dexie row', async () => {
    const houseRules = campaignHouseRules.parse({
      ruleSet: 'j_talisar',
      protectNaturalDr: true,
      enchantedItemPricing: true,
    });
    const campaign: CampaignOut = {
      id: CAMPAIGN_ID,
      name: 'J Talisar',
      description: null,
      ownerId: '0193b3c0-f1f0-7000-8000-00000000ca02',
      pointTarget: 459,
      disadvantageCap: 80,
      quirkCap: 5,
      manaLevel: 'normal',
      houseRules,
      techLevel: 4,
      enforceAttributeCaps: true,
      shareCharacterSheets: true,
      allowGmCharacterEditing: false,
      members: [],
      createdAt: '2026-09-13T01:43:28.831Z',
      updatedAt: '2026-09-13T01:43:28.831Z',
      revision: 354,
    };

    await getLocalDb().campaigns.put({
      ...campaign,
      houseRules: campaignHouseRules.parse({}),
    });

    renderHook(() => useMirrorCampaigns([campaign]));

    await waitFor(async () => {
      expect((await getLocalDb().campaigns.get(CAMPAIGN_ID))?.houseRules).toEqual(houseRules);
    });
  });
});
