/**
 * Drizzle schema for Postgres 18.  All ids default to uuidv7() (server side)
 * so they're time-ordered.  All syncable rows carry a `revision` column the
 * server bumps on write — clients use it for the sync cursor.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ---------- enums ----------
// We let Postgres enforce these at the column level via CHECK / ENUM.
// For client-side use, the canonical sources are
// src/shared/constants/* (combat, skills, traits, hitLocations).

export const traitKindEnum = pgEnum('trait_kind', [
  'advantage',
  'disadvantage',
  'perk',
  'quirk',
  'language',
  'cultural_familiarity',
]);

export const skillAttributeEnum = pgEnum('skill_attribute', [
  'ST',
  'DX',
  'IQ',
  'HT',
  'Will',
  'Per',
  'Other',
]);

export const skillDifficultyEnum = pgEnum('skill_difficulty', ['E', 'A', 'H', 'VH']);

export const postureEnum = pgEnum('posture', [
  'standing',
  'prone',
  'kneeling',
  'crawling',
  'sitting',
  'crouching',
  'lying',
]);

export const visibilityEnum = pgEnum('log_visibility', ['campaign', 'private']);

export const campaignRoleEnum = pgEnum('campaign_role', ['owner', 'member', 'manager']);

export const campaignInvitationStatusEnum = pgEnum('campaign_invitation_status', [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
]);

// ---------- columns helpers ----------

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const revision = () => bigserial('revision', { mode: 'number' }).notNull();

// ---------- users / auth ----------

export const users = pgTable(
  'users',
  {
    id: id(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: varchar('display_name', { length: 80 }).notNull(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    /**
     * Instance-admin gate.  Set ONLY by direct DB edit; the admin router
     * is the only consumer.  Never exposed via the public auth/me payload.
     */
    isSuperuser: boolean('is_superuser').notNull().default(false),
    /**
     * 30-day soft-delete timer set by /admin/users/{id}/purge.  A future
     * sweep job hard-deletes users whose timer has elapsed; for now the
     * column itself is the contract.
     */
    purgeScheduledAt: timestamp('purge_scheduled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    emailKey: uniqueIndex('users_email_key').on(t.email),
    purgeIdx: index('users_purge_scheduled_at_idx').on(t.purgeScheduledAt),
  }),
);

export const passkeyCredentials = pgTable(
  'passkey_credentials',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull(),
    publicKey: text('public_key').notNull(),
    signCount: integer('sign_count').notNull().default(0),
    name: varchar('name', { length: 80 }).notNull().default('Passkey'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    credentialIdKey: uniqueIndex('passkey_credentials_credential_id_key').on(t.credentialId),
    userIdx: index('passkey_credentials_user_idx').on(t.userId),
  }),
);

export const passkeyChallenges = pgTable(
  'passkey_challenges',
  {
    id: id(),
    challengeHash: varchar('challenge_hash', { length: 64 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 32 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    challengeHashKey: uniqueIndex('passkey_challenges_hash_key').on(t.challengeHash),
    expiresAtIdx: index('passkey_challenges_expires_at_idx').on(t.expiresAt),
  }),
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jti: varchar('jti', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
    /** PG18 virtual generated column — handy for query filters. */
    isActive: boolean('is_active').generatedAlwaysAs(sql`(revoked_at is null)`),
  },
  (t) => ({
    jtiKey: uniqueIndex('refresh_tokens_jti_key').on(t.jti),
    userIdx: index('refresh_tokens_user_idx').on(t.userId),
  }),
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    tokenHashKey: uniqueIndex('password_reset_tokens_hash_key').on(t.tokenHash),
    userIdx: index('password_reset_tokens_user_idx').on(t.userId),
  }),
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    isActive: boolean('is_active').generatedAlwaysAs(sql`(revoked_at is null)`),
  },
  (t) => ({
    keyHashKey: uniqueIndex('api_keys_key_hash_key').on(t.keyHash),
    userIdx: index('api_keys_user_idx').on(t.userId),
  }),
);

// ---------- campaigns ----------

export const campaigns = pgTable('campaigns', {
  id: id(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  pointTarget: integer('point_target'),
  disadvantageCap: integer('disadvantage_cap'),
  quirkCap: integer('quirk_cap').default(5),
  /**
   * When false, non-owner members fetching `/characters/{id}` get the
   * minimal "readily apparent" view (race / height / weight / age /
   * appearance / TL) instead of the full sheet. Owner and the author
   * always see the full sheet.  Defaults to true so existing campaigns
   * keep their previous behaviour.
   */
  shareCharacterSheets: boolean('share_character_sheets').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  revision: revision(),
});

export const campaignMemberships = pgTable(
  'campaign_memberships',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: campaignRoleEnum('role').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    membershipKey: uniqueIndex('campaign_memberships_campaign_user_key').on(t.campaignId, t.userId),
  }),
);

