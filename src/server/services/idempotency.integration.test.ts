import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { closeDb, getDb } from '../db/client.ts';
import { adventureLogEntries, authRateLimits, characters, encounters } from '../db/schema.ts';
import { integrationTestConfig } from '../testConfig.ts';

describe('durable mutation idempotency', () => {
  beforeEach(async () => getDb().delete(authRateLimits));
  afterAll(closeDb);

  it('serializes concurrent creates and replays the committed response', async () => {
    const app = createApp(integrationTestConfig);
    const name = `Idempotent ${randomUUID()}`;
    const registered = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `${randomUUID()}@example.com`,
        password: 'TestPassword1!',
        displayName: 'Retry Player',
      }),
    });
    const token = ((await registered.json()) as { accessToken: string }).accessToken;
    const malformed = await app.request('/api/v1/characters/not-a-uuid', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({ name: 'invalid path' }),
    });
    expect(malformed.status).toBe(422);
    const key = randomUUID();
    const create = (bodyName = name) =>
      app.request('/api/v1/characters', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({ name: bodyName }),
      });
    const [first, second] = await Promise.all([create(), create()]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).toBe(firstBody.id);
    expect([
      first.headers.get('idempotency-replayed'),
      second.headers.get('idempotency-replayed'),
    ]).toContain('true');
    const stored = await getDb()
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.name, name));
    expect(stored).toHaveLength(1);

    const conflict = await create(`${name} changed`);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: 'idempotency_key_reused_with_different_input',
    });
  });

  it('replays import, XP log, and encounter advance outcomes without applying them twice', async () => {
    const app = createApp(integrationTestConfig);
    const registered = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `${randomUUID()}@example.com`,
        password: 'TestPassword1!',
        displayName: 'Lost Response',
      }),
    });
    const token = ((await registered.json()) as { accessToken: string }).accessToken;
    const headers = (key?: string) => ({
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(key ? { 'idempotency-key': key } : {}),
    });
    const campaignResponse = await app.request('/api/v1/campaigns', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: `Lost ${randomUUID()}` }),
    });
    const campaign = (await campaignResponse.json()) as { id: string };
    const characterResponse = await app.request('/api/v1/characters', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'Award target', campaignId: campaign.id }),
    });
    const character = (await characterResponse.json()) as { id: string };

    const exported = await app.request(`/api/v1/campaigns/${campaign.id}/library/export`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const yaml = await exported.text();
    const importKey = randomUUID();
    const importLibrary = () =>
      app.request(`/api/v1/campaigns/${campaign.id}/library/import`, {
        method: 'POST',
        headers: headers(importKey),
        body: JSON.stringify({ yaml, mode: 'merge' }),
      });
    const imported = await importLibrary();
    const importedBody = await imported.text();
    const importedReplay = await importLibrary();
    expect(imported.status).toBe(200);
    expect(importedReplay.status).toBe(200);
    expect(importedReplay.headers.get('idempotency-replayed')).toBe('true');
    expect(await importedReplay.text()).toBe(importedBody);

    const logKey = randomUUID();
    const title = `One XP award ${randomUUID()}`;
    const createLog = () =>
      app.request(`/api/v1/campaigns/${campaign.id}/log`, {
        method: 'POST',
        headers: headers(logKey),
        body: JSON.stringify({
          sessionDate: '2026-09-12',
          title,
          xpAwards: [{ characterId: character.id, amount: 3 }],
        }),
      });
    const log = await createLog();
    const logReplay = await createLog();
    expect(log.status).toBe(201);
    expect(logReplay.status).toBe(201);
    expect(logReplay.headers.get('idempotency-replayed')).toBe('true');
    expect(
      await getDb().select().from(adventureLogEntries).where(eq(adventureLogEntries.title, title)),
    ).toHaveLength(1);

    const encounterResponse = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'One advance',
        combatants: [{ kind: 'npc', name: 'Orc', basicSpeed: 5, dx: 10, maxHp: 10 }],
      }),
    });
    const encounter = (await encounterResponse.json()) as {
      id: string;
      round: number;
      activeCombatantId: string | null;
      version: number;
    };
    const advanceKey = randomUUID();
    const advanceBody = JSON.stringify({
      direction: 'next',
      expectedRound: encounter.round,
      expectedActiveCombatantId: encounter.activeCombatantId,
      expectedVersion: encounter.version,
    });
    const advance = () =>
      app.request(`/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}/advance`, {
        method: 'POST',
        headers: headers(advanceKey),
        body: advanceBody,
      });
    const advanced = await advance();
    const advancedBody = await advanced.text();
    const advancedReplay = await advance();
    expect(advanced.status).toBe(200);
    expect(advancedReplay.status).toBe(200);
    expect(advancedReplay.headers.get('idempotency-replayed')).toBe('true');
    expect(await advancedReplay.text()).toBe(advancedBody);
    const [storedEncounter] = await getDb()
      .select({ version: encounters.version })
      .from(encounters)
      .where(eq(encounters.id, encounter.id));
    expect(storedEncounter?.version).toBe(encounter.version + 1);
  });

  it('refuses to disclose a cached response after the actor loses its authority', async () => {
    const app = createApp(integrationTestConfig);
    const register = async (label: string) => {
      const email = `${label}-${randomUUID()}@example.com`;
      const response = await app.request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'TestPassword1!', displayName: label }),
      });
      const body = (await response.json()) as { accessToken: string };
      const me = await app.request('/api/v1/auth/me', {
        headers: { authorization: `Bearer ${body.accessToken}` },
      });
      return { email, token: body.accessToken, id: ((await me.json()) as { id: string }).id };
    };
    const owner = await register('permission-owner');
    const replacement = await register('permission-replacement');
    const key = randomUUID();
    const create = () =>
      app.request('/api/v1/campaigns', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({ name: `Private result ${key}` }),
      });
    const createdResponse = await create();
    const created = (await createdResponse.json()) as { id: string };
    await app.request(`/api/v1/campaigns/${created.id}/members`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: replacement.email }),
    });
    const transferred = await app.request(`/api/v1/campaigns/${created.id}/transfer`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ newOwnerId: replacement.id }),
    });
    expect(transferred.status).toBe(200);
    const replay = await create();
    expect(replay.status).toBe(409);
    expect(replay.headers.get('idempotency-replayed')).toBeNull();
    expect(await replay.json()).toMatchObject({
      error: expect.stringContaining('permissions_changed'),
    });
  });
});
