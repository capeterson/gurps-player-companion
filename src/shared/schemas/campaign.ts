import { z } from 'zod';
import { MANA_LEVELS } from '../constants/magic.ts';
import { email } from './auth.ts';
import { isoTimestamp, revision, uuid } from './common.ts';

export const campaignName = z.string().min(1).max(120).trim();
export const campaignDescription = z.string().max(20_000).nullable();

export const campaignRole = z.enum(['owner', 'member', 'manager']);
export type CampaignRole = z.infer<typeof campaignRole>;

export const campaignInvitationStatus = z.enum(['pending', 'accepted', 'rejected', 'cancelled']);
export type CampaignInvitationStatus = z.infer<typeof campaignInvitationStatus>;

export const campaignMemberOut = z.object({
  userId: uuid,
  email,
  displayName: z.string(),
  role: campaignRole,
});

export const campaignOut = z.object({
  id: uuid,
  name: campaignName,
  description: campaignDescription,
  ownerId: uuid,
  pointTarget: z.number().int().nullable(),
  disadvantageCap: z.number().int().nullable(),
  quirkCap: z.number().int().nullable(),
  /** Ambient mana level for the whole campaign (Basic Set p. 235). */
  manaLevel: z.enum(MANA_LEVELS).default('normal'),
  /**
   * When false, non-owner members get the minimal "readily apparent"
   * view of other players' character sheets instead of the full
   * sheet. Owners and the character's author always see the full
   * sheet regardless.
   */
  shareCharacterSheets: z.boolean(),
  members: z.array(campaignMemberOut),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  revision,
});

export const campaignCreate = z.object({
  name: campaignName,
  description: campaignDescription.optional(),
  pointTarget: z.number().int().min(0).max(10_000).nullable().optional(),
  disadvantageCap: z.number().int().min(0).max(10_000).nullable().optional(),
  quirkCap: z.number().int().min(0).max(50).nullable().optional(),
  manaLevel: z.enum(MANA_LEVELS).optional(),
  shareCharacterSheets: z.boolean().optional(),
});

export const campaignUpdate = campaignCreate.partial();

export const addMemberRequest = z.object({
  email,
});

export const transferOwnershipRequest = z.object({
  newOwnerId: uuid,
});

// Promote/demote between member ↔ manager. Owner transitions go through
// transfer-ownership instead, so this enum deliberately omits 'owner'.
export const setMemberRoleRequest = z.object({
  role: z.enum(['member', 'manager']),
});

// Invite handle: an email address OR a display-name match. The server
// resolves it via the same case-insensitive lookup gurps-player-web
// uses (email exact-match first, then displayName exact-match).
export const inviteRequest = z.object({
  handle: z.string().min(1).max(255).trim(),
  /** Defaults to 'member'. Only owners may invite at the manager tier. */
  role: campaignRole.optional(),
});

export const invitationOut = z.object({
  id: uuid,
  campaignId: uuid,
  campaignName: z.string(),
  inviterId: uuid,
  inviterDisplayName: z.string(),
  inviteeId: uuid,
  inviteeDisplayName: z.string(),
  inviteeEmail: email,
  role: campaignRole,
  status: campaignInvitationStatus,
  createdAt: isoTimestamp,
  decidedAt: isoTimestamp.nullable(),
});

export type CampaignOut = z.infer<typeof campaignOut>;
export type CampaignCreate = z.infer<typeof campaignCreate>;
export type CampaignUpdate = z.infer<typeof campaignUpdate>;
export type AddMemberRequest = z.infer<typeof addMemberRequest>;
export type TransferOwnershipRequest = z.infer<typeof transferOwnershipRequest>;
export type SetMemberRoleRequest = z.infer<typeof setMemberRoleRequest>;
export type CampaignMemberOut = z.infer<typeof campaignMemberOut>;
export type InviteRequest = z.infer<typeof inviteRequest>;
export type InvitationOut = z.infer<typeof invitationOut>;
