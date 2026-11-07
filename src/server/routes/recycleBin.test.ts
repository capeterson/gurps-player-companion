/**
 * Recycle bin: deleting moves a character or campaign to the bin; it is hidden
 * everywhere, restorable, and hard-deleted only by "Delete now" or the sweep
 * once it has been binned for the full 30 days.
 *
 * Requires a running Postgres test DB configured by ../testConfig.ts.
 */

import { describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import type { SyncCursorResponse } from '../../shared/schemas/sync.ts';
import { SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION } from '../../shared/syncProtocol.ts';
import { createApp } from '../app.ts';
import { getDb } from '../db/client.ts';
import {
  campaignMemberships,
  campaigns,
  characterTraits,
  characters,
  entityTombstones,
} from '../db/schema.ts';
import { attachTrustedExecution } from '../services/executionContext.ts';
import { RECYCLE_BIN_RETENTION_DAYS, sweepRecycleBin } from '../services/recycleBin.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { createTestActor } from '../testFixtures.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  [SYNC_PROTOCOL_HEADER]: String(SYNC_PROTOCOL_VERSION),
  'content-type': 'application/json',
});
const call = (token: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/v1${path}`, {
    method,
    headers: headers(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function createCampaign(token: string) {
  const res = await call(token, 'POST', '/campaigns', { name: `Bin ${crypto.randomUUID()}` });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}
async function createCharacter(token: string, overrides: Record<string, unknown> = {}) {
  const res = await call(token, 'POST', '/characters', {
    name: `Hero ${crypto.randomUUID()}`,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}
async function addMember(owner: string, campaignId: string, email: string) {
  expect((await call(owner, 'POST', `/campaigns/${campaignId}/members`, { email })).status).toBe(
    200,
  );
}
type Bin = {
  characters: { id: string; deletedAt: string; purgeAfter: string }[];
  campaigns: { id: string; characterCount: number }[];
};
async function bin(token: string): Promise<Bin> {
  const res = await call(token, 'GET', '/recycle-bin');
  expect(res.status).toBe(200);
  return (await res.json()) as Bin;
}
async function accessible(token: string) {
  const res = await call(token, 'POST', '/sync/cursor', { cursors: [], pageSize: 50 });
  expect(res.status).toBe(200);
  const { accessible } = (await res.json()) as SyncCursorResponse;
  if (!accessible) throw new Error('cursor response carried no accessible sets');
  return accessible;
}
const backdate = (table: typeof characters | typeof campaigns, id: string, interval: string) =>
  getDb()
    .update(table)
    .set({ deletedAt: sql`now() - ${interval}::interval` })
    .where(eq(table.id, id));

describe('recycle bin: characters', () => {
  it('moves a deleted character to the bin, hides it everywhere and restores it intact', async () => {
    const owner = await createTestActor('bin-char');
    const character = await createCharacter(owner.accessToken);
    const trait = await call(owner.accessToken, 'POST', `/characters/${character.id}/traits`, {
      name: 'Alertness',
      kind: 'advantage',
      points: 5,
    });
    expect(trait.status).toBe(201);

    expect((await call(owner.accessToken, 'DELETE', `/characters/${character.id}`)).status).toBe(
      204,
    );
    expect((await call(owner.accessToken, 'GET', `/characters/${character.id}`)).status).toBe(404);
    const list = (await (await call(owner.accessToken, 'GET', '/characters')).json()) as {
      id: string;
    }[];
    expect(list.some((row) => row.id === character.id)).toBe(false);
    expect((await accessible(owner.accessToken)).characterIds).not.toContain(character.id);
    // A bin is not a hard delete: nothing tells other devices it was deleted.
    expect(
      await getDb()
        .select()
        .from(entityTombstones)
        .where(eq(entityTombstones.entityId, character.id)),
    ).toHaveLength(0);

    const binned = (await bin(owner.accessToken)).characters.find((row) => row.id === character.id);
    expect(binned).toBeDefined();
    const days =
      (Date.parse(binned?.purgeAfter ?? '') - Date.parse(binned?.deletedAt ?? '')) / 86_400_000;
    expect(days).toBe(RECYCLE_BIN_RETENTION_DAYS);

    expect(
      (await call(owner.accessToken, 'POST', `/characters/${character.id}/restore`)).status,
    ).toBe(204);
    const restored = await call(owner.accessToken, 'GET', `/characters/${character.id}`);
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { traits: unknown[] }).traits).toHaveLength(1);
    expect((await accessible(owner.accessToken)).characterIds).toContain(character.id);
    expect((await bin(owner.accessToken)).characters.some((r) => r.id === character.id)).toBe(
      false,
    );
  });

  it('bins through a /sync/operations delete as well', async () => {
    const owner = await createTestActor('bin-sync');
    const character = await createCharacter(owner.accessToken);
    const res = await call(owner.accessToken, 'POST', '/sync/operations', {
      operations: [
        {
          clientOpId: crypto.randomUUID(),
          entityClass: 'character',
          entityId: character.id,
          command: 'delete',
          validationVersion: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status).toBe(
      'applied',
    );
    expect((await bin(owner.accessToken)).characters.map((row) => row.id)).toContain(character.id);
    expect((await accessible(owner.accessToken)).characterIds).not.toContain(character.id);
  });

  it('only people who may manage a character can see, restore or permanently delete it', async () => {
    const owner = await createTestActor('bin-owner');
    const stranger = await createTestActor('bin-stranger');
    const character = await createCharacter(owner.accessToken);
    await call(owner.accessToken, 'DELETE', `/characters/${character.id}`);
    expect((await bin(stranger.accessToken)).characters).toHaveLength(0);
    expect(
      (await call(stranger.accessToken, 'POST', `/characters/${character.id}/restore`)).status,
    ).toBe(403);
    expect(
      (await call(stranger.accessToken, 'DELETE', `/recycle-bin/characters/${character.id}`))
        .status,
    ).toBe(403);
    // A live character is not in the bin.
    const live = await createCharacter(owner.accessToken);
    expect((await call(owner.accessToken, 'POST', `/characters/${live.id}/restore`)).status).toBe(
      404,
    );
    expect(
      (await call(owner.accessToken, 'DELETE', `/recycle-bin/characters/${live.id}`)).status,
    ).toBe(404);
  });

  it('Delete now removes the character for good and records a tombstone', async () => {
    const owner = await createTestActor('bin-purge');
    const character = await createCharacter(owner.accessToken);
    await call(owner.accessToken, 'DELETE', `/characters/${character.id}`);
    expect(
      (await call(owner.accessToken, 'DELETE', `/recycle-bin/characters/${character.id}`)).status,
    ).toBe(204);
    expect(
      await getDb().select().from(characters).where(eq(characters.id, character.id)),
    ).toHaveLength(0);
    expect(
      await getDb()
        .select()
        .from(entityTombstones)
        .where(eq(entityTombstones.entityId, character.id)),
    ).toHaveLength(1);
  });

  it('refuses permanent deletion to delegated agents but allows restore', async () => {
    const owner = await createTestActor('bin-agent');
    const character = await createCharacter(owner.accessToken);
    await call(owner.accessToken, 'DELETE', `/characters/${character.id}`);
    const user = {
      id: owner.userId,
      email: owner.email,
      displayName: 'Agent owner',
      suspendedAt: null,
      authMethod: 'oauth' as const,
      authVersion: 0,
      authenticatedAt: null,
    };
    const agent = (method: string, path: string) => {
      const request = new Request(`https://gpc.internal/api/v1${path}`, { method });
      attachTrustedExecution(request, {
        user,
        oauthClientDbId: crypto.randomUUID(),
        oauthClientId: 'test-agent',
        oauthGrantId: crypto.randomUUID(),
        scopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
      });
      return app.fetch(request);
    };
    const refused = await agent('DELETE', `/recycle-bin/characters/${character.id}`);
    expect(refused.status).toBe(403);
    expect(
      await getDb().select().from(characters).where(eq(characters.id, character.id)),
    ).toHaveLength(1);
    expect((await agent('POST', `/characters/${character.id}/restore`)).status).toBe(204);
  });

  it('is never purged before 30 days, and purged with its children after', async () => {
    const owner = await createTestActor('bin-sweep');
    const early = await createCharacter(owner.accessToken);
    const due = await createCharacter(owner.accessToken);
    const rescued = await createCharacter(owner.accessToken);
    for (const character of [early, due, rescued])
      await call(owner.accessToken, 'POST', `/characters/${character.id}/traits`, {
        name: 'Alertness',
        kind: 'advantage',
        points: 5,
      });
    for (const character of [early, due, rescued])
      await call(owner.accessToken, 'DELETE', `/characters/${character.id}`);
    await backdate(characters, early.id, '29 days 23 hours');
    await backdate(characters, due.id, '30 days 1 minute');
    await backdate(characters, rescued.id, '45 days');
    // A restore that lands before the sweep always wins, however old the bin entry.
    await call(owner.accessToken, 'POST', `/characters/${rescued.id}/restore`);

    await sweepRecycleBin();
    const exists = async (id: string) =>
      (await getDb().select().from(characters).where(eq(characters.id, id))).length === 1;
    expect(await exists(early.id)).toBe(true);
    expect(await exists(rescued.id)).toBe(true);
    expect(await exists(due.id)).toBe(false);
    expect(
      await getDb().select().from(characterTraits).where(eq(characterTraits.characterId, due.id)),
    ).toHaveLength(0);
    expect(
      await getDb().select().from(entityTombstones).where(eq(entityTombstones.entityId, due.id)),
    ).toHaveLength(1);
    // Sweeping again is a no-op for what remains.
    await sweepRecycleBin();
    expect(await exists(early.id)).toBe(true);
  });
});