// Generic per-user notifications. The discriminator is `type`; the payload
// shape is owned by whoever emits the row.  See NOTIFICATION_TYPES below
// for the values currently in use.
export const NOTIFICATION_TYPE_CAMPAIGN_INVITATION = 'campaign_invitation' as const;

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    relatedId: uuid('related_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    userIdx: index('notifications_user_idx').on(t.userId),
    relatedIdx: index('notifications_related_idx').on(t.relatedId),
    readIdx: index('notifications_read_idx').on(t.readAt),
  }),
);

export const campaignInvitations = pgTable(
  'campaign_invitations',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteeId: uuid('invitee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: campaignRoleEnum('role').notNull(),
    status: campaignInvitationStatusEnum('status').notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    campaignIdx: index('campaign_invitations_campaign_idx').on(t.campaignId),
    inviteeIdx: index('campaign_invitations_invitee_idx').on(t.inviteeId),
    statusIdx: index('campaign_invitations_status_idx').on(t.status),
  }),
);

// ---------- characters ----------

export const characters = pgTable(
  'characters',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),

    name: varchar('name', { length: 120 }).notNull(),
    playerName: varchar('player_name', { length: 120 }),
    height: varchar('height', { length: 40 }),
    weight: varchar('weight', { length: 40 }),
    age: integer('age'),
    appearance: text('appearance'),
    techLevel: smallint('tech_level'),

    st: smallint('st').notNull().default(10),
    dx: smallint('dx').notNull().default(10),
    iq: smallint('iq').notNull().default(10),
    ht: smallint('ht').notNull().default(10),

    hpMod: smallint('hp_mod').notNull().default(0),
    willMod: smallint('will_mod').notNull().default(0),
    perMod: smallint('per_mod').notNull().default(0),
    fpMod: smallint('fp_mod').notNull().default(0),
    speedQuarterMod: smallint('speed_quarter_mod').notNull().default(0),
    moveMod: smallint('move_mod').notNull().default(0),

    tempSt: smallint('temp_st').notNull().default(0),
    tempDx: smallint('temp_dx').notNull().default(0),
    tempIq: smallint('temp_iq').notNull().default(0),
    tempHt: smallint('temp_ht').notNull().default(0),
    tempHpMod: smallint('temp_hp_mod').notNull().default(0),
    tempWillMod: smallint('temp_will_mod').notNull().default(0),
    tempPerMod: smallint('temp_per_mod').notNull().default(0),
    tempFpMod: smallint('temp_fp_mod').notNull().default(0),
    tempSpeedQuarterMod: smallint('temp_speed_quarter_mod').notNull().default(0),
    tempMoveMod: smallint('temp_move_mod').notNull().default(0),

    dismissedWarnings: jsonb('dismissed_warnings').$type<string[]>().notNull().default([]),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    ownerIdx: index('characters_owner_idx').on(t.ownerId),
    campaignIdx: index('characters_campaign_idx').on(t.campaignId),
  }),
);

// ---------- character traits / skills / inventory / combat ----------

