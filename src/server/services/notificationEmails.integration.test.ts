import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { and, eq, isNull, notInArray } from 'drizzle-orm';
import type { NotificationEmailPayload } from '../../shared/schemas/notification.ts';
import { createApp } from '../app.ts';
import { resetConfigCache } from '../config.ts';
import { getDb } from '../db/client.ts';
import { notificationEmailQueue, passkeyCredentials } from '../db/schema.ts';
import { sendNotificationEmail } from '../email.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { nextNotificationEmailAttemptAt } from './notificationEmails.ts';
import { processNotificationEmails } from './notificationEmails.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);
const priorResendApiKey = process.env.RESEND_API_KEY;
const priorResendFromEmail = process.env.RESEND_FROM_EMAIL;

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.RESEND_FROM_EMAIL = 'notifications@example.invalid';
  resetConfigCache();
});

afterEach(() => {
  if (priorResendApiKey === undefined) Reflect.deleteProperty(process.env, 'RESEND_API_KEY');
  else process.env.RESEND_API_KEY = priorResendApiKey;
  if (priorResendFromEmail === undefined) Reflect.deleteProperty(process.env, 'RESEND_FROM_EMAIL');
  else process.env.RESEND_FROM_EMAIL = priorResendFromEmail;
  resetConfigCache();
});

type DeliveredEmail = NotificationEmailPayload & {
  to: string;
  appUrl: string;
  idempotencyKey: string;
};
type EmailSender = Parameters<typeof processNotificationEmails>[0];

function captureEmail(delivered: DeliveredEmail[]): EmailSender {
  return async (_resend, _from, message) => {
    delivered.push(message);
  };
}

function jsonHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function decodeUserId(accessToken: string): string {
  const segment = accessToken.split('.')[1];
  if (!segment) throw new Error('malformed JWT');
  return (JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { sub: string }).sub;
}

async function registerUser(label: string) {
  const email = `notification-email-${label}-${crypto.randomUUID()}@example.com`;
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'NotificationEmail1!', displayName: label }),
  });
  expect(response.status).toBe(201);
  const { accessToken } = (await response.json()) as { accessToken: string };
  return { accessToken, email, userId: decodeUserId(accessToken) };
}

