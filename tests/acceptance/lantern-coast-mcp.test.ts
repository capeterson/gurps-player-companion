import { afterAll, describe, expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../../src/server/app.ts';
import { signAccessToken } from '../../src/server/auth/jwt.ts';
import { withAudit } from '../../src/server/db/auditContext.ts';
import { closeDb, getDb, runInDbTransaction } from '../../src/server/db/client.ts';
import {
  campaigns,
  characters,
  entityHistory,
  oauthAccessTokens,
  oauthClients,
  oauthGrants,
  users,
} from '../../src/server/db/schema.ts';
import { ensureDemoUser } from '../../src/server/db/seeds/accounts.ts';
import { seedLanternCoast } from '../../src/server/db/seeds/lanternCoast.ts';
import {
  type LanternRequest,
  populateLanternCoast,
} from '../../src/server/db/seeds/lanternCoastContent.ts';
import {
  lanternCharacters,
  lanternSharedLogs,
} from '../../src/server/db/seeds/lanternCoastData.ts';
import { lanternMcpRequest } from '../../src/server/db/seeds/lanternCoastMcp.ts';
import { mcpResource } from '../../src/server/oauth/service.ts';
import { DEFAULT_CAMPAIGN_SOURCES } from '../../src/server/services/defaultCampaignSources.ts';
import {
  configureIntegrationTestEnvironment,
  integrationTestConfig,
} from '../../src/server/testConfig.ts';
import { adventureLogOut } from '../../src/shared/schemas/adventureLog.ts';
import { librarySkillOut, libraryTraitOut } from '../../src/shared/schemas/campaignLibrary.ts';
import { characterDetail } from '../../src/shared/schemas/character.ts';
import { parseLibraryYaml } from '../../src/shared/yaml/library.ts';

configureIntegrationTestEnvironment();
afterAll(closeDb);
const config = { ...integrationTestConfig, appHostname: 'localhost', port: 3001 };
const app = createApp(config);
const resource = mcpResource(config);

async function restRequest(userId: string): Promise<LanternRequest> {
  const { token } = await signAccessToken(userId);
  return async (_actor, path, method = 'POST', body?: unknown) => {
    const response = await app.request(`/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${method} ${path}: ${await response.clone().text()}`).toBe(true);
    return response.json();
  };
}

async function snapshot(
  request: LanternRequest,
  campaignId: string,
  privateReaderFor?: (userId: string) => Promise<LanternRequest>,
) {
  const base = `/campaigns/${campaignId}`;
  const campaign = await request('', base, 'GET');
  const library = await request('', `${base}/library`, 'GET');
  const roster = await getDb()
    .select()
    .from(characters)
    .where(eq(characters.campaignId, campaignId));
  const sheets = [];
  for (const row of roster) sheets.push(await request('', `/characters/${row.id}`, 'GET'));
  const visibleLogs = (await request('', `${base}/log`, 'GET')) as { id: string }[];
  const logRows = new Map(visibleLogs.map((log) => [log.id, log]));
  // A GM cannot read other players' private notes. The multi-user reference
  // collects each author's own visible feed instead of bypassing that guard.
  if (privateReaderFor) {
    for (const userId of new Set(roster.map((row) => row.ownerId))) {
      const read = await privateReaderFor(userId);
      const ownFeed = (await read('', `${base}/log`, 'GET')) as { id: string }[];
      for (const log of ownFeed) logRows.set(log.id, log);
    }
  }
  const logs = [...logRows.values()];
  const encounters = (await request('', `${base}/encounters`, 'GET')) as { id: string }[];
  const encounterDetails = [];
  for (const entry of encounters)
    encounterDetails.push(await request('', `${base}/encounters/${entry.id}`, 'GET'));
  return { campaign, library, sheets, logs, encounters: encounterDetails };
}

/** Keep actual fields, calculations and relationships; normalize only generated
 * identity/revisions/timestamps and the explicitly allowed ownership difference.
 */
function normalize(value: unknown) {
  const labels = new Map<string, string>();
  const collect = (entry: unknown, scope = 'graph'): void => {
    if (Array.isArray(entry)) {
      for (const child of entry) collect(child, scope);
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    const object = entry as Record<string, unknown>;
    let childScope = scope;
    if (typeof object.id === 'string' && /^[0-9a-f-]{36}$/i.test(object.id)) {
      const label = object.name ?? object.title ?? 'row';
      childScope = `${scope}:${String(label)}`;
      labels.set(object.id, childScope);
    }
    for (const [key, child] of Object.entries(object)) collect(child, `${childScope}.${key}`);
  };
  collect(value);
  const ignored = new Set([
    'createdAt',
    'updatedAt',
    'revision',
    'sourceRevision',
    'definitionRevision',
    'ownerId',
    'authorId',
    'authorDisplayName',
    'createdById',
    'members',
    'agentClientId',
    'agentGrantId',
  ]);
  const collectionKeys = new Set([
    'sheets',
    'logs',
    'encounters',
    'traits',
    'skills',
    'spells',
    'languages',
    'techniques',
    'styles',
    'inventory',
    'items',
    'sources',
    'modifiers',
    'enchantments',
    'activeEffects',
    'combatants',
    'warnings',
    'capabilities',
  ]);
  // Racial contribution IDs are derived: a character ID prefix plus a stable hash
  // of the race component key (characterDetail racialId).
  const prefixes = new Map([...labels].map(([id, label]) => [id.slice(0, 24), label]));
  const reference = (id: string) => {
    const label = labels.get(id);
    if (label) return `ref:${label}`;
    const owner = prefixes.get(id.slice(0, 24));
    return owner ? `ref:${owner}#${id.slice(24)}` : id;
  };
  const visit = (entry: unknown, key = ''): unknown => {
    if (typeof entry === 'string')
      return entry.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        reference,
      );
    if (Array.isArray(entry)) {
      const result = entry.map((child) => visit(child));
      return collectionKeys.has(key)
        ? result.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : result;
    }
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(
      Object.entries(entry)
        .filter(([key]) => !ignored.has(key))
        .map(([key, child]) => [key, visit(child, key)]),
    );
  };
  return visit(value);
}

describe('Lantern Coast MCP seed acceptance', () => {
  it('creates the same complete campaign graph through authenticated MCP, with one existing owner', async () => {
    const yaml = await readFile(
      new URL('../../bootstrap/lantern_coast.yaml', import.meta.url),
      'utf8',
    );
    const document = parseLibraryYaml(yaml);
    expect(document.library.skills).toHaveLength(48);
    expect(document.library.traits).toHaveLength(30);
    const sources = document.library.sources ?? [];
    expect(sources).toHaveLength(4);
    expect(new Set(sources.map((source) => source.abbreviation)).size).toBe(4);
    expect(
      sources.every(
        (source) =>
          !DEFAULT_CAMPAIGN_SOURCES.some(
            (published) => published.abbreviation === source.abbreviation,
          ),
      ),
    ).toBe(true);
    for (const section of [
      'traits',
      'skills',
      'spells',
      'items',
      'languages',
      'techniques',
      'styles',
      'enchantments',
      'activeEffects',
      'modifiers',
    ] as const) {
      const entries = document.library[section];
      expect(
        entries?.every((entry) => sources.some((source) => source.key === entry.sourceKey)),
      ).toBe(true);
    }
    let reference: Awaited<ReturnType<typeof snapshot>> | undefined;
    const rollback = new Error('rollback REST reference');
    try {
      await runInDbTransaction(async () => {
        const gm = await ensureDemoUser(
          `lantern-reference-${randomUUID()}@example.invalid`,
          'Reference GM',
        );
        const seeded = await seedLanternCoast(gm.id, yaml);
        reference = await snapshot(await restRequest(gm.id), seeded.campaignId, restRequest);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    if (!reference) throw new Error('REST reference was not captured');

    const owner = await ensureDemoUser(`lantern-mcp-${randomUUID()}@example.invalid`, 'MCP GM');
    const [client] = await getDb()
      .insert(oauthClients)
      .values({
        clientId: `lantern-mcp-${randomUUID()}`,
        name: 'Lantern recipe acceptance',
        registrationMethod: 'dynamic',
        redirectUris: ['http://localhost:3001/oauth/callback'],
        allowedScopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
      })
      .returning();
    if (!client) throw new Error('Missing MCP client');
    const [grant] = await getDb()
      .insert(oauthGrants)
      .values({
        userId: owner.id,
        clientId: client.id,
        scopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
        resource,
        authVersion: owner.authVersion,
      })
      .returning();
    if (!grant) throw new Error('Missing MCP grant');
    const bearer = `gpco_${randomUUID()}`;
    await getDb()
      .insert(oauthAccessTokens)
      .values({
        grantId: grant.id,
        tokenHash: createHash('sha256').update(bearer).digest('hex'),
        scopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
        expiresAt: new Date(Date.now() + 600_000),
      });
    const userIdsBefore = (await getDb().select({ id: users.id }).from(users))
      .map((row) => row.id)
      .sort();
    let rpcId = 0;
    let batchStarted = Date.now();
    let batchCalls = 0;
    const called = new Set<string>();
    const rpc = async (method: string, params: unknown) => {
      // Respect the production 120/minute budget. No limiter reset, clock mock,
      // additional client, or raised server limit is used for this recipe.
      if (batchCalls === 110) {
        await Bun.sleep(Math.max(0, 60_100 - (Date.now() - batchStarted)));
        batchCalls = 0;
        batchStarted = Date.now();
      }
      batchCalls++;
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      });
      expect(
        response.status,
        `${method} ${JSON.stringify(params)}: ${await response.clone().text()}`,
      ).toBe(200);
      const envelope = (await response.json()) as {
        error?: unknown;
        result?: Record<string, unknown>;
      };
      expect(envelope.error).toBeUndefined();
      if (!envelope.result) throw new Error(`Missing ${method} result`);
      return envelope.result;
    };
    const request = lanternMcpRequest(async (name, args) => {
      called.add(name);
      const result = await rpc('tools/call', { name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const structured = result.structuredContent as { status: number; body: unknown } | undefined;
      if (!structured) throw new Error(`Missing ${name} structured result`);
      return structured;
    });
    try {
      const initialized = await rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'Lantern acceptance', version: '1' },
      });
      expect(initialized.protocolVersion).toBe('2025-11-25');
      const listing = await rpc('tools/list', {});
      const result = await populateLanternCoast({
        yaml,
        request,
        ownerActor: owner.id,
        playerFor: async () => owner.id,
        nextEffectId: async () => randomUUID(),
      });
      const actual = await snapshot(request, result.campaignId);
      expect(actual.sheets).toHaveLength(6);
      const logs = adventureLogOut.array().parse(actual.logs);
      expect(logs).toHaveLength(23);
      expect(logs.filter((log) => log.visibility === 'private')).toHaveLength(18);
      expect(logs.filter((log) => log.visibility === 'campaign')).toHaveLength(5);
      const sheets = characterDetail.array().parse(actual.sheets);
      for (const sheet of sheets) {
        expect(sheet.skills.length, sheet.name).toBeGreaterThanOrEqual(12);
        expect(sheet.skills.length, sheet.name).toBeLessThanOrEqual(15);
        expect(sheet.traits.length, sheet.name).toBeGreaterThanOrEqual(6);
        expect(sheet.traits.length, sheet.name).toBeLessThanOrEqual(8);
        expect(sheet.earnedPoints, sheet.name).toBe(6);
        expect(sheet.points.total, sheet.name).toBeLessThanOrEqual(250 + 6);
        expect(sheet.points.unspent, sheet.name).toBe(250 + 6 - sheet.points.total);
        expect(-sheet.points.disadvantages, sheet.name).toBeLessThanOrEqual(50);
        expect(-sheet.points.quirks, sheet.name).toBeLessThanOrEqual(5);
        const fixture = lanternCharacters.find((entry) => entry.character.name === sheet.name);
        if (!fixture) throw new Error(`Missing authored logs for ${sheet.name}`);
        const privateLogs = logs.filter(
          (log) => log.visibility === 'private' && log.characterId === sheet.id,
        );
        expect(privateLogs, sheet.name).toHaveLength(3);
        for (const expected of fixture.privateLogs) {
          const saved = privateLogs.find((log) => log.title === expected.title);
          expect(saved, expected.title).toBeDefined();
          expect(saved).toMatchObject({
            body: expected.body,
            sessionDate: expected.sessionDate,
            sessionNumber: expected.sessionNumber,
            location: expected.location,
            authorId: owner.id,
          });
          expect(saved?.body.trim(), expected.title).toBeTruthy();
          expect(saved?.body, expected.title).not.toContain(
            'I have not told the others what the beacon showed me.',
          );
        }
      }
      // Race choices travel through the same MCP character update as other fields.
      expect(
        Object.fromEntries(sheets.map((sheet) => [sheet.name, sheet.race?.snapshot?.name ?? null])),
      ).toMatchObject({
        'Iona Reedwake': 'Selkie-blooded',
        'Orin Bellstrand': 'Fogward Shoalborn',
        'Mira Ashfall': 'Human · Tide-touched',
        'Kestrel Vale': null,
      });
      for (const expected of lanternSharedLogs) {
        const saved = logs.find(
          (log) => log.visibility === 'campaign' && log.title === expected.title,
        );
        expect(saved, expected.title).toBeDefined();
        expect(saved).toMatchObject({
          body: expected.body,
          sessionDate: expected.sessionDate,
          sessionNumber: expected.sessionNumber,
          location: expected.location,
        });
      }
      const library = actual.library as Record<string, unknown>;
      const skills = librarySkillOut.array().parse(library.skills);
      const traits = libraryTraitOut.array().parse(library.traits);
      expect(skills).toHaveLength(48);
      expect(traits).toHaveLength(30);
      for (const skill of skills) {
        expect(skill.description?.trim(), skill.name).toBeTruthy();
        expect(skill.description, skill.name).not.toContain('adjudicate task scope at the table');
        expect(skill.procedures?.actions.length, skill.name).toBeGreaterThan(0);
        expect(skill.procedures?.modifiers.length, skill.name).toBeGreaterThan(0);
        for (const action of skill.procedures?.actions ?? []) {
          expect(action.outcomes.length, skill.name).toBeGreaterThan(0);
          for (const outcome of action.outcomes)
            expect(outcome.text.trim(), skill.name).toBeTruthy();
        }
      }
      for (const trait of traits) expect(trait.description?.trim(), trait.name).toBeTruthy();
      const roster = await getDb()
        .select()
        .from(characters)
        .where(eq(characters.campaignId, result.campaignId));
      expect(roster.every((character) => character.ownerId === owner.id)).toBe(true);
      expect(roster.map((character) => character.name).sort()).toEqual(
        lanternCharacters.map((entry) => entry.character.name).sort(),
      );
      expect(
        (await getDb().select({ id: users.id }).from(users)).map((row) => row.id).sort(),
      ).toEqual(userIdsBefore);
      expect(normalize(actual)).toEqual(normalize(reference));
      const events = await getDb()
        .select()
        .from(entityHistory)
        .where(eq(entityHistory.campaignId, result.campaignId));
      expect(events.length).toBeGreaterThan(200);
      expect(
        events.every(
          (event) =>
            event.actorUserId === owner.id &&
            event.agentClientId === client.id &&
            event.agentGrantId === grant.id,
        ),
      ).toBe(true);
      const names = (listing.tools as { name: string }[]).map((tool) => tool.name);
      expect([...called].every((name) => names.includes(name))).toBe(true);
    } finally {
      // Every MCP operation commits normally, so the actual protocol deadline and
      // limiter apply. Clean only this test's graph after success or failure.
      await runInDbTransaction(async () => {
        const created = await getDb()
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(eq(campaigns.ownerId, owner.id));
        await withAudit(owner.id, undefined, async (tx) => {
          await tx.delete(characters).where(eq(characters.ownerId, owner.id));
          await tx.delete(campaigns).where(eq(campaigns.ownerId, owner.id));
        });
        if (created.length)
          await getDb()
            .delete(entityHistory)
            .where(
              inArray(
                entityHistory.campaignId,
                created.map((entry) => entry.id),
              ),
            );
        await getDb().delete(oauthClients).where(eq(oauthClients.id, client.id));
        await getDb().delete(users).where(eq(users.id, owner.id));
      });
    }
  }, 240_000);
});