export const characterTraits = pgTable(
  'character_traits',
  {
    id: id(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    kind: traitKindEnum('kind').notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    points: integer('points').notNull().default(0),
    level: smallint('level'),
    notes: text('notes'),
    modifiers: jsonb('modifiers').$type<unknown[]>().notNull().default([]),
    libraryTraitId: uuid('library_trait_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    characterIdx: index('character_traits_character_idx').on(t.characterId),
  }),
);

export const characterSkills = pgTable(
  'character_skills',
  {
    id: id(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    attribute: skillAttributeEnum('attribute').notNull(),
    difficulty: skillDifficultyEnum('difficulty').notNull(),
    points: integer('points').notNull().default(1),
    techLevel: smallint('tech_level'),
    specialization: varchar('specialization', { length: 160 }),
    notes: text('notes'),
    librarySkillId: uuid('library_skill_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    characterIdx: index('character_skills_character_idx').on(t.characterId),
  }),
);

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: id(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    weightLbs: numeric('weight_lbs', { precision: 10, scale: 2 }).notNull().default('0'),
    cost: numeric('cost', { precision: 14, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    /** Self-references inventory_items.id; FK added by migration (see 0001). */
    parentId: uuid('parent_id'),
    externalLocation: varchar('external_location', { length: 160 }),
    worn: boolean('worn').notNull().default(false),
    equipped: boolean('equipped').notNull().default(false),
    isContainer: boolean('is_container').notNull().default(false),
    hideawayCapacityLbs: numeric('hideaway_capacity_lbs', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    weightReductionPercent: smallint('weight_reduction_percent').notNull().default(0),
    isArmor: boolean('is_armor').notNull().default(false),
    armor: jsonb('armor'),
    weaponData: jsonb('weapon_data'),
    /** Powerstone metadata (max/current charge).  Null = not a powerstone. */
    powerstoneData: jsonb('powerstone_data'),
    /** Magic-item metadata (linked spell, charges, mode).  Null = mundane item. */
    magicItemData: jsonb('magic_item_data'),
    libraryItemId: uuid('library_item_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    characterIdx: index('inventory_items_character_idx').on(t.characterId),
    parentIdx: index('inventory_items_parent_idx').on(t.parentId),
  }),
);

/**
 * Spells the character knows.  Mechanically a spell is an IQ/Hard skill,
 * but tracking it in its own table keeps spell-specific fields (college,
 * energy cost, casting time) out of the regular skill row and lets the
 * client surface a Magic panel without filtering.
 *
 * Effective skill level adds the caster's Magery level on top of the
 * usual IQ/H formula -- see `src/shared/domain/spellCalc.ts`.
 */
export const characterSpells = pgTable(
  'character_spells',
  {
    id: id(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    college: varchar('college', { length: 80 }),
    points: integer('points').notNull().default(1),
    baseEnergyCost: smallint('base_energy_cost').notNull().default(1),
    maintenanceCost: smallint('maintenance_cost'),
    castingTime: varchar('casting_time', { length: 40 }),
    duration: varchar('duration', { length: 40 }),
    prerequisites: text('prerequisites'),
    notes: text('notes'),
    librarySpellId: uuid('library_spell_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    characterIdx: index('character_spells_character_idx').on(t.characterId),
  }),
);

export const combatStates = pgTable(
  'combat_states',
  {
    id: id(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    currentHp: integer('current_hp').notNull().default(10),
    currentFp: integer('current_fp').notNull().default(10),
    conditions: jsonb('conditions').$type<string[]>().notNull().default([]),
    maneuver: varchar('maneuver', { length: 80 }),
    posture: postureEnum('posture').notNull().default('standing'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    characterKey: uniqueIndex('combat_states_character_key').on(t.characterId),
  }),
);

// ---------- adventure log ----------

export const adventureLogEntries = pgTable(
  'adventure_log_entries',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionDate: date('session_date').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull().default(''),
    visibility: visibilityEnum('visibility').notNull().default('campaign'),
    xpAwards: jsonb('xp_awards')
      .$type<Array<{ characterId: string; amount: number }>>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    campaignIdx: index('adventure_log_campaign_idx').on(t.campaignId),
    authorIdx: index('adventure_log_author_idx').on(t.authorId),
  }),
);

// ---------- campaign library ----------

export const campaignLibraryTraits = pgTable(
  'campaign_library_traits',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    kind: traitKindEnum('kind').notNull(),
    basePoints: integer('base_points').notNull().default(0),
    description: text('description'),
    source: varchar('source', { length: 40 }),
    availableModifiers: jsonb('available_modifiers').$type<unknown[]>().notNull().default([]),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    naturalKey: uniqueIndex('campaign_library_traits_key').on(t.campaignId, t.name, t.kind),
  }),
);

export const campaignLibrarySkills = pgTable(
  'campaign_library_skills',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    attribute: skillAttributeEnum('attribute').notNull(),
    difficulty: skillDifficultyEnum('difficulty').notNull(),
    techLevel: smallint('tech_level'),
    description: text('description'),
    source: varchar('source', { length: 40 }),
    defaultSpecialization: varchar('default_specialization', { length: 160 }),
    prerequisites: text('prerequisites'),
    situationalModifiers: jsonb('situational_modifiers').$type<unknown[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    naturalKey: uniqueIndex('campaign_library_skills_key').on(t.campaignId, t.name),
  }),
);

export const campaignLibraryItems = pgTable(
  'campaign_library_items',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    category: varchar('category', { length: 40 }).notNull().default('general'),
    defaultQuantity: integer('default_quantity').notNull().default(1),
    weightLbs: numeric('weight_lbs', { precision: 10, scale: 2 }).notNull().default('0'),
    cost: numeric('cost', { precision: 14, scale: 2 }).notNull().default('0'),
    description: text('description'),
    source: varchar('source', { length: 40 }),
    isArmor: boolean('is_armor').notNull().default(false),
    armor: jsonb('armor'),
    weaponData: jsonb('weapon_data'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => ({
    naturalKey: uniqueIndex('campaign_library_items_key').on(t.campaignId, t.name),
  }),
);

// Convenience type aliases for use in services.
export type DbUser = typeof users.$inferSelect;
export type DbCharacter = typeof characters.$inferSelect;
export type DbCharacterTrait = typeof characterTraits.$inferSelect;
export type DbCharacterSkill = typeof characterSkills.$inferSelect;
export type DbCharacterSpell = typeof characterSpells.$inferSelect;
export type DbInventoryItem = typeof inventoryItems.$inferSelect;
export type DbCombatState = typeof combatStates.$inferSelect;
export type DbCampaign = typeof campaigns.$inferSelect;
export type DbCampaignMembership = typeof campaignMemberships.$inferSelect;
export type DbCampaignInvitation = typeof campaignInvitations.$inferSelect;
export type DbNotification = typeof notifications.$inferSelect;
export type DbAdventureLogEntry = typeof adventureLogEntries.$inferSelect;
export type DbCampaignLibraryTrait = typeof campaignLibraryTraits.$inferSelect;
export type DbCampaignLibrarySkill = typeof campaignLibrarySkills.$inferSelect;
export type DbCampaignLibraryItem = typeof campaignLibraryItems.$inferSelect;
export type DbApiKey = typeof apiKeys.$inferSelect;
export type DbRefreshToken = typeof refreshTokens.$inferSelect;
export type DbPasswordResetToken = typeof passwordResetTokens.$inferSelect;

// Use the bigserial as our `revision` (auto-incremented per-row insert)
// rather than per-table.  For multi-table sync, clients track a cursor
// per entity-class, sorted by row id and revision.
// Drizzle warns to keep `bigserial` to avoid a separate sequence; we lean
// on the global sequence to give monotonic ordering across all tables.
export const _ensureBigserial = bigserial;

// ---------- sync tombstones ----------
//
// Records every delete on a syncable table so /sync/cursor can return
// the deletions to clients.  Populated by AFTER DELETE triggers (see
// migration 0004_shared_revision_sequence.sql).  `revision` uses the
// shared `revisions_seq` so it interleaves with live-row revisions in
// the same monotonic per-class order clients consume.

export const entityTombstones = pgTable(
  'entity_tombstones',
  {
    entityClass: text('entity_class').notNull(),
    entityId: uuid('entity_id').notNull(),
    ownerUserId: uuid('owner_user_id').notNull(),
    campaignId: uuid('campaign_id'),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.entityClass, t.entityId] }),
    ownerRevisionIdx: index('entity_tombstones_owner_revision_idx').on(t.ownerUserId, t.revision),
    campaignRevisionIdx: index('entity_tombstones_campaign_revision_idx').on(
      t.campaignId,
      t.revision,
    ),
  }),
);

