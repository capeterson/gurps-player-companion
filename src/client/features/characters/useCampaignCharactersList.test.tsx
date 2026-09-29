import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalCampaign, LocalCharacter } from '../../db/dexie.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { useCampaignCharactersList } from './useCharacterDetail.ts';

const CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-0000000000c1';
const VIEWER_ID = '0193b3c0-f1f0-7000-8000-0000000000a1';
const OWNER_ID = '0193b3c0-f1f0-7000-8000-0000000000a2';

vi.mock('../../lib/tokenStore.ts', () => ({ readUserIdFromToken: () => VIEWER_ID }));

const time = '2026-09-29T00:00:00.000Z';

function campaign(overrides: Partial<LocalCampaign> = {}): LocalCampaign {
  return {
    id: CAMPAIGN_ID,
    name: 'The Long March',
    description: null,
    ownerId: OWNER_ID,
    pointTarget: 150,
    disadvantageCap: null,
    quirkCap: null,
    manaLevel: 'normal',
    shareCharacterSheets: true,
    allowGmCharacterEditing: false,
    createdAt: time,
    updatedAt: time,
    revision: 1,
    ...overrides,
  };
}

function character(overrides: Partial<LocalCharacter> = {}): LocalCharacter {
  return {
    id: '0193b3c0-f1f0-7000-8000-0000000000c2',
    ownerId: OWNER_ID,
    campaignId: CAMPAIGN_ID,
    name: 'Marin Vale',
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
    st: 11,
    dx: 12,
    iq: 13,
    ht: 14,
    hpMod: 0,
    willMod: 0,
    perMod: 0,
    fpMod: 0,
    speedQuarterMod: 0,
    moveMod: 0,
    dismissedWarnings: [],
    activeConditionGroups: [],
    createdAt: time,
    updatedAt: time,
    revision: 1,
    ...overrides,
  };
}

afterEach(async () => {
  await getLocalDb().characters.clear();
  await getLocalDb().campaigns.clear();
});

describe('useCampaignCharactersList privacy', () => {
  it('marks another player minimal when campaign sharing is disabled', async () => {
    const db = getLocalDb();
    await db.campaigns.put(campaign({ shareCharacterSheets: false }));
    await db.characters.put(character());

    const { result } = renderHook(() => useCampaignCharactersList(CAMPAIGN_ID));

    await waitFor(() => expect(result.current?.[0]?.minimal).toBe(true));
    expect(result.current?.[0]).toMatchObject({ campaignName: 'The Long March', st: 11, dx: 12 });
  });

  it('keeps an owner full even when campaign sharing is disabled', async () => {
    const db = getLocalDb();
    await db.campaigns.put(campaign({ ownerId: OWNER_ID, shareCharacterSheets: false }));
    await db.characters.put(character({ ownerId: VIEWER_ID }));

    const { result } = renderHook(() => useCampaignCharactersList(CAMPAIGN_ID));

    await waitFor(() => expect(result.current?.[0]?.minimal).toBe(false));
  });

  it('keeps the campaign owner full when sharing is disabled', async () => {
    const db = getLocalDb();
    await db.campaigns.put(campaign({ ownerId: VIEWER_ID, shareCharacterSheets: false }));
    await db.characters.put(character());

    const { result } = renderHook(() => useCampaignCharactersList(CAMPAIGN_ID));

    await waitFor(() => expect(result.current?.[0]?.minimal).toBe(false));
  });

  it('keeps manager edits full when the campaign permits character editing', async () => {
    const db = getLocalDb();
    await db.campaigns.put(
      campaign({
        shareCharacterSheets: false,
        allowGmCharacterEditing: true,
        viewerRole: 'manager',
      }),
    );
    await db.characters.put(character());

    const { result } = renderHook(() => useCampaignCharactersList(CAMPAIGN_ID));

    await waitFor(() => expect(result.current?.[0]?.minimal).toBe(false));
  });

  it.each([
    ['masked after a share-gate change', { minimalViewMasked: true }],
    ['retained after access was revoked', { accessRevoked: true }],
  ])('marks a cached row minimal when it is %s', async (_label, marker) => {
    const db = getLocalDb();
    await db.campaigns.put(campaign());
    await db.characters.put(character(marker));

    const { result } = renderHook(() => useCampaignCharactersList(CAMPAIGN_ID));

    await waitFor(() => expect(result.current?.[0]?.minimal).toBe(true));
  });

  it('switches a cached full row to minimal immediately when sharing turns off', async () => {
    const db = getLocalDb();
    await db.campaigns.put(campaign({ shareCharacterSheets: true }));
    await db.characters.put(character());
    const { result } = renderHook(() => useCampaignCharactersList(CAMPAIGN_ID));

    await waitFor(() => expect(result.current?.[0]?.minimal).toBe(false));
    await db.campaigns.update(CAMPAIGN_ID, { shareCharacterSheets: false });

    await waitFor(() => expect(result.current?.[0]?.minimal).toBe(true));
    expect(result.current?.[0]).toMatchObject({ st: 11, dx: 12, iq: 13, ht: 14 });
  });

  it('fails closed if a cached character has no campaign row', async () => {
    await getLocalDb().characters.put(character());
    const { result } = renderHook(() => useCampaignCharactersList(CAMPAIGN_ID));

    await waitFor(() => expect(result.current?.[0]?.minimal).toBe(true));
  });
});
