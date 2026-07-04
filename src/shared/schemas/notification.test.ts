import { describe, expect, it } from 'bun:test';
import { campaignInvitationNotificationPayload } from './notification.ts';

const valid = {
  campaign_id: '0193b3c0-f1f0-7000-8000-000000000001',
  campaign_name: 'The Iron Vale',
  inviter_id: '0193b3c0-f1f0-7000-8000-000000000002',
  inviter_display_name: 'GM Dave',
  role: 'member' as const,
};

describe('campaignInvitationNotificationPayload', () => {
  it('parses the shape the invitations router emits', () => {
    expect(campaignInvitationNotificationPayload.parse(valid)).toEqual(valid);
  });

  it('accepts the manager role', () => {
    const ok = campaignInvitationNotificationPayload.parse({ ...valid, role: 'manager' });
    expect(ok.role).toBe('manager');
  });

  it('rejects an owner role (invites can never grant ownership)', () => {
    const res = campaignInvitationNotificationPayload.safeParse({ ...valid, role: 'owner' });
    expect(res.success).toBe(false);
  });

  it('rejects a payload missing the campaign name', () => {
    const { campaign_name: _dropped, ...rest } = valid;
    const res = campaignInvitationNotificationPayload.safeParse(rest);
    expect(res.success).toBe(false);
  });

  it('rejects camelCase keys (column predates the schema; keys are snake_case)', () => {
    const res = campaignInvitationNotificationPayload.safeParse({
      campaignId: valid.campaign_id,
      campaignName: valid.campaign_name,
      inviterId: valid.inviter_id,
      inviterDisplayName: valid.inviter_display_name,
      role: 'member',
    });
    expect(res.success).toBe(false);
  });
});
