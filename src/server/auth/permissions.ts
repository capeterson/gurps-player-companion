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

interface CampaignRoleLookup {
  readonly campaign: DbCampaign;
  /** `null` means "campaign exists but `userId` has no role on it." */
  readonly role: CampaignRole | null;
}

/** Shared query behind both `loadCampaignOr403` and `tryLoadCampaignRole`. */
async function lookupCampaignRole(
  campaignId: string,
  userId: string,
): Promise<CampaignRoleLookup | null> {
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
  if (!row) return null;
  const role: CampaignRole | null =
    row.campaign.ownerId === userId ? 'owner' : (row.membership?.role ?? null);
  return { campaign: row.campaign, role };
}

export async function loadCampaignOr403(
  campaignId: string,
  userId: string,
): Promise<{
  campaign: DbCampaign;
  role: CampaignRole;
}> {
  const result = await lookupCampaignRole(campaignId, userId);
  if (!result) throw new HTTPException(404, { message: 'campaign not found' });
  if (result.role === null) throw new HTTPException(403, { message: 'forbidden' });
  return { campaign: result.campaign, role: result.role };
}

/**
 * Non-throwing role lookup: `null` covers both "campaign doesn't exist"
 * and "`userId` has no role on it" — for callers that only need to
 * know membership status (e.g. "is this invitee already a member?")
 * rather than distinguish 404-vs-403, so they don't need to wrap
 * `loadCampaignOr403` in a try/catch just to get a boolean-ish answer.
 */
export async function tryLoadCampaignRole(
  campaignId: string,
  userId: string,
): Promise<CampaignRole | null> {
  const result = await lookupCampaignRole(campaignId, userId);
  return result?.role ?? null;
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
 * user is the owner, or campaign staff editing is enabled for an
 * owner/manager. Other campaign members can read but not write.
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
    const access = await lookupCampaignRole(character.campaignId, userId);
    if (access?.role) {
      const isStaff = access.role === 'owner' || access.role === 'manager';
      return {
        character,
        canWrite: access.campaign.allowGmCharacterEditing && isStaff,
      };
    }
  }
  throw new HTTPException(403, { message: 'forbidden' });
}

export function assertWrite(access: CharacterAccess): asserts access is CharacterAccess & {
  canWrite: true;
} {
  if (!access.canWrite) throw new HTTPException(403, { message: 'character editing not allowed' });
}
