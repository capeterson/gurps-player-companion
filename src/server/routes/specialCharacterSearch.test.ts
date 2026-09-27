import { beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { getDb } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);
const PASSWORD = 'TestPassword1!';
let adminToken = '';

function jsonHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function register(displayName: string) {
  const email = `special-search-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, displayName }),
  });
  expect(response.status).toBe(201);
  return { email, accessToken: ((await response.json()) as { accessToken: string }).accessToken };
}

async function createCampaign(token: string, name: string) {
  const response = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function createCharacter(token: string, name: string) {
  const response = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function queryIds<T extends { id: string }>(
  token: string,
  path: string,
  searchKey: 'search' | 'q',
  search: string,
): Promise<string[]> {
  const query = new URLSearchParams({ [searchKey]: search });
  const response = await app.request(`${path}?${query}`, { headers: jsonHeaders(token) });
  expect(response.status).toBe(200);
  const body = await response.json();
  const rows = Array.isArray(body) ? body : (body as { items: T[] }).items;
  return (rows as T[]).map((row) => row.id);
}

describe('literal special characters in server search filters', () => {
  beforeAll(async () => {
    const admin = await register(`Special Search Admin ${Date.now()}`);
    const [adminRow] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, admin.email));
    if (!adminRow) throw new Error('registered search admin was not persisted');
    await getDb().update(users).set({ isSuperuser: true }).where(eq(users.id, adminRow.id));
    adminToken = admin.accessToken;
  });

  it.each([
    { marker: '%', searchMiddle: '%', distractorMiddle: 'X' },
    { marker: '_', searchMiddle: '_', distractorMiddle: 'X' },
    { marker: 'backslash', searchMiddle: '\\', distractorMiddle: '' },
    {
      marker: 'quotes, ampersand, and Unicode',
      searchMiddle: "O'Brien & café 東京",
      distractorMiddle: 'other',
    },
    { marker: 'plus and hash', searchMiddle: '+#', distractorMiddle: 'other' },
  ])(
    'treats $marker as literal text across all searchable list endpoints',
    async (testCase) => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const query = `LiteralSearch${suffix}A${testCase.searchMiddle}B`;
      const targetName = query;
      const distractorName = `LiteralSearch${suffix}A${testCase.distractorMiddle}B`;
      const targetAccount = await register(targetName);
      const distractorAccount = await register(distractorName);
      const [targetAccountRow, distractorAccountRow] = await Promise.all(
        [targetAccount.email, distractorAccount.email].map(async (email) => {
          const [row] = await getDb()
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, email));
          if (!row) throw new Error(`registered user ${email} was not persisted`);
          return row;
        }),
      );
      if (!targetAccountRow || !distractorAccountRow) {
        throw new Error('Both search fixture accounts must exist');
      }

      const targetCampaign = await createCampaign(adminToken, targetName);
      const distractorCampaign = await createCampaign(adminToken, distractorName);
      const targetCharacter = await createCharacter(adminToken, targetName);
      const distractorCharacter = await createCharacter(adminToken, distractorName);

      for (const [campaign, name] of [
        [targetCampaign, targetName],
        [distractorCampaign, distractorName],
      ] as const) {
        const encounter = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
          method: 'POST',
          headers: jsonHeaders(adminToken),
          body: JSON.stringify({ name, combatants: [] }),
        });
        expect(encounter.status).toBe(201);
        const logEntry = await app.request(`/api/v1/campaigns/${campaign.id}/log`, {
          method: 'POST',
          headers: jsonHeaders(adminToken),
          body: JSON.stringify({ title: name, sessionDate: '2026-09-27' }),
        });
        expect(logEntry.status).toBe(201);
      }

      const targetEncounterList = await app.request(
        `/api/v1/campaigns/${targetCampaign.id}/encounters?${new URLSearchParams({ search: query })}`,
        { headers: jsonHeaders(adminToken) },
      );
      expect(targetEncounterList.status).toBe(200);
      const targetEncounters = (await targetEncounterList.json()) as { id: string; name: string }[];
      const distractorEncounterList = await app.request(
        `/api/v1/campaigns/${distractorCampaign.id}/encounters?${new URLSearchParams({ search: query })}`,
        { headers: jsonHeaders(adminToken) },
      );
      expect(distractorEncounterList.status).toBe(200);
      expect(targetEncounters).toHaveLength(1);
      expect(await distractorEncounterList.json()).toEqual([]);

      const targetLogList = await app.request(
        `/api/v1/campaigns/${targetCampaign.id}/log?${new URLSearchParams({ search: query })}`,
        { headers: jsonHeaders(adminToken) },
      );
      expect(targetLogList.status).toBe(200);
      const targetLogs = (await targetLogList.json()) as { title: string }[];
      const distractorLogList = await app.request(
        `/api/v1/campaigns/${distractorCampaign.id}/log?${new URLSearchParams({ search: query })}`,
        { headers: jsonHeaders(adminToken) },
      );
      expect(distractorLogList.status).toBe(200);
      expect(targetLogs.map((entry) => entry.title)).toEqual([targetName]);
      expect(await distractorLogList.json()).toEqual([]);

      const characterIds = await queryIds(adminToken, '/api/v1/characters', 'search', query);
      expect(characterIds).toContain(targetCharacter.id);
      expect(characterIds).not.toContain(distractorCharacter.id);
      const campaignIds = await queryIds(adminToken, '/api/v1/campaigns', 'search', query);
      expect(campaignIds).toContain(targetCampaign.id);
      expect(campaignIds).not.toContain(distractorCampaign.id);
      const adminUserIds = await queryIds(adminToken, '/api/v1/admin/users', 'q', query);
      expect(adminUserIds).toContain(targetAccountRow.id);
      expect(adminUserIds).not.toContain(distractorAccountRow.id);
      const adminCampaignIds = await queryIds(adminToken, '/api/v1/admin/campaigns', 'q', query);
      expect(adminCampaignIds).toContain(targetCampaign.id);
      expect(adminCampaignIds).not.toContain(distractorCampaign.id);
    },
    { timeout: 20_000 },
  );
});
