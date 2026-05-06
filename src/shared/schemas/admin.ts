import { z } from 'zod';
import { email } from './auth.ts';
import { campaignRole } from './campaign.ts';
import { isoTimestamp, uuid } from './common.ts';

export const adminUserSummary = z.object({
  id: uuid,
  email,
  displayName: z.string(),
  isSuperuser: z.boolean(),
  isActive: z.boolean(),
  suspendedAt: isoTimestamp.nullable(),
  purgeScheduledAt: isoTimestamp.nullable(),
  createdAt: isoTimestamp,
  characterCount: z.number().int().nonnegative(),
  campaignCount: z.number().int().nonnegative(),
});

export const adminCharacterRef = z.object({
  id: uuid,
  name: z.string(),
  campaignId: uuid.nullable(),
  createdAt: isoTimestamp,
});

export const adminCampaignRef = z.object({
  id: uuid,
  name: z.string(),
  role: campaignRole,
  createdAt: isoTimestamp,
});

export const adminUserDetail = adminUserSummary.extend({
  characters: z.array(adminCharacterRef),
  campaigns: z.array(adminCampaignRef),
});

export const adminUserList = z.object({
  items: z.array(adminUserSummary),
  total: z.number().int().nonnegative(),
});

export const adminCampaignSummary = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  ownerId: uuid,
  ownerDisplayName: z.string(),
  ownerEmail: email,
  memberCount: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative(),
  shareCharacterSheets: z.boolean(),
  createdAt: isoTimestamp,
});

export const adminCampaignMember = z.object({
  userId: uuid,
  displayName: z.string(),
  email,
  role: campaignRole,
  isActive: z.boolean(),
});

export const adminCampaignDetail = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  ownerId: uuid,
  ownerDisplayName: z.string(),
  ownerEmail: email,
  pointTarget: z.number().int().nullable(),
  disadvantageCap: z.number().int().nullable(),
  quirkCap: z.number().int().nullable(),
  shareCharacterSheets: z.boolean(),
  createdAt: isoTimestamp,
  members: z.array(adminCampaignMember),
  characters: z.array(adminCharacterRef),
});

export const adminCampaignList = z.object({
  items: z.array(adminCampaignSummary),
  total: z.number().int().nonnegative(),
});

export type AdminUserSummary = z.infer<typeof adminUserSummary>;
export type AdminUserDetail = z.infer<typeof adminUserDetail>;
export type AdminUserList = z.infer<typeof adminUserList>;
export type AdminCharacterRef = z.infer<typeof adminCharacterRef>;
export type AdminCampaignRef = z.infer<typeof adminCampaignRef>;
export type AdminCampaignSummary = z.infer<typeof adminCampaignSummary>;
export type AdminCampaignDetail = z.infer<typeof adminCampaignDetail>;
export type AdminCampaignMember = z.infer<typeof adminCampaignMember>;
export type AdminCampaignList = z.infer<typeof adminCampaignList>;