describe('recycle bin: campaigns', () => {
  it('bins a campaign, releases its characters, and restores both', async () => {
    const owner = await createTestActor('bin-camp-owner');
    const player = await createTestActor('bin-camp-player');
    const campaign = await createCampaign(owner.accessToken);
    await addMember(owner.accessToken, campaign.id, player.email);
    const mine = await createCharacter(player.accessToken, { campaignId: campaign.id });

    expect((await call(owner.accessToken, 'DELETE', `/campaigns/${campaign.id}`)).status).toBe(204);
    expect((await call(player.accessToken, 'GET', `/campaigns/${campaign.id}`)).status).toBe(404);
    expect((await call(owner.accessToken, 'GET', `/campaigns/${campaign.id}`)).status).toBe(404);
    for (const token of [owner.accessToken, player.accessToken]) {
      const list = (await (await call(token, 'GET', '/campaigns')).json()) as { id: string }[];
      expect(list.some((row) => row.id === campaign.id)).toBe(false);
      expect((await accessible(token)).campaignIds).not.toContain(campaign.id);
    }
    // The player keeps their character, now campaign-less.
    const released = (await (
      await call(player.accessToken, 'GET', `/characters/${mine.id}`)
    ).json()) as {
      campaignId: string | null;
    };
    expect(released.campaignId).toBeNull();
    // Only the owner can see or restore the campaign.
    const entry = (await bin(owner.accessToken)).campaigns.find((row) => row.id === campaign.id);
    expect(entry?.characterCount).toBe(1);
    expect((await bin(player.accessToken)).campaigns).toHaveLength(0);
    expect(
      (await call(player.accessToken, 'POST', `/campaigns/${campaign.id}/restore`)).status,
    ).toBe(403);

    expect(
      (await call(owner.accessToken, 'POST', `/campaigns/${campaign.id}/restore`)).status,
    ).toBe(204);
    expect((await call(player.accessToken, 'GET', `/campaigns/${campaign.id}`)).status).toBe(200);
    expect((await accessible(player.accessToken)).campaignIds).toContain(campaign.id);
    const reattached = (await (
      await call(player.accessToken, 'GET', `/characters/${mine.id}`)
    ).json()) as {
      campaignId: string | null;
    };
    expect(reattached.campaignId).toBe(campaign.id);
  });

  it('does not re-attach a character that joined another campaign meanwhile or left the campaign', async () => {
    const owner = await createTestActor('bin-camp-reattach');
    const player = await createTestActor('bin-camp-reattach-p');
    const campaign = await createCampaign(owner.accessToken);
    const other = await createCampaign(player.accessToken);
    await addMember(owner.accessToken, campaign.id, player.email);
    const moved = await createCharacter(player.accessToken, { campaignId: campaign.id });
    const removed = await createCharacter(player.accessToken, { campaignId: campaign.id });
    await call(owner.accessToken, 'DELETE', `/campaigns/${campaign.id}`);
    expect(
      (await call(player.accessToken, 'PATCH', `/characters/${moved.id}`, { campaignId: other.id }))
        .status,
    ).toBe(200);
    // The player is no longer a member by the time the campaign returns.
    await getDb()
      .delete(campaignMemberships)
      .where(
        and(
          eq(campaignMemberships.campaignId, campaign.id),
          eq(campaignMemberships.userId, player.userId),
        ),
      );
    await call(owner.accessToken, 'POST', `/campaigns/${campaign.id}/restore`);
    const campaignOf = async (id: string) =>
      (await getDb().select().from(characters).where(eq(characters.id, id)))[0]?.campaignId;
    expect(await campaignOf(moved.id)).toBe(other.id);
    expect(await campaignOf(removed.id)).toBeNull();
  });

  it('hides pending invitations and refuses to accept one until the campaign is restored', async () => {
    const owner = await createTestActor('bin-invite-owner');
    const invitee = await createTestActor('bin-invite-guest');
    const campaign = await createCampaign(owner.accessToken);
    const invited = await call(owner.accessToken, 'POST', `/campaigns/${campaign.id}/invitations`, {
      handle: invitee.email,
    });
    expect(invited.status).toBe(201);
    const { id: invitationId } = (await invited.json()) as { id: string };
    const pending = async () =>
      (
        (await (await call(invitee.accessToken, 'GET', '/invitations')).json()) as { id: string }[]
      ).map((row) => row.id);
    expect(await pending()).toContain(invitationId);

    await call(owner.accessToken, 'DELETE', `/campaigns/${campaign.id}`);
    expect(await pending()).not.toContain(invitationId);
    const refused = await call(invitee.accessToken, 'POST', `/invitations/${invitationId}/accept`);
    expect(refused.status).toBe(404);
    expect(
      await getDb()
        .select()
        .from(campaignMemberships)
        .where(
          and(
            eq(campaignMemberships.campaignId, campaign.id),
            eq(campaignMemberships.userId, invitee.userId),
          ),
        ),
    ).toHaveLength(0);

    await call(owner.accessToken, 'POST', `/campaigns/${campaign.id}/restore`);
    expect(await pending()).toContain(invitationId);
    expect(
      (await call(invitee.accessToken, 'POST', `/invitations/${invitationId}/accept`)).status,
    ).toBe(200);
  });

  it('Delete now removes a binned campaign; a live campaign cannot be purged', async () => {
    const owner = await createTestActor('bin-camp-purge');
    const campaign = await createCampaign(owner.accessToken);
    const live = await createCampaign(owner.accessToken);
    expect(
      (await call(owner.accessToken, 'DELETE', `/recycle-bin/campaigns/${live.id}`)).status,
    ).toBe(404);
    await call(owner.accessToken, 'DELETE', `/campaigns/${campaign.id}`);
    expect(
      (await call(owner.accessToken, 'DELETE', `/recycle-bin/campaigns/${campaign.id}`)).status,
    ).toBe(204);
    expect(
      await getDb().select().from(campaigns).where(eq(campaigns.id, campaign.id)),
    ).toHaveLength(0);
  });

  it('sweeps a campaign only after 30 days, keeping its released characters', async () => {
    const owner = await createTestActor('bin-camp-sweep');
    const early = await createCampaign(owner.accessToken);
    const due = await createCampaign(owner.accessToken);
    const hero = await createCharacter(owner.accessToken, { campaignId: due.id });
    await call(owner.accessToken, 'DELETE', `/campaigns/${early.id}`);
    await call(owner.accessToken, 'DELETE', `/campaigns/${due.id}`);
    await backdate(campaigns, early.id, '29 days 23 hours');
    await backdate(campaigns, due.id, '31 days');
    await sweepRecycleBin();
    expect(await getDb().select().from(campaigns).where(eq(campaigns.id, early.id))).toHaveLength(
      1,
    );
    expect(await getDb().select().from(campaigns).where(eq(campaigns.id, due.id))).toHaveLength(0);
    expect(await getDb().select().from(characters).where(eq(characters.id, hero.id))).toHaveLength(
      1,
    );
  });
});
