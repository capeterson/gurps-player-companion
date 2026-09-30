import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TOPICS,
  notificationPreferences,
  notificationPreferencesPatch,
} from './notificationPreferences.ts';

describe('notification preferences', () => {
  it('defaults email on only for invitations and invitation acceptance, with topics enabled', () => {
    expect(notificationPreferences.parse({})).toEqual({
      emailInvitations: true,
      emailInvitationAccepted: true,
      invitations: true,
      membership: true,
      characterChanges: true,
      points: true,
      campaignChanges: true,
      adventureLog: true,
      libraryChanges: true,
    });
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual(notificationPreferences.parse({}));
  });

  it('allows changing one preference at a time and rejects empty or unknown patches', () => {
    expect(notificationPreferencesPatch.parse({ characterChanges: false })).toEqual({
      characterChanges: false,
    });
    expect(notificationPreferencesPatch.safeParse({}).success).toBe(false);
    expect(notificationPreferencesPatch.safeParse({ desktopEnabled: true }).success).toBe(false);
  });

  it('exposes the seven supported in-app topics', () => {
    expect(NOTIFICATION_TOPICS.map(({ key }) => key)).toEqual([
      'invitations',
      'membership',
      'characterChanges',
      'points',
      'campaignChanges',
      'adventureLog',
      'libraryChanges',
    ]);
  });
});
