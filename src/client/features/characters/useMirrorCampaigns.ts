/**
 * Mirrors fetched campaign rows into Dexie.
 *
 * Campaigns are pulled read-only through the sync cursor and refreshed
 * from `/campaigns` for the character picker. Both paths must retain the
 * complete campaign mechanics projection in Dexie: replacing a cursor row
 * with a partial REST mirror makes known settings look unavailable offline.
 *
 * Cover images are outbox-backed. Preserve pending cover intent and ignore
 * responses older than the local cursor revision.
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
    void db.transaction('rw', [db.campaigns, db.outbox], async () => {
      if (readUserIdFromToken() !== viewerId) return;
      const pending = await db.outbox
        .where('status')
        .anyOf(['pending', 'in_flight', 'transient_retry'])
        .toArray();
      const stored = await db.campaigns.bulkGet(campaigns.map((c) => c.id));
      await db.campaigns.bulkPut(
        campaigns.map((c, index) => {
          const existing = stored[index];
          if (existing && existing.revision > c.revision) return existing;
          const memberRole = c.members?.find((member) => member.userId === viewerId)?.role;
          return {
            ...(stored[index]?.activeEffectDefinitions
              ? { activeEffectDefinitions: stored[index].activeEffectDefinitions }
              : {}),
            coverAssetId: pending.some(
              (op) =>
                op.entityClass === 'campaign' &&
                op.entityId === c.id &&
                op.fieldPath === 'coverAssetId',
            )
              ? (existing?.coverAssetId ?? null)
              : (c.coverAssetId ?? null),
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
            skillPrerequisitePolicy: c.skillPrerequisitePolicy ?? 'block',
            experimentalTurnTracker: c.experimentalTurnTracker,
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
    });
  }, [campaigns]);
}
