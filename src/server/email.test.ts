import { describe, expect, it } from 'bun:test';
import type { Resend } from 'resend';
import { sendNotificationEmail, sendPasswordResetEmail } from './email.ts';

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

  it('escapes notification message text and the app URL attribute using the mocked transport', async () => {
    const { resend, messages } = mockResend();
    await sendNotificationEmail(resend, 'test@example.invalid', {
      to: 'player@example.invalid',
      subject: 'Invitation',
      message: `O'Brien & <b>GM</b> invited you to Café & 東京 <script>alert(1)</script>`,
      appUrl: 'https://app.example/invitations?return="x"&next=one',
      idempotencyKey: 'test-key',
    });

    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message?.html).toContain(
      `O'Brien &amp; &lt;b&gt;GM&lt;/b&gt; invited you to Café &amp; 東京 &lt;script&gt;alert(1)&lt;/script&gt;`,
    );
    expect(message?.html).toContain(
      'href="https://app.example/invitations?return=&quot;x&quot;&amp;next=one"',
    );
    expect(message?.html).not.toContain('<script>');
    expect(message?.html).not.toContain('<b>');
  });
});
