import { z } from 'zod';
import { MANA_LEVELS } from '../constants/magic.ts';
import { email } from './auth.ts';
import { isoTimestamp, revision, timestamps, uuid } from './common.ts';

export const houseRuleSet = z.enum(['none', 'j_talisar', 'custom']);
export type HouseRuleSet = z.infer<typeof houseRuleSet>;

/**
 * Campaign house rules. Omitted legacy settings use the campaign defaults.
 * `ruleSet` is stored independently from the values so a GM can choose
 * Custom without destroying the named preset they intend to edit.
 */
export const campaignHouseRules = z
  .object({
    ruleSet: houseRuleSet.default('custom'),
    protectNaturalDr: z.boolean().default(true),
    enchantedItemPricing: z.boolean().default(false),
    eyeMissHitsFace: z.boolean().default(false),
    requireMagicAdvancementRites: z.boolean().default(false),
    mediumMaterialSpiritLimits: z.boolean().default(false),
    shieldDamageOnDbBlock: z.boolean().default(false),
    braverySpellRewrite: z.boolean().default(false),
    highestDeflectOnly: z.boolean().default(false),
    highestFortifyOnly: z.boolean().default(false),
    forbidDistantBlow: z.boolean().default(false),
    forbidAcidMagic: z.boolean().default(false),
    requireSpellIngredients: z.boolean().default(false),
    hideThoughtsInterpretation: z.boolean().default(false),
    sunboltBurningDamage: z.boolean().default(false),
    pathAdeptLocksSubject: z.boolean().default(false),
    curseRitualExpandedTargets: z.boolean().default(false),
    dispelRitualCrossTradition: z.boolean().default(false),
    mysticSymbolsAsAdvantages: z.boolean().default(false),
    pathCharmsSingleUse: z.boolean().default(false),
    shieldReadyTimeByDb: z.boolean().default(false),
    allowJtSupplementalPerks: z.boolean().default(false),
  })
  .strict();
export type CampaignHouseRules = z.infer<typeof campaignHouseRules>;

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
  /** Tech level for the whole campaign (Basic Set p. 513). */
  techLevel: z.number().int().min(0).max(12).nullable(),
  /** Enforce the purchased-attribute limits from Basic Set pp. B14-B16. */
  enforceAttributeCaps: z.boolean(),
  /**
   * When false, non-owner members get the minimal "readily apparent"
   * view of other players' character sheets instead of the full
   * sheet. Owners and the character's author always see the full
   * sheet regardless.
   */
  shareCharacterSheets: z.boolean(),
  /** Allow campaign owners and managers to edit member-owned characters. */
  allowGmCharacterEditing: z.boolean(),
  houseRules: campaignHouseRules.default({}),
  members: z.array(campaignMemberOut),
  ...timestamps,
  revision,
});

export const campaignCreate = z.object({
  name: campaignName,
  houseRules: campaignHouseRules.optional(),
  description: campaignDescription.optional(),
  pointTarget: z.number().int().min(0).max(10_000).nullable().optional(),
  disadvantageCap: z.number().int().min(0).max(10_000).nullable().optional(),
  quirkCap: z.number().int().min(0).max(50).nullable().optional(),
  manaLevel: z.enum(MANA_LEVELS).optional(),
  techLevel: z.number().int().min(0).max(12).nullable().optional(),
  enforceAttributeCaps: z.boolean().optional(),
  shareCharacterSheets: z.boolean().optional(),
  allowGmCharacterEditing: z.boolean().optional(),
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
