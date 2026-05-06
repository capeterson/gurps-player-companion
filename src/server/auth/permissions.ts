/**
 * Authorization helpers used by route handlers.  Each helper runs a
 * targeted query and returns the entity (or throws an HTTPException
 * with the right status).  Centralizing these prevents inconsistent
 * permission checks across handlers.
 */

import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { getDb } from '../db/client.ts';
import {
  type DbCampaign,
  type DbCampaignMembership,
  type DbCharacter,
  campaignMemberships,
  campaigns,
  characters,
  users as usersTbl,
} from '../db/schema.ts';

export type CampaignRole = DbCampaignMembership['role'];

export async function loadCampaignOr403(
  campaignId: string,
  userId: string,
): Promise<{
  campaign: DbCampaign;
  role: CampaignRole;
}> {
  const db = getDb();
  const rows = await db
    .select({ campaign: campaigns, membership: campaignMemberships })
    .from(campaigns)
    .leftJoin(
      campaignMemberships,
      and(eq(campaignMemberships.campaignId, campaigns.id), eq(campaignMemberships.userId, userId)),
    )
    .where(eq(campaigns.id, campaignId));
  const row = rows[0];
  if (!row) throw new HTTPException(404, { message: 'campaign not found' });
  if (row.campaign.ownerId === userId) {
    return { campaign: row.campaign, role: 'owner' };
  }
  if (!row.membership) throw new HTTPException(403, { message: 'forbidden' });
  return { campaign: row.campaign, role: row.membership.role };
}

export async function requireSuperuser(userId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ isSuperuser: usersTbl.isSuperuser })
    .from(usersTbl)
    .where(eq(usersTbl.id, userId));
  if (!rows[0] || !rows[0].isSuperuser) {
    throw new HTTPException(403, { message: 'superuser required' });
  }
}

export async function requireCampaignOwner(
  campaignId: string,
  userId: string,
): Promise<DbCampaign> {
  const { campaign, role } = await loadCampaignOr403(campaignId, userId);
  if (role !== 'owner') throw new HTTPException(403, { message: 'owner required' });
  return campaign;
}

/**
 * Either an owner or a manager — used by the invitations API where
 * managers can invite members but only the owner can promote to manager.
 */
export async function requireCampaignAdmin(
  campaignId: string,
  userId: string,
): Promise<{ campaign: DbCampaign; role: CampaignRole }> {
  const result = await loadCampaignOr403(campaignId, userId);
  if (result.role !== 'owner' && result.role !== 'manager') {
    throw new HTTPException(403, { message: 'owner or manager required' });
  }
  return result;
}

export async function requireCampaignMember(
  campaignId: string,
  userId: string,
): Promise<{ campaign: DbCampaign; role: CampaignRole }> {
  return loadCampaignOr403(campaignId, userId);
}

export interface CharacterAccess {
  readonly character: DbCharacter;
  readonly canWrite: boolean;
}

/**
 * Load a character if the user can read it.  `canWrite` is true if the
 * user is the owner; campaign members can read but not write.
 */
export async function loadCharacterOr403(
  characterId: string,
  userId: string,
): Promise<CharacterAccess> {
  const db = getDb();
  const rows = await db.select().from(characters).where(eq(characters.id, characterId));
  const character = rows[0];
  if (!character) throw new HTTPException(404, { message: 'character not found' });
  if (character.ownerId === userId) return { character, canWrite: true };
  if (character.campaignId) {
    const memberships = await db
      .select()
      .from(campaignMemberships)
      .where(
        and(
          eq(campaignMemberships.campaignId, character.campaignId),
          eq(campaignMemberships.userId, userId),
        ),
      );
    if (memberships[0]) return { character, canWrite: false };
  }
  throw new HTTPException(403, { message: 'forbidden' });
}

export function assertWrite(access: CharacterAccess): asserts access is CharacterAccess & {
  canWrite: true;
} {
  if (!access.canWrite) throw new HTTPException(403, { message: 'owner only' });
}