async function createCampaign(accessToken: string): Promise<{ id: string }> {
  const response = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Email campaign ${crypto.randomUUID()}` }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function createInvitation(campaignId: string, inviterToken: string, inviteeEmail: string) {
  const response = await app.request(`/api/v1/campaigns/${campaignId}/invitations`, {
    method: 'POST',
    headers: jsonHeaders(inviterToken),
    body: JSON.stringify({ handle: inviteeEmail }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function setPreferences(token: string, body: Record<string, boolean>) {
  return app.request('/api/v1/auth/notification-preferences', {
    method: 'PATCH',
    headers: jsonHeaders(token),
    body: JSON.stringify(body),
  });
}

async function makeSecurityEmailJobsDue(userId: string): Promise<void> {
  await getDb()
    .update(notificationEmailQueue)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(
      and(
        eq(notificationEmailQueue.userId, userId),
        eq(notificationEmailQueue.kind, 'security'),
        isNull(notificationEmailQueue.sentAt),
      ),
    );
}

async function keepOnlyTheseUsersDue<T>(userIds: string[], run: () => Promise<T>): Promise<T> {
  const db = getDb();
  const unrelated = await db
    .select({ id: notificationEmailQueue.id, nextAttemptAt: notificationEmailQueue.nextAttemptAt })
    .from(notificationEmailQueue)
    .where(notInArray(notificationEmailQueue.userId, userIds));
  await db
    .update(notificationEmailQueue)
    .set({ nextAttemptAt: new Date('2099-01-01T00:00:00.000Z') })
    .where(notInArray(notificationEmailQueue.userId, userIds));
  try {
    return await run();
  } finally {
    for (const job of unrelated) {
      await db
        .update(notificationEmailQueue)
        .set({ nextAttemptAt: job.nextAttemptAt })
        .where(eq(notificationEmailQueue.id, job.id));
    }
  }
}

describe('notification email policy', () => {
  it('schedules only the earliest pending retry and stays idle without delivery credentials', async () => {
    const user = await registerUser('deadline');
    await keepOnlyTheseUsersDue([user.userId], async () => {
      await getDb()
        .update(notificationEmailQueue)
        .set({ attempts: 8, nextAttemptAt: new Date('2099-01-01T00:00:00.000Z') })
        .where(eq(notificationEmailQueue.userId, user.userId));
      const dueAt = new Date(Date.now() + 30_000);
      const laterAt = new Date(Date.now() + 60_000);
      await getDb()
        .insert(notificationEmailQueue)
        .values([
          {
            userId: user.userId,
            kind: 'security',
            eventKey: `deadline-due:${crypto.randomUUID()}`,
            subject: 'test',
            message: 'test',
            nextAttemptAt: dueAt,
          },
          {
            userId: user.userId,
            kind: 'security',
            eventKey: `deadline-later:${crypto.randomUUID()}`,
            subject: 'test',
            message: 'test',
            nextAttemptAt: laterAt,
          },
          {
            userId: user.userId,
            kind: 'security',
            eventKey: `deadline-exhausted:${crypto.randomUUID()}`,
            subject: 'test',
            message: 'test',
            attempts: 8,
            nextAttemptAt: new Date(Date.now() - 1_000),
          },
          {
            userId: user.userId,
            kind: 'security',
            eventKey: `deadline-sent:${crypto.randomUUID()}`,
            subject: 'test',
            message: 'test',
            sentAt: new Date(),
            nextAttemptAt: new Date(Date.now() - 1_000),
          },
        ]);
      expect((await nextNotificationEmailAttemptAt())?.getTime()).toBe(dueAt.getTime());

      Reflect.deleteProperty(process.env, 'RESEND_API_KEY');
      resetConfigCache();
      expect(await nextNotificationEmailAttemptAt()).toBeNull();
      process.env.RESEND_API_KEY = 'test-resend-key';
      resetConfigCache();
    });
  });

  it('emails campaign invitations and accepted invitations by default, then does not duplicate sent jobs', async () => {
    const delivered: DeliveredEmail[] = [];
    const inviter = await registerUser('default-inviter');
    const invitee = await registerUser('default-invitee');
    const campaign = await createCampaign(inviter.accessToken);
    const invitation = await createInvitation(campaign.id, inviter.accessToken, invitee.email);

    await keepOnlyTheseUsersDue([inviter.userId, invitee.userId], async () => {
      expect(await processNotificationEmails(captureEmail(delivered))).toBeGreaterThanOrEqual(1);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({
        to: invitee.email,
        subject: expect.stringContaining('invited you to join'),
      });

      const accepted = await app.request(`/api/v1/invitations/${invitation.id}/accept`, {
        method: 'POST',
        headers: jsonHeaders(invitee.accessToken),
      });
      expect(accepted.status).toBe(200);
      expect(await processNotificationEmails(captureEmail(delivered))).toBeGreaterThanOrEqual(1);
      expect(delivered).toHaveLength(2);
      expect(delivered[1]).toMatchObject({
        to: inviter.email,
        subject: expect.stringContaining('accepted your campaign invitation'),
      });

      const jobs = await getDb()
        .select()
        .from(notificationEmailQueue)
        .where(and(eq(notificationEmailQueue.userId, invitee.userId)));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.sentAt).not.toBeNull();
      expect(await processNotificationEmails(captureEmail(delivered))).toBe(0);
      expect(delivered).toHaveLength(2);
    });
  });

  it('honors invitation email opt-outs while always sending security alerts', async () => {
    const delivered: DeliveredEmail[] = [];
    const inviter = await registerUser('optout-inviter');
    const invitee = await registerUser('optout-invitee');
    expect(
      (await setPreferences(inviter.accessToken, { emailInvitationAccepted: false })).status,
    ).toBe(200);
    expect((await setPreferences(invitee.accessToken, { emailInvitations: false })).status).toBe(
      200,
    );
    const campaign = await createCampaign(inviter.accessToken);
    const invitation = await createInvitation(campaign.id, inviter.accessToken, invitee.email);

    await keepOnlyTheseUsersDue([inviter.userId, invitee.userId], async () => {
      await processNotificationEmails(captureEmail(delivered));
      expect(delivered).toEqual([]);
      expect(
        await getDb()
          .select()
          .from(notificationEmailQueue)
          .where(eq(notificationEmailQueue.userId, invitee.userId)),
      ).toEqual([]);

      const accepted = await app.request(`/api/v1/invitations/${invitation.id}/accept`, {
        method: 'POST',
        headers: jsonHeaders(invitee.accessToken),
      });
      expect(accepted.status).toBe(200);
      await processNotificationEmails(captureEmail(delivered));
      expect(delivered).toEqual([]);

      await getDb()
        .update((await import('../db/schema.ts')).users)
        .set({ passwordHash: 'changed-for-security-notification-test' })
        .where(eq((await import('../db/schema.ts')).users.id, invitee.userId));
      const queuedSecurity = await getDb()
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.userId, invitee.userId));
      expect(queuedSecurity.map((job) => job.kind)).toEqual(['security']);

      await processNotificationEmails(captureEmail(delivered));
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({
        to: invitee.email,
        subject: 'Player Companion security alert',
      });
      expect(delivered[0]?.message).toContain('password was changed');
      const sentSecurity = await getDb()
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.userId, invitee.userId));
      expect(sentSecurity).toHaveLength(1);
      expect(sentSecurity[0]?.kind).toBe('security');
      expect(sentSecurity[0]?.sentAt).not.toBeNull();
      expect(
        await getDb()
          .select()
          .from(notificationEmailQueue)
          .where(eq(notificationEmailQueue.userId, inviter.userId)),
      ).toEqual([]);
    });
  });

  it('drops canceled or rejected invitations without sending an email', async () => {
    const delivered: DeliveredEmail[] = [];
    const inviter = await registerUser('stale-inviter');
    const canceledInvitee = await registerUser('canceled-invitee');
    const rejectedInvitee = await registerUser('rejected-invitee');
    const campaign = await createCampaign(inviter.accessToken);
    const canceled = await createInvitation(
      campaign.id,
      inviter.accessToken,
      canceledInvitee.email,
    );
    const rejected = await createInvitation(
      campaign.id,
      inviter.accessToken,
      rejectedInvitee.email,
    );

    await keepOnlyTheseUsersDue(
      [inviter.userId, canceledInvitee.userId, rejectedInvitee.userId],
      async () => {
        const cancel = await app.request(
          `/api/v1/campaigns/${campaign.id}/invitations/${canceled.id}`,
          { method: 'DELETE', headers: jsonHeaders(inviter.accessToken) },
        );
        expect(cancel.status).toBe(204);
        const decline = await app.request(`/api/v1/invitations/${rejected.id}/reject`, {
          method: 'POST',
          headers: jsonHeaders(rejectedInvitee.accessToken),
        });
        expect(decline.status).toBe(200);

        await processNotificationEmails(captureEmail(delivered));
        expect(delivered).toEqual([]);
        expect(
          await getDb()
            .select()
            .from(notificationEmailQueue)
            .where(
              and(
                eq(notificationEmailQueue.userId, canceledInvitee.userId),
                eq(notificationEmailQueue.kind, 'invitation'),
              ),
            ),
        ).toEqual([]);
        expect(
          await getDb()
            .select()
            .from(notificationEmailQueue)
            .where(
              and(
                eq(notificationEmailQueue.userId, rejectedInvitee.userId),
                eq(notificationEmailQueue.kind, 'invitation'),
              ),
            ),
        ).toEqual([]);
      },
    );
  });

  it('retries failed delivery with the same idempotency key and does not resend after success', async () => {
    const delivered: DeliveredEmail[] = [];
    const inviter = await registerUser('retry-inviter');
    const invitee = await registerUser('retry-invitee');
    const campaign = await createCampaign(inviter.accessToken);
    await createInvitation(campaign.id, inviter.accessToken, invitee.email);

    await keepOnlyTheseUsersDue([inviter.userId, invitee.userId], async () => {
      const firstSender: EmailSender = async (_resend, _from, email) => {
        delivered.push(email);
        throw new Error('temporary provider outage');
      };
      await processNotificationEmails(firstSender);
      expect(delivered).toHaveLength(1);
      const [failed] = await getDb()
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.userId, invitee.userId));
      if (!failed) throw new Error('expected invitation email job');
      expect(failed).toMatchObject({
        attempts: 1,
        sentAt: null,
        lastError: 'Email delivery failed',
      });

      await getDb()
        .update(notificationEmailQueue)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(eq(notificationEmailQueue.id, failed.id));
      const succeeded = await processNotificationEmails(captureEmail(delivered));
      expect(succeeded).toBe(1);
      expect(delivered).toHaveLength(2);
      expect(delivered[1]?.idempotencyKey).toBe(delivered[0]?.idempotencyKey);
      const sent = await getDb()
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.id, failed.id));
      expect(sent[0]?.sentAt).not.toBeNull();
      expect(await processNotificationEmails(captureEmail(delivered))).toBe(0);
      expect(delivered).toHaveLength(2);
    });
  });

  it('always emails API-key and passkey security changes and deduplicates changes in one transaction', async () => {
    const delivered: DeliveredEmail[] = [];
    const user = await registerUser('credential-security');
    expect(
      (
        await setPreferences(user.accessToken, {
          emailInvitations: false,
          emailInvitationAccepted: false,
        })
      ).status,
    ).toBe(200);

    await keepOnlyTheseUsersDue([user.userId], async () => {
      const createKey = await app.request('/api/v1/auth/api-keys', {
        method: 'POST',
        headers: jsonHeaders(user.accessToken),
        body: JSON.stringify({ name: 'Security test key' }),
      });
      expect(createKey.status).toBe(201);
      const { apiKey } = (await createKey.json()) as { apiKey: { id: string } };
      await makeSecurityEmailJobsDue(user.userId);
      expect(await processNotificationEmails(captureEmail(delivered))).toBe(1);
      expect(delivered[0]?.message).toContain('An API key was created');

      const revokeKey = await app.request(`/api/v1/auth/api-keys/${apiKey.id}`, {
        method: 'DELETE',
        headers: jsonHeaders(user.accessToken),
      });
      expect(revokeKey.status).toBe(204);
      await makeSecurityEmailJobsDue(user.userId);
      expect(await processNotificationEmails(captureEmail(delivered))).toBe(1);
      expect(delivered[1]?.message).toContain('An API key was revoked');

      const [passkey] = await getDb()
        .insert(passkeyCredentials)
        .values({
          userId: user.userId,
          credentialId: `synthetic-${crypto.randomUUID()}`,
          publicKey: Buffer.from('synthetic test public key').toString('base64url'),
          name: 'Notification test passkey',
        })
        .returning({ id: passkeyCredentials.id });
      expect(passkey).toBeDefined();
      await makeSecurityEmailJobsDue(user.userId);
      expect(await processNotificationEmails(captureEmail(delivered))).toBe(1);
      expect(delivered[2]?.message).toContain('A passkey was added');

      const removePasskey = await app.request(`/api/v1/auth/passkeys/${passkey?.id}`, {
        method: 'DELETE',
        headers: jsonHeaders(user.accessToken),
      });
      expect(removePasskey.status).toBe(204);
      await makeSecurityEmailJobsDue(user.userId);
      expect(await processNotificationEmails(captureEmail(delivered))).toBe(1);
      expect(delivered[3]?.message).toContain('A passkey was removed');

      const transactionCredentialId = `synthetic-${crypto.randomUUID()}`;
      await getDb().transaction(async (tx) => {
        const [created] = await tx
          .insert(passkeyCredentials)
          .values({
            userId: user.userId,
            credentialId: transactionCredentialId,
            publicKey: Buffer.from('synthetic transaction key').toString('base64url'),
            name: 'Transaction dedupe passkey',
          })
          .returning({ id: passkeyCredentials.id });
        if (!created) throw new Error('expected inserted test passkey');
        await tx.delete(passkeyCredentials).where(eq(passkeyCredentials.id, created.id));
      });
      const beforeDedup = await getDb()
        .select()
        .from(notificationEmailQueue)
        .where(
          and(
            eq(notificationEmailQueue.userId, user.userId),
            eq(notificationEmailQueue.kind, 'security'),
          ),
        );
      expect(beforeDedup.filter((job) => job.sentAt === null)).toHaveLength(1);
      await makeSecurityEmailJobsDue(user.userId);
      expect(await processNotificationEmails(captureEmail(delivered))).toBe(1);
      expect(delivered).toHaveLength(5);
      expect(delivered[4]?.message).toContain('A passkey was added');
      expect(await processNotificationEmails(captureEmail(delivered))).toBe(0);
      expect(delivered).toHaveLength(5);
    });
  });
});
