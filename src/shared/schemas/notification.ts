import { z } from 'zod';
import { isoTimestamp, uuid } from './common.ts';

/**
 * Discriminator constants for `notification.type`.  The payload shape is
 * owned by whoever emits the row, but the well-known types are listed
 * here so the front-end can exhaustively branch on them.
 */
export const NOTIFICATION_TYPE_CAMPAIGN_INVITATION = 'campaign_invitation';

/**
 * Payload schema for `type === 'campaign_invitation'` rows in the
 * `notifications.payload` jsonb column.  Keys are snake_case because
 * that's what the existing rows in production carry (the column
 * predates this schema); do not rename without a data migration.
 *
 * Emitted by the invitations router when an invite is created;
 * consumed by the NotificationsBell dropdown.  `related_id` on the row
 * (not in the payload) carries the invitation id for accept/reject.
 */
export const campaignInvitationNotificationPayload = z.object({
  campaign_id: uuid,
  campaign_name: z.string().min(1).max(120),
  inviter_id: uuid,
  inviter_display_name: z.string().min(1).max(80),
  role: z.enum(['member', 'manager']),
});

export const notificationOut = z.object({
  id: uuid,
  userId: uuid,
  type: z.string(),
  /**
   * Shape depends on `type`; parse with the per-type payload schema
   * above (e.g. `campaignInvitationNotificationPayload.safeParse`).
   * Kept loose here so unknown/legacy notification types still list.
   */
  payload: z.record(z.string(), z.unknown()),
  relatedId: uuid.nullable(),
  readAt: isoTimestamp.nullable(),
  createdAt: isoTimestamp,
  actionable: z.boolean().optional(),
});

export type NotificationOut = z.infer<typeof notificationOut>;
export type CampaignInvitationNotificationPayload = z.infer<
  typeof campaignInvitationNotificationPayload
>;

export const eventNotificationPayload = z.object({
  topic: z.enum([
    'invitations',
    'membership',
    'characterChanges',
    'points',
    'campaignChanges',
    'adventureLog',
    'libraryChanges',
  ]),
  title: z.string().min(1).max(300),
  message: z.string().min(1).max(1000),
  href: z
    .string()
    .max(300)
    .regex(/^\/(?:characters|campaigns)(?:\/[a-zA-Z0-9/-]+)?(?:#[a-zA-Z0-9-]+)?$/)
    .nullable(),
  actorId: uuid.nullable(),
  characterId: uuid.nullable(),
  campaignId: uuid.nullable(),
  changes: z.array(z.string().max(120)).max(30).default([]),
});
export type EventNotificationPayload = z.infer<typeof eventNotificationPayload>;

/** Durable mail payload, intentionally restricted to invitations and security. */
export const notificationEmailPayload = z
  .object({
    subject: z.string().min(1).max(300),
    message: z.string().min(1).max(1500),
  })
  .strict();
export type NotificationEmailPayload = z.infer<typeof notificationEmailPayload>;
