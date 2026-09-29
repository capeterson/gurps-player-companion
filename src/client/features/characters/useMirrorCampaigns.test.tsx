import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type CampaignOut, campaignHouseRules } from '../../../shared/schemas/campaign.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { enqueueFieldPatch } from '../../sync/outbox.ts';
import { useMirrorCampaigns } from './useMirrorCampaigns.ts';

const CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-00000000ca01';
const LOCAL_COVER_ID = '0193b3c0-f1f0-7000-8000-00000000ca02';
const REMOTE_COVER_ID = '0193b3c0-f1f0-7000-8000-00000000ca03';

function campaignRow(overrides: Partial<CampaignOut> = {}): CampaignOut {
  return {
    id: CAMPAIGN_ID,
    name: 'J Talisar',
    description: null,
    ownerId: '0193b3c0-f1f0-7000-8000-00000000ca04',
    pointTarget: 459,
    disadvantageCap: 80,
    quirkCap: 5,
    manaLevel: 'normal',
    houseRules: campaignHouseRules.parse({}),
    techLevel: 4,
    enforceAttributeCaps: true,
    shareCharacterSheets: true,
    allowGmCharacterEditing: false,
    experimentalTurnTracker: true,
    members: [],
    createdAt: '2026-09-13T01:43:28.831Z',
    updatedAt: '2026-09-13T01:43:28.831Z',
    revision: 1,
    ...overrides,
  };
}

afterEach(async () => {
  await getLocalDb().campaigns.clear();
  await getLocalDb().outbox.clear();
});

describe('useMirrorCampaigns', () => {
  it('retains REST campaign house rules when replacing a synced Dexie row', async () => {
    const houseRules = campaignHouseRules.parse({
      ruleSet: 'j_talisar',
      protectNaturalDr: true,
      enchantedItemPricing: true,
    });
    const campaign = campaignRow({ houseRules, skillPrerequisitePolicy: 'warn', revision: 354 });

    await getLocalDb().campaigns.put({
      ...campaign,
      houseRules: campaignHouseRules.parse({}),
      experimentalTurnTracker: false,
    });

    renderHook(() => useMirrorCampaigns([campaign]));

    await waitFor(async () => {
      expect((await getLocalDb().campaigns.get(CAMPAIGN_ID))?.houseRules).toEqual(houseRules);
      expect((await getLocalDb().campaigns.get(CAMPAIGN_ID))?.experimentalTurnTracker).toBe(true);
      expect((await getLocalDb().campaigns.get(CAMPAIGN_ID))?.skillPrerequisitePolicy).toBe('warn');
    });
  });

  it('preserves a pending local cover patch over a newer REST mirror', async () => {
    const db = getLocalDb();
    const existing = campaignRow({ revision: 5, coverAssetId: REMOTE_COVER_ID });
    await db.campaigns.put(existing);
    await enqueueFieldPatch({
      entityClass: 'campaign',
      entityId: CAMPAIGN_ID,
      fieldPath: 'coverAssetId',
      attemptedValue: LOCAL_COVER_ID,
    });
    const incoming = campaignRow({
      revision: 6,
      name: 'Updated from server',
      coverAssetId: REMOTE_COVER_ID,
    });

    renderHook(() => useMirrorCampaigns([incoming]));

    await waitFor(async () => {
      const local = await db.campaigns.get(CAMPAIGN_ID);
      expect(local?.name).toBe('Updated from server');
      expect(local?.revision).toBe(6);
      expect(local?.coverAssetId).toBe(LOCAL_COVER_ID);
    });
  });

  it('ignores a REST campaign row older than the current cursor revision', async () => {
    const db = getLocalDb();
    await db.campaigns.put(
      campaignRow({
        name: 'Newest cursor row',
        revision: 9,
        coverAssetId: LOCAL_COVER_ID,
      }),
    );
    const stale = campaignRow({
      name: 'Stale REST row',
      revision: 8,
      coverAssetId: REMOTE_COVER_ID,
    });

    renderHook(() => useMirrorCampaigns([stale]));

    await waitFor(async () => {
      expect(await db.campaigns.get(CAMPAIGN_ID)).toMatchObject({
        name: 'Newest cursor row',
        revision: 9,
        coverAssetId: LOCAL_COVER_ID,
      });
    });
  });
});
