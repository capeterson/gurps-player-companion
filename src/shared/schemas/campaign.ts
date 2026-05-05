import { z } from 'zod';
import { email } from './auth.ts';
import { isoTimestamp, revision, uuid } from './common.ts';

export const campaignName = z.string().min(1).max(120).trim();
export const campaignDescription = z.string().max(20_000).nullable();

export const campaignRole = z.enum(['owner', 'member']);
export type CampaignRole = z.infer<typeof campaignRole>;

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
  shareCharacterSheets: z.boolean().optional(),
});

export const campaignUpdate = campaignCreate.partial();

export const addMemberRequest = z.object({
  email,
});

export const transferOwnershipRequest = z.object({
  newOwnerId: uuid,
});

export type CampaignOut = z.infer<typeof campaignOut>;
export type CampaignCreate = z.infer<typeof campaignCreate>;
export type CampaignUpdate = z.infer<typeof campaignUpdate>;
export type AddMemberRequest = z.infer<typeof addMemberRequest>;
export type TransferOwnershipRequest = z.infer<typeof transferOwnershipRequest>;
export type CampaignMemberOut = z.infer<typeof campaignMemberOut>;
