import { describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION } from '../../shared/syncProtocol.ts';
import { createApp } from '../app.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb, runInDbTransaction } from '../db/client.ts';
import {
  characterSkills,
  characterTraits,
  characters,
  notificationEmailQueue,
  notifications,
} from '../db/schema.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { processNotificationEvents } from './notificationEvents.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return {
    ...bearer(token),
    'content-type': 'application/json',
    [SYNC_PROTOCOL_HEADER]: String(SYNC_PROTOCOL_VERSION),
  };
}

function decodeUserId(accessToken: string): string {
  const segment = accessToken.split('.')[1];
  if (!segment) throw new Error('malformed JWT');
  return (JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { sub: string }).sub;
}

async function registerUser(label: string) {
  const email = `notification-event-${label}-${crypto.randomUUID()}@example.com`;
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'NotificationEvent1!', displayName: label }),
  });
  expect(response.status).toBe(201);
  const { accessToken } = (await response.json()) as { accessToken: string };
  return { accessToken, email, userId: decodeUserId(accessToken) };
}

async function createCampaign(
  accessToken: string,
  options: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const response = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Notification campaign ${crypto.randomUUID()}`, ...options }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function addMember(accessToken: string, campaignId: string, email: string): Promise<void> {
  const response = await app.request(`/api/v1/campaigns/${campaignId}/members`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ email }),
  });
  expect(response.status).toBe(200);
}

async function createCharacter(
  accessToken: string,
  name: string,
  campaignId: string,
): Promise<{ id: string }> {
  const response = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name, campaignId }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function clearNotifications(...userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    await getDb().delete(notifications).where(eq(notifications.userId, userId));
  }
}

async function notificationRows(userId: string) {
  return getDb().select().from(notifications).where(eq(notifications.userId, userId));
}

async function drainNotificationEvents(): Promise<number> {
  let total = 0;
  while (true) {
    const processed = await processNotificationEvents();
    total += processed;
    if (processed < 200) return total;
  }
}

describe('notification event fan-out', () => {
  it('groups GM REST and sync edits for the character owner only', async () => {
    const gm = await registerUser('mixed-gm');
    const player = await registerUser('mixed-player');
    const campaign = await createCampaign(gm.accessToken, { allowGmCharacterEditing: true });
    await addMember(gm.accessToken, campaign.id, player.email);
    const character = await createCharacter(player.accessToken, 'Mixed edit hero', campaign.id);
    const traitResponse = await app.request(`/api/v1/characters/${character.id}/traits`, {
      method: 'POST',
      headers: jsonHeaders(player.accessToken),
      body: JSON.stringify({ name: 'Old blessing', kind: 'advantage', points: 10 }),
    });
    expect(traitResponse.status).toBe(201);
    const { trait } = (await traitResponse.json()) as { trait: { id: string } };
    const [savedTrait] = await getDb()
      .select()
      .from(characterTraits)
      .where(eq(characterTraits.id, trait.id));

    await drainNotificationEvents();
    await clearNotifications(gm.userId, player.userId);
    await runInDbTransaction(async () => {
      const restEdit = await app.request(`/api/v1/characters/${character.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ st: 11 }),
      });
      expect(restEdit.status).toBe(200);

      const syncEdit = await app.request('/api/v1/sync/operations', {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({
          operations: [
            {
              clientOpId: crypto.randomUUID(),
              entityClass: 'character_trait',
              entityId: trait.id,
              parentId: character.id,
              command: 'patch',
              fieldPath: 'name',
              validationVersion: 1,
              attemptedValue: 'New blessing',
              prevValue: savedTrait?.name,
              baseRevision: Number(savedTrait?.revision),
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });
      expect(syncEdit.status).toBe(200);
      expect(
        ((await syncEdit.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status,
      ).toBe('applied');
    });

    expect(await drainNotificationEvents()).toBeGreaterThanOrEqual(2);
    const ownerNotices = (await notificationRows(player.userId)).filter(
      (notice) =>
        notice.type === 'event' &&
        (notice.payload as { characterId?: string }).characterId === character.id,
    );
    expect(ownerNotices).toHaveLength(1);
    expect(ownerNotices[0]?.payload).toMatchObject({
      topic: 'characterChanges',
      actorId: gm.userId,
      characterId: character.id,
      title: 'Mixed edit hero was updated',
      changes: ['attributes and identity', 'traits'],
    });
    expect(await notificationRows(gm.userId)).toHaveLength(0);
    expect(
      await getDb()
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.userId, player.userId)),
    ).toHaveLength(0);
  });

  it('does not notify owners about their own character edits', async () => {
    const owner = await registerUser('own-edit');
    const character = await createCharacter(
      owner.accessToken,
      'My own hero',
      (await createCampaign(owner.accessToken)).id,
    );
    await drainNotificationEvents();
    expect(
      (await notificationRows(owner.userId)).filter((notice) => notice.type === 'event'),
    ).toEqual([]);
    await clearNotifications(owner.userId);

    const edit = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ dx: 12 }),
    });
    expect(edit.status).toBe(200);
    await drainNotificationEvents();

    expect(
      (await notificationRows(owner.userId)).filter((notice) => notice.type === 'event'),
    ).toEqual([]);
  });

  it('replaces grouped character edits with one clean deletion notice', async () => {
    const gm = await registerUser('delete-group-gm');
    const player = await registerUser('delete-group-player');
    const campaign = await createCampaign(gm.accessToken, { allowGmCharacterEditing: true });
    await addMember(gm.accessToken, campaign.id, player.email);
    const character = await createCharacter(
      player.accessToken,
      'Deleted grouped hero',
      campaign.id,
    );

    const traitResponse = await app.request(`/api/v1/characters/${character.id}/traits`, {
      method: 'POST',
      headers: jsonHeaders(player.accessToken),
      body: JSON.stringify({ kind: 'advantage', name: 'Old ward' }),
    });
    expect(traitResponse.status).toBe(201);
    const { trait } = (await traitResponse.json()) as { trait: { id: string } };
    const skillResponse = await app.request(`/api/v1/characters/${character.id}/skills`, {
      method: 'POST',
      headers: jsonHeaders(player.accessToken),
      body: JSON.stringify({ name: 'Old blade skill', attribute: 'DX', difficulty: 'A' }),
    });
    expect(skillResponse.status).toBe(201);
    const { skill } = (await skillResponse.json()) as { skill: { id: string } };
    await drainNotificationEvents();
    await clearNotifications(gm.userId, player.userId);

    const gestureId = crypto.randomUUID();
    await withAudit(
      gm.userId,
      gestureId,
      async (tx) => {
        await tx
          .update(characters)
          .set({ st: 11, updatedAt: new Date() })
          .where(eq(characters.id, character.id));
        await tx
          .update(characterTraits)
          .set({ name: 'New ward', updatedAt: new Date() })
          .where(eq(characterTraits.id, trait.id));
        await tx
          .update(characterSkills)
          .set({ name: 'New blade skill', updatedAt: new Date() })
          .where(eq(characterSkills.id, skill.id));
        await tx.delete(characters).where(eq(characters.id, character.id));
      },
      gestureId,
    );
    await drainNotificationEvents();

    const ownerNotices = (await notificationRows(player.userId)).filter(
      (notice) =>
        notice.type === 'event' &&
        (notice.payload as { characterId?: string }).characterId === character.id,
    );
    expect(ownerNotices).toHaveLength(1);
    expect(ownerNotices[0]?.payload).toMatchObject({
      topic: 'characterChanges',
      characterId: character.id,
      title: 'Deleted grouped hero was deleted',
      message: expect.stringContaining('deleted this character'),
      href: null,
      changes: [],
    });
  });

  it('honors muted topics and creates a fresh unread notice after a grouped notice is read', async () => {
    const gm = await registerUser('read-group-gm');
    const player = await registerUser('read-group-player');
    const campaign = await createCampaign(gm.accessToken, { allowGmCharacterEditing: true });
    await addMember(gm.accessToken, campaign.id, player.email);
    const character = await createCharacter(player.accessToken, 'Read group hero', campaign.id);
    await drainNotificationEvents();
    await clearNotifications(gm.userId, player.userId);

    const preferences = await app.request('/api/v1/auth/notification-preferences', {
      method: 'PATCH',
      headers: jsonHeaders(player.accessToken),
      body: JSON.stringify({ characterChanges: false }),
    });
    expect(preferences.status).toBe(200);

    const updateAsGm = (st: number, gestureId = crypto.randomUUID()) =>
      withAudit(
        gm.userId,
        null,
        async (tx) => {
          await tx
            .update(characters)
            .set({ st, updatedAt: new Date() })
            .where(eq(characters.id, character.id));
        },
        gestureId,
      );

    await updateAsGm(11);
    await drainNotificationEvents();
    expect(
      (await notificationRows(player.userId)).filter((notice) => notice.type === 'event'),
    ).toEqual([]);

    const unmuted = await app.request('/api/v1/auth/notification-preferences', {
      method: 'PATCH',
      headers: jsonHeaders(player.accessToken),
      body: JSON.stringify({ characterChanges: true }),
    });
    expect(unmuted.status).toBe(200);
    const sharedGestureId = crypto.randomUUID();
    await updateAsGm(12, sharedGestureId);
    await drainNotificationEvents();
    const firstNotice = (await notificationRows(player.userId)).find(
      (notice) => notice.type === 'event',
    );
    expect(firstNotice).toBeDefined();

    const markedRead = await app.request(`/api/v1/notifications/${firstNotice?.id}/read`, {
      method: 'POST',
      headers: bearer(player.accessToken),
    });
    expect(markedRead.status).toBe(200);
    expect((await markedRead.json()).readAt).toEqual(expect.any(String));

    await updateAsGm(13, sharedGestureId);
    await drainNotificationEvents();
    const eventNotices = (await notificationRows(player.userId)).filter(
      (notice) => notice.type === 'event',
    );
    expect(eventNotices).toHaveLength(2);
    expect(eventNotices.find((notice) => notice.id === firstNotice?.id)?.readAt).not.toBeNull();
    expect(eventNotices.find((notice) => notice.id !== firstNotice?.id)?.readAt).toBeNull();
  });

  it('targets ownership transfer, member removal, and campaign deletion notices', async () => {
    const originalOwner = await registerUser('membership-original-owner');
    const newOwner = await registerUser('membership-new-owner');
    const departingMember = await registerUser('membership-departing');
    const remainingMember = await registerUser('membership-remaining');
    const campaign = await createCampaign(originalOwner.accessToken);
    await addMember(originalOwner.accessToken, campaign.id, newOwner.email);
    await addMember(originalOwner.accessToken, campaign.id, departingMember.email);
    await addMember(originalOwner.accessToken, campaign.id, remainingMember.email);
    await drainNotificationEvents();
    await clearNotifications(
      originalOwner.userId,
      newOwner.userId,
      departingMember.userId,
      remainingMember.userId,
    );

    const transferred = await app.request(`/api/v1/campaigns/${campaign.id}/transfer`, {
      method: 'POST',
      headers: jsonHeaders(originalOwner.accessToken),
      body: JSON.stringify({ newOwnerId: newOwner.userId }),
    });
    expect(transferred.status).toBe(200);
    await drainNotificationEvents();

    for (const recipient of [newOwner, departingMember, remainingMember]) {
      expect(
        (await notificationRows(recipient.userId)).map((notice) => notice.payload),
      ).toContainEqual(
        expect.objectContaining({
          topic: 'membership',
          title: 'Campaign ownership transferred',
        }),
      );
    }
    expect(await notificationRows(originalOwner.userId)).toEqual([]);

    const removed = await app.request(
      `/api/v1/campaigns/${campaign.id}/members/${departingMember.userId}`,
      { method: 'DELETE', headers: bearer(newOwner.accessToken) },
    );
    expect(removed.status).toBe(204);
    await drainNotificationEvents();
    expect(
      (await notificationRows(departingMember.userId)).map((notice) => notice.payload),
    ).toContainEqual(
      expect.objectContaining({
        topic: 'membership',
        title: 'Campaign access removed',
      }),
    );

    await clearNotifications(
      originalOwner.userId,
      newOwner.userId,
      departingMember.userId,
      remainingMember.userId,
    );
    const deleted = await app.request(`/api/v1/campaigns/${campaign.id}`, {
      method: 'DELETE',
      headers: bearer(newOwner.accessToken),
    });
    expect(deleted.status).toBe(204);
    await drainNotificationEvents();

    expect(
      (await notificationRows(remainingMember.userId)).map((notice) => notice.payload),
    ).toContainEqual(
      expect.objectContaining({
        topic: 'membership',
        title: 'Campaign deleted',
      }),
    );
  });

  it('keeps private adventure log entries out of campaign notifications', async () => {
    const gm = await registerUser('private-log-gm');
    const player = await registerUser('private-log-player');
    const campaign = await createCampaign(gm.accessToken);
    await addMember(gm.accessToken, campaign.id, player.email);
    const privateCharacter = await createCharacter(
      gm.accessToken,
      'GM private character',
      campaign.id,
    );
    await drainNotificationEvents();
    await clearNotifications(gm.userId, player.userId);

    const privateEntry = await app.request(`/api/v1/campaigns/${campaign.id}/log`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        characterId: privateCharacter.id,
        sessionDate: '2026-01-15',
        title: 'Private GM note',
        body: 'This should stay private.',
      }),
    });
    expect(privateEntry.status).toBe(201);
    await drainNotificationEvents();

    expect(
      (await notificationRows(player.userId)).filter(
        (notice) => (notice.payload as { topic?: string }).topic === 'adventureLog',
      ),
    ).toEqual([]);
    expect(
      await getDb()
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.userId, player.userId)),
    ).toHaveLength(0);

    const sharedEntry = await app.request(`/api/v1/campaigns/${campaign.id}/log`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        sessionDate: '2026-01-16',
        title: 'Published session recap',
        body: 'This entry is shared with campaign members.',
      }),
    });
    expect(sharedEntry.status).toBe(201);
    await drainNotificationEvents();

    const sharedNotices = (await notificationRows(player.userId)).filter(
      (notice) => (notice.payload as { topic?: string }).topic === 'adventureLog',
    );
    expect(sharedNotices).toHaveLength(1);
    expect(sharedNotices[0]?.payload).toMatchObject({
      title: 'New shared adventure log',
      message: expect.stringContaining('published a shared entry'),
    });
  });

  it('classifies earned-point changes as points and avoids a duplicate character-change notice', async () => {
    const gm = await registerUser('points-gm');
    const player = await registerUser('points-player');
    const campaign = await createCampaign(gm.accessToken);
    await addMember(gm.accessToken, campaign.id, player.email);
    const character = await createCharacter(player.accessToken, 'Point award hero', campaign.id);
    await drainNotificationEvents();
    await clearNotifications(gm.userId, player.userId);

    const award = await app.request(`/api/v1/campaigns/${campaign.id}/log`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        sessionDate: '2026-01-16',
        title: 'Award points',
        pointsGained: 5,
      }),
    });
    expect(award.status).toBe(201);
    await drainNotificationEvents();

    const topics = (await notificationRows(player.userId)).map(
      (notice) => (notice.payload as { topic?: string }).topic,
    );
    expect(topics).toContain('points');
    expect(topics).not.toContain('characterChanges');
    expect(
      (await notificationRows(player.userId)).filter(
        (notice) =>
          notice.relatedId === character.id &&
          (notice.payload as { topic?: string }).topic === 'points',
      ),
    ).toHaveLength(1);
    expect(
      await getDb()
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.userId, player.userId)),
    ).toHaveLength(0);
  });
});
