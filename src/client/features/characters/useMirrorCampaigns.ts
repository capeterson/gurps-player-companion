/**
 * Mirrors fetched campaign rows into Dexie.
 *
 * Campaigns are pulled read-only through the sync cursor and refreshed
 * from `/campaigns` for the character picker. Both paths must retain the
 * complete campaign mechanics projection in Dexie: replacing a cursor row
 * with a partial REST mirror makes known settings look unavailable offline.
 *
 * Campaigns have no outbox mutations, so a plain upsert can't clobber
 * pending local intent (rule S4): there's never a pending patch on a
 * campaign field to skip.
 */

import { useEffect } from 'react';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { readUserIdFromToken } from '../../lib/tokenStore.ts';

export function useMirrorCampaigns(campaigns: CampaignOut[] | undefined): void {
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
          houseRules: c.houseRules,
          techLevel: c.techLevel,
          enforceAttributeCaps: c.enforceAttributeCaps,
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
