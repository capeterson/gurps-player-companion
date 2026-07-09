/**
 * Mirrors fetched campaign rows into Dexie.
 *
 * The sync cursor only pulls the character-family entity classes
 * (`ALL_ENTITY_CLASSES`); campaigns are read-only and have no outbox
 * path, so this `/campaigns` fetch is the only route campaign rows
 * have into the local store. Both the character sheet and Play Mode
 * need it — whichever one a session opens first should still populate
 * Dexie so the other reads a warm cache offline.
 *
 * Campaigns have no outbox mutations, so a plain upsert can't clobber
 * pending local intent (rule S4): there's never a pending patch on a
 * campaign field to skip.
 */

import { useEffect } from 'react';
import { getLocalDb } from '../../db/dexie.ts';
import type { CampaignSummary } from './useCharacterAccess.ts';

export function useMirrorCampaigns(campaigns: CampaignSummary[] | undefined): void {
  useEffect(() => {
    if (!campaigns || campaigns.length === 0) return;
    const db = getLocalDb();
    void db.campaigns.bulkPut(
      campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        ownerId: c.ownerId,
        pointTarget: c.pointTarget,
        disadvantageCap: c.disadvantageCap,
        quirkCap: c.quirkCap,
        manaLevel: c.manaLevel,
        shareCharacterSheets: c.shareCharacterSheets,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        revision: c.revision,
      })),
    );
  }, [campaigns]);
}
