/** Only invitation, acceptance and unconditional security mail can enter this worker. */
import { and, eq, isNull, lt, lte, min } from 'drizzle-orm';
import { notificationEmailPayload } from '../../shared/schemas/notification.ts';
import { notificationPreferences } from '../../shared/schemas/notificationPreferences.ts';
import { appUrl, loadConfig } from '../config.ts';
import { getDb, runInDbTransaction } from '../db/client.ts';
import { campaignInvitations, notificationEmailQueue, users } from '../db/schema.ts';
import { getResend, sendNotificationEmail } from '../email.ts';

/** Schedule only known pending mail; unconfigured delivery must remain idle. */
export async function nextNotificationEmailAttemptAt(): Promise<Date | null> {
  const config = loadConfig();
  if (!getResend(config) || !config.resendFromEmail) return null;
  const [row] = await getDb()
    .select({ nextAttemptAt: min(notificationEmailQueue.nextAttemptAt) })
    .from(notificationEmailQueue)
    .where(and(isNull(notificationEmailQueue.sentAt), lt(notificationEmailQueue.attempts, 8)));
  return row?.nextAttemptAt ? new Date(row.nextAttemptAt) : null;
}

export async function processNotificationEmails(
  sendEmail: typeof sendNotificationEmail = sendNotificationEmail,
): Promise<number> {
  const config = loadConfig();
  const resend = getResend(config);
  if (!resend || !config.resendFromEmail) return 0;
  const from = config.resendFromEmail;
  return runInDbTransaction(async () => {
    const db = getDb();
    const jobs = await db
      .select({ job: notificationEmailQueue, user: users })
      .from(notificationEmailQueue)
      .innerJoin(users, eq(users.id, notificationEmailQueue.userId))
      .where(
        and(
          isNull(notificationEmailQueue.sentAt),
          lt(notificationEmailQueue.attempts, 8),
          lte(notificationEmailQueue.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(notificationEmailQueue.createdAt)
      .limit(10)
      .for('update', { of: notificationEmailQueue, skipLocked: true });
    for (const { job, user } of jobs) {
      const preferences =
        job.kind === 'security'
          ? null
          : notificationPreferences.parse(user.notificationPreferences);
      let skip =
        (job.kind === 'invitation' && preferences?.emailInvitations === false) ||
        (job.kind === 'invitation_accepted' && preferences?.emailInvitationAccepted === false);
      if (job.kind === 'invitation' && job.relatedId) {
        const [invitation] = await db
          .select({ status: campaignInvitations.status })
          .from(campaignInvitations)
          .where(eq(campaignInvitations.id, job.relatedId));
        skip ||= invitation?.status !== 'pending';
      }
      if (skip) {
        await db.delete(notificationEmailQueue).where(eq(notificationEmailQueue.id, job.id));
        continue;
      }
      try {
        const payload = notificationEmailPayload.parse({
          subject: job.subject,
          message: job.message,
        });
        await sendEmail(resend, from, {
          to: user.email,
          ...payload,
          appUrl: appUrl(config),
          idempotencyKey: job.eventKey,
        });
        await db
          .update(notificationEmailQueue)
          .set({ sentAt: new Date(), lastError: null })
          .where(eq(notificationEmailQueue.id, job.id));
      } catch {
        const attempts = job.attempts + 1;
        await db
          .update(notificationEmailQueue)
          .set({
            attempts,
            lastError: 'Email delivery failed',
            nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 60_000 * 2 ** attempts)),
          })
          .where(eq(notificationEmailQueue.id, job.id));
        console.error('notification email delivery failed', { jobId: job.id, attempts });
      }
    }
    return jobs.length;
  });
}
