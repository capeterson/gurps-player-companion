/**
 * useCharacterAccessLocal — the local-first variant of the share-gate
 * decision (AGENTS.md: "the share gate applies to EVERY payload
 * carrying character data", single-sourced in useCharacterAccess).
 *
 * Regression coverage for the finding this file fixes: on a cold /
 * offline cache the REST `/campaigns` query hadn't resolved yet, so
 * `useCharacterAccess(character, campaigns.data, meId)` found no
 * campaign row and `isMinimal` came back `false` for a non-owner who
 * should have been share-gated — the sheet page rendered full
 * content until the REST list caught up.
 *
 * `useCharacterAccessLocal` fixes this by reading campaign rows from
 * Dexie (which the sync cursor already pulls read-only, rule S0) via
 * `useLiveQuery`, and by exposing `accessPending` so callers can hold
 * their loading state until the gate is actually decided.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { useCharacterAccessLocal } from './useCharacterAccess.ts';

const OWNER_ID = '0193b3c0-f1f0-7000-8000-0000000000a1';
const OTHER_MEMBER_ID = '0193b3c0-f1f0-7000-8000-0000000000a2';
const CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-0000000000c1';

/**
 * The hook only reads `ownerId` and `campaignId` off the character, so
 * a focused partial cast keeps the fixture honest about what the code
 * under test depends on (same pattern as useCombatPatch.test.ts).
 */
function makeCharacter(campaignId: string | null, ownerId = OWNER_ID): CharacterDetail {
  return {
    id: '0193b3c0-f1f0-7000-8000-0000000000ch',
    ownerId,
    campaignId,
  } as unknown as CharacterDetail;
}

async function seedCampaign(overrides: {
  shareCharacterSheets: boolean;
  allowGmCharacterEditing?: boolean;
  viewerRole?: 'owner' | 'manager' | 'member';
}): Promise<void> {
  const db = getLocalDb();
  await db.campaigns.put({
    id: CAMPAIGN_ID,
    name: 'Test Campaign',
    description: null,
    ownerId: OWNER_ID,
    pointTarget: 150,
    disadvantageCap: null,
    quirkCap: null,
    manaLevel: 'normal',
    shareCharacterSheets: overrides.shareCharacterSheets,
    allowGmCharacterEditing: overrides.allowGmCharacterEditing ?? false,
    ...(overrides.viewerRole ? { viewerRole: overrides.viewerRole } : {}),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
  });
}

describe('useCharacterAccessLocal', () => {
  it('holds the gate (accessPending) for a non-owner while the Dexie campaigns query is unresolved', async () => {
    const character = makeCharacter(CAMPAIGN_ID);
    const { result } = renderHook(() => useCharacterAccessLocal(character, OTHER_MEMBER_ID));

    // Before the useLiveQuery microtask resolves, the hook must hold —
    // never fall through to "isMinimal: false" (which is what let full
    // content render in the bug this test guards against).
    expect(result.current.accessPending).toBe(true);
    expect(result.current.isMinimal).toBe(false);

    // No campaign row was ever seeded, so once the query resolves it's
    // a "genuinely unknown locally" campaign — accessPending clears,
    // and the pre-existing (non-minimal, since campaign is undefined)
    // semantics apply.
    await waitFor(() => {
      expect(result.current.accessPending).toBe(false);
    });
    expect(result.current.isMinimal).toBe(false);
  });

  it('resolves isMinimal true for a non-owner once a share-gated campaign row loads from Dexie', async () => {
    await seedCampaign({ shareCharacterSheets: false });

    const character = makeCharacter(CAMPAIGN_ID);
    const { result } = renderHook(() => useCharacterAccessLocal(character, OTHER_MEMBER_ID));

    await waitFor(() => {
      expect(result.current.accessPending).toBe(false);
    });
    expect(result.current.isMinimal).toBe(true);
    expect(result.current.canWrite).toBe(false);
  });

  it('resolves isMinimal false for a non-owner when the campaign shares sheets', async () => {
    await seedCampaign({ shareCharacterSheets: true });

    const character = makeCharacter(CAMPAIGN_ID);
    const { result } = renderHook(() => useCharacterAccessLocal(character, OTHER_MEMBER_ID));

    await waitFor(() => {
      expect(result.current.accessPending).toBe(false);
    });
    expect(result.current.isMinimal).toBe(false);
  });

  it('lets a mirrored manager edit without applying the minimal-view gate', async () => {
    await seedCampaign({
      shareCharacterSheets: false,
      allowGmCharacterEditing: true,
      viewerRole: 'manager',
    });
    const character = makeCharacter(CAMPAIGN_ID);
    const { result } = renderHook(() => useCharacterAccessLocal(character, OTHER_MEMBER_ID));

    await waitFor(() => expect(result.current.accessPending).toBe(false));
    expect(result.current.canWrite).toBe(true);
    expect(result.current.isMinimal).toBe(false);
  });

  it('never holds the gate for the owner, even before the campaigns query resolves', () => {
    const character = makeCharacter(CAMPAIGN_ID);
    const { result } = renderHook(() => useCharacterAccessLocal(character, OWNER_ID));

    // Owner status is derived purely from character.ownerId vs myId,
    // independent of the campaign row — must never be held up by a
    // cold/offline Dexie cache.
    expect(result.current.accessPending).toBe(false);
    expect(result.current.isOwner).toBe(true);
    expect(result.current.canWrite).toBe(true);
    expect(result.current.isMinimal).toBe(false);
  });

  it('never holds the gate when the character has no campaignId', () => {
    const character = makeCharacter(null);
    const { result } = renderHook(() => useCharacterAccessLocal(character, OTHER_MEMBER_ID));

    expect(result.current.accessPending).toBe(false);
    expect(result.current.isMinimal).toBe(false);
  });
});
