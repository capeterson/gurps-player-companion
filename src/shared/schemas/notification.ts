import { z } from 'zod';
import { isoTimestamp, uuid } from './common.ts';

/**
 * Discriminator constants for `notification.type`.  The payload shape is
 * owned by whoever emits the row, but the well-known types are listed
 * here so the front-end can exhaustively branch on them.
 */
export const NOTIFICATION_TYPE_CAMPAIGN_INVITATION = 'campaign_invitation';

export const notificationOut = z.object({
  id: uuid,
  userId: uuid,
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  relatedId: uuid.nullable(),
  readAt: isoTimestamp.nullable(),
  createdAt: isoTimestamp,
});

export type NotificationOut = z.infer<typeof notificationOut>;
