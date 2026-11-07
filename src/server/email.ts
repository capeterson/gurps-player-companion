import { Resend } from 'resend';
import type { AppConfig } from './config.ts';

export function getResend(config: AppConfig): Resend | null {
  if (!config.resendApiKey) return null;
  return new Resend(config.resendApiKey);
}

export async function sendPasswordResetEmail(
  resend: Resend,
  from: string,
  opts: { to: string; displayName: string; resetUrl: string },
): Promise<void> {
  const { to, displayName, resetUrl } = opts;
  await resend.emails.send({
    from,
    to,
    subject: 'Reset your Sunbolt password',
    text: [
      `Hi ${displayName},`,
      '',
      'Someone (hopefully you) requested a password reset for your Sunbolt account.',
      '',
      `Reset your password: ${resetUrl}`,
      '',
      'This link expires in 1 hour. If you did not request a reset, you can ignore this email.',
    ].join('\n'),
    html: `
<p>Hi ${escapeHtml(displayName)},</p>
<p>Someone (hopefully you) requested a password reset for your Sunbolt account.</p>
<p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p>
<p>This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p>
    `.trim(),
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendNotificationEmail(
  resend: Resend,
  from: string,
  opts: { to: string; subject: string; message: string; appUrl: string; idempotencyKey: string },
): Promise<void> {
  const result = await resend.emails.send(
    {
      from,
      to: opts.to,
      subject: opts.subject,
      text: `${opts.message}\n\nOpen Sunbolt: ${opts.appUrl}`,
      html: `<p>${escapeHtml(opts.message)}</p><p><a href="${escapeHtml(opts.appUrl)}">Open Sunbolt</a></p>`,
    },
    { idempotencyKey: opts.idempotencyKey },
  );
  if (result.error) throw new Error('Email delivery failed');
}
