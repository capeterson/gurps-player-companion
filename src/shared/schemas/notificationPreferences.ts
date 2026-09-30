import { z } from 'zod';

/** Only these two optional topics support email. Security mail bypasses preferences. */
export const notificationPreferences = z
  .object({
    emailInvitations: z.boolean().default(true),
    emailInvitationAccepted: z.boolean().default(true),
    invitations: z.boolean().default(true),
    membership: z.boolean().default(true),
    characterChanges: z.boolean().default(true),
    points: z.boolean().default(true),
    campaignChanges: z.boolean().default(true),
    adventureLog: z.boolean().default(true),
    libraryChanges: z.boolean().default(true),
  })
  .strict();
export const notificationPreferencesPatch = notificationPreferences
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Choose at least one notification preference');
export type NotificationPreferences = z.infer<typeof notificationPreferences>;
export const DEFAULT_NOTIFICATION_PREFERENCES = notificationPreferences.parse({});
export const NOTIFICATION_TOPICS = [
  { key: 'invitations', label: 'Invitations', description: 'Campaign invitations and responses.' },
  {
    key: 'membership',
    label: 'Membership and access',
    description: 'Role changes, removals, ownership transfers and campaign deletion.',
  },
  {
    key: 'characterChanges',
    label: 'Changes to my characters',
    description: 'When a GM or another user edits your character. Rapid edits are grouped.',
  },
  {
    key: 'points',
    label: 'Points awards',
    description: 'Points awarded, adjusted or removed from your characters.',
  },
  {
    key: 'campaignChanges',
    label: 'Campaign rules and settings',
    description: 'Changes to house rules, limits, sharing or GM editing permissions.',
  },
  {
    key: 'adventureLog',
    label: 'Shared adventure log',
    description: 'New campaign notes and notes made shared. Private notes stay private.',
  },
  {
    key: 'libraryChanges',
    label: 'Linked library updates',
    description: 'Library updates that change the saved rules on your characters.',
  },
] as const;
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number]['key'];
