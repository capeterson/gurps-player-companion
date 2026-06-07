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
    subject: 'Reset your Player Companion password',
    text: [
      `Hi ${displayName},`,
      '',
      'Someone (hopefully you) requested a password reset for your Player Companion account.',
      '',
      `Reset your password: ${resetUrl}`,
      '',
      'This link expires in 1 hour. If you did not request a reset, you can ignore this email.',
    ].join('\n'),
    html: `
<p>Hi ${escapeHtml(displayName)},</p>
<p>Someone (hopefully you) requested a password reset for your Player Companion account.</p>
<p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p>
<p>This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p>
    `.trim(),
  });
}

export async function sendCampaignInviteEmail(
  resend: Resend,
  from: string,
  opts: {
    to: string;
    displayName: string;
    inviterName: string;
    campaignName: string;
    role: string;
    appUrl: string;
  },
): Promise<void> {
  const { to, displayName, inviterName, campaignName, role, appUrl } = opts;
  await resend.emails.send({
    from,
    to,
    subject: `${inviterName} invited you to join ${campaignName}`,
    text: [
      `Hi ${displayName},`,
      '',
      `${inviterName} has invited you to join the campaign "${campaignName}" as a ${role}.`,
      '',
      appUrl ? `Sign in to accept or decline: ${appUrl}` : 'Sign in to accept or decline.',
    ].join('\n'),
    html: `
<p>Hi ${escapeHtml(displayName)},</p>
<p>${escapeHtml(inviterName)} has invited you to join the campaign <strong>${escapeHtml(campaignName)}</strong> as a ${escapeHtml(role)}.</p>
${appUrl ? `<p><a href="${escapeHtml(appUrl)}">Sign in to accept or decline</a></p>` : '<p>Sign in to accept or decline.</p>'}
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