export type DbEntityTombstone = typeof entityTombstones.$inferSelect;

// ---------- entity history ----------
//
// Append-only audit log for every syncable entity.  Populated by AFTER
// INSERT/UPDATE/DELETE triggers (see migration 0013_entity_history.sql).
// actor_user_id and batch_id come from transaction-local session settings
// set by withAudit() in src/server/db/auditContext.ts.

export const entityHistory = pgTable(
  'entity_history',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    scope: text('scope').notNull(),
    entityClass: text('entity_class').notNull(),
    entityId: uuid('entity_id').notNull(),
    op: text('op').notNull(),
    characterId: uuid('character_id'),
    campaignId: uuid('campaign_id'),
    ownerUserId: uuid('owner_user_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    batchId: uuid('batch_id'),
    oldRow: jsonb('old_row'),
    newRow: jsonb('new_row'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    characterRevisionIdx: index('entity_history_character_revision_idx').on(
      t.characterId,
      t.revision,
    ),
    campaignScopeRevisionIdx: index('entity_history_campaign_scope_revision_idx').on(
      t.campaignId,
      t.scope,
      t.revision,
    ),
    ownerRevisionIdx: index('entity_history_owner_revision_idx').on(t.ownerUserId, t.revision),
    batchIdx: index('entity_history_batch_idx').on(t.batchId),
  }),
);

export type DbEntityHistory = typeof entityHistory.$inferSelect;
