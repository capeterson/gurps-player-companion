/**
 * Mirrors fetched campaign rows into Dexie.
 *
 * The sync cursor only pulls the character-family entity classes
 * (`ALL_ENTITY_CLASSES`); campaigns are read-only and have no outbox
 * path, so this `/campaigns` fetch is the only route campaign rows
 * have into the local store. The character sheet reads it (the Combat
 * tab's Skills card needs the campaign's mana level), and the sheet is
 * the sole surface; this fetch is how a sheet opened offline-first on
 * a cold cache still resolves the share gate and mana level (S0 —
 * campaigns are pulled read-only via sync, no outbox path).
 *
 * Campaigns have no outbox mutations, so a plain upsert can't clobber
 * pending local intent (rule S4): there's never a pending patch on a
 * campaign field to skip.
 */

import { useEffect } from 'react';
import { getLocalDb } from '../../db/dexie.ts';
import { readUserIdFromToken } from '../../lib/tokenStore.ts';
import type { CampaignSummary } from './useCharacterAccess.ts';

export function useMirrorCampaigns(campaigns: CampaignSummary[] | undefined): void {
  useEffect(() => {
    if (!campaigns || campaigns.length === 0) return;
    const db = getLocalDb();
    const viewerId = readUserIdFromToken();
    void db.campaigns.bulkPut(
      campaigns.map((c) => {
        const memberRole = c.members?.find((member) => member.userId === viewerId)?.role;
        return {
          id: c.id,
          name: c.name,
          description: c.description,
          ownerId: c.ownerId,
          pointTarget: c.pointTarget,
          disadvantageCap: c.disadvantageCap,
          quirkCap: c.quirkCap,
          manaLevel: c.manaLevel,
          shareCharacterSheets: c.shareCharacterSheets,
          allowGmCharacterEditing: c.allowGmCharacterEditing,
          ...(c.ownerId === viewerId
            ? { viewerRole: 'owner' as const }
            : memberRole
              ? { viewerRole: memberRole }
              : {}),
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          revision: c.revision,
        };
      }),
    );
  }, [campaigns]);
}
