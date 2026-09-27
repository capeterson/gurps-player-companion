import { describe, expect, it } from 'bun:test';
import type { Resend } from 'resend';
import { sendCampaignInviteEmail, sendPasswordResetEmail } from './email.ts';

function mockResend() {
  const messages: Record<string, unknown>[] = [];
  const send = async (message: Record<string, unknown>) => {
    messages.push(message);
    return { data: { id: 'mock-email-id' }, error: null };
  };
  return { resend: { emails: { send } } as unknown as Resend, messages };
}

describe('HTML email interpolation', () => {
  it('escapes password reset text and the quoted URL attribute without sending mail', async () => {
    const { resend, messages } = mockResend();
    await sendPasswordResetEmail(resend, 'test@example.invalid', {
      to: 'player@example.invalid',
      displayName: `O'Brien & <img src=x onerror="alert(1)">`,
      resetUrl: 'https://app.example/reset?next="x"&mode=canary',
    });

    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message?.html).toContain(`O'Brien &amp; &lt;img src=x onerror=&quot;alert(1)&quot;&gt;`);
    expect(message?.html).toContain(
      'href="https://app.example/reset?next=&quot;x&quot;&amp;mode=canary"',
    );
    expect(message?.html).not.toContain('<img');
    expect(message?.text).toContain(`O'Brien & <img src=x onerror="alert(1)">`);
  });

  it('escapes invitee, inviter, campaign, role and app URL using the mocked transport', async () => {
    const { resend, messages } = mockResend();
    await sendCampaignInviteEmail(resend, 'test@example.invalid', {
      to: 'player@example.invalid',
      displayName: 'Player <svg/onload=alert(1)>',
      inviterName: `O'Brien & <b>GM</b>`,
      campaignName: 'Café & 東京 <script>alert(1)</script>',
      role: 'manager" onclick="alert(2)',
      appUrl: 'https://app.example/invitations?return="x"&next=one',
    });

    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message?.html).toContain('Player &lt;svg/onload=alert(1)&gt;');
    expect(message?.html).toContain(`O'Brien &amp; &lt;b&gt;GM&lt;/b&gt;`);
    expect(message?.html).toContain('Café &amp; 東京 &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(message?.html).toContain('manager&quot; onclick=&quot;alert(2)');
    expect(message?.html).toContain(
      'href="https://app.example/invitations?return=&quot;x&quot;&amp;next=one"',
    );
    expect(message?.html).not.toContain('<script>');
    expect(message?.html).not.toContain('<svg');
  });
});
