import { afterAll, describe, expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { fixedCalculation } from '../../shared/domain/calculation.ts';
import type { LibraryTraitEffect, TraitEffect } from '../../shared/schemas/effects.ts';
import type { HistoryEventOut } from '../../shared/schemas/history.ts';
import type { OAuthScope } from '../../shared/schemas/oauth.ts';
import { parseLibraryYaml } from '../../shared/yaml/library.ts';
import { createApp } from '../app.ts';
import type { AppConfig } from '../config.ts';
import { closeDb, getDb, runInDbTransaction } from '../db/client.ts';
import { oauthClients, oauthGrants } from '../db/schema.ts';
import type { OAuthPrincipal } from '../oauth/service.ts';
import type { MediaStorage } from '../services/media/storage.ts';
import { setMediaStorageForTests } from '../services/media/storage.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { executeOperation } from './executor.ts';
import { TOOLS } from './operationManifest.ts';
import { createMcpHandler, mutationAcknowledgement } from './transport.ts';

configureIntegrationTestEnvironment();
process.env.MEDIA_S3_BUCKET = 'mcp-media-test';
process.env.MEDIA_S3_ACCESS_KEY = 'mcp-media-access';
process.env.MEDIA_S3_SECRET_KEY = 'mcp-media-secret';
process.env.MEDIA_UPLOADS_ENABLED = 'true';

const mediaObjects = new Map<string, Uint8Array>();
let failNextMediaPut = false;
const testMediaStorage: MediaStorage = {
  async put(key, bytes) {
    if (failNextMediaPut) {
      failNextMediaPut = false;
      throw new Error('injected storage outage');
    }
    mediaObjects.set(key, Uint8Array.from(bytes));
  },
  async get(key) {
    const bytes = mediaObjects.get(key);
    if (!bytes) throw new Error('media test object missing');
    return bytes;
  },
  async head(key) {
    return mediaObjects.get(key)?.length ?? 0;
  },
  async remove(key) {
    mediaObjects.delete(key);
  },
  async list(prefix) {
    return { keys: [...mediaObjects.keys()].filter((key) => key.startsWith(prefix)) };
  },
};
setMediaStorageForTests(testMediaStorage);

const config: AppConfig = {
  ...integrationTestConfig,
  appHostname: 'localhost',
  port: 3001,
  authRateLimitRegisterMax: 10_000,
  oauthClients: [],
};
const app = createApp(config);
const document = app.getOpenAPIDocument({
  openapi: '3.0.0',
  info: { title: 'GURPS Player Companion API', version: '0.1.0' },
});

interface Actor {
  email: string;
  accessToken: string;
  principal: OAuthPrincipal;
}

let activePrincipal: OAuthPrincipal;
let lastExecutionResult: { status: number; body: unknown; contentType: string | null } | null =
  null;
const handleMcp = createMcpHandler(config, app, document, {
  async resolvePrincipal() {
    return activePrincipal;
  },
  async execute(...args: Parameters<typeof executeOperation>) {
    const response = await executeOperation(...args);
    const clone = response.clone();
    const contentType = clone.headers.get('content-type');
    const text = await clone.text();
    lastExecutionResult = {
      status: clone.status,
      contentType,
      body: text.length === 0 ? null : contentType?.includes('json') ? JSON.parse(text) : text,
    };
    return response;
  },
});
const stableIds = new Set<string>();

interface OperationArgs {
  action?: string;
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  idempotencyKey?: string;
}

function policyFor(name: string, args: OperationArgs) {
  return TOOLS.find(
    (entry) => entry.tool === name && (entry.action ? entry.action === args.action : !args.action),
  );
}

class RestPreview extends Error {
  constructor(
    readonly result: {
      status: number;
      body: unknown;
      contentType: string | null;
    },
  ) {
    super(`REST preview ${result.status}`);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function rememberIds(value: unknown): void {
  if (typeof value === 'string') {
    if (isUuid(value)) stableIds.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) rememberIds(item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) rememberIds(item);
  }
}

function normalizeParity(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('/media/'))
      return value.replace(/\/media\/[a-f0-9]{64}\//, '/media/<token>/');
    if (isUuid(value)) return stableIds.has(value) ? value : '<new-uuid>';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return '<timestamp>';
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeParity(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        normalizeParity(child, childKey),
      ]),
    );
  }
  if (key === 'revision' && typeof value === 'number') return '<revision>';
  return value;
}

async function previewRest(
  actor: Actor,
  name: string,
  args: OperationArgs,
): Promise<{ status: number; body: unknown; contentType: string | null }> {
  const operation = policyFor(name, args);
  if (!operation) throw new Error(`missing manifest operation ${name} action=${args.action ?? ''}`);
  let pathname = operation.path;
  for (const [param, value] of Object.entries(args.path ?? {})) {
    pathname = pathname.replace(`{${param}}`, encodeURIComponent(String(value)));
  }
  const url = new URL(pathname, 'http://localhost:3001');
  for (const [param, value] of Object.entries(args.query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(param, String(item));
    } else url.searchParams.set(param, String(value));
  }
  try {
    await runInDbTransaction(async () => {
      const response = await app.fetch(
        new Request(url, {
          method: operation.method,
          headers: {
            authorization: `Bearer ${actor.accessToken}`,
            accept: 'application/json, application/yaml, text/yaml',
            ...(args.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(args.idempotencyKey ? { 'idempotency-key': String(args.idempotencyKey) } : {}),
          },
          ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
        }),
      );
      const contentType = response.headers.get('content-type');
      const text = await response.text();
      const body =
        text.length === 0 ? null : contentType?.includes('json') ? JSON.parse(text) : text;
      throw new RestPreview({ status: response.status, body, contentType });
    });
  } catch (error) {
    if (error instanceof RestPreview) return error.result;
    throw error;
  }
  throw new Error('REST preview did not roll back');
}

async function registerActor(label: string, clientDbId: string): Promise<Actor> {
  const email = `mcp-matrix-${label}-${randomUUID()}@example.com`;
  const registered = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'TestPassword1!',
      displayName: `Matrix ${label}`,
    }),
  });
  expect(registered.status).toBe(201);
  const { accessToken } = (await registered.json()) as { accessToken: string };
  const me = await app.request('/api/v1/auth/me', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const user = (await me.json()) as {
    id: string;
    email: string;
    displayName: string;
    suspendedAt: string | null;
  };
  const authVersion = 1;
  const [grant] = await getDb()
    .insert(oauthGrants)
    .values({
      userId: user.id,
      clientId: clientDbId,
      scopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
      resource: 'http://localhost:3001/mcp',
      authVersion,
    })
    .returning({ id: oauthGrants.id });
  if (!grant) throw new Error('grant insert failed');
  return {
    email,
    accessToken,
    principal: {
      user: {
        ...user,
        authVersion,
        suspendedAt: user.suspendedAt ? new Date(user.suspendedAt) : null,
        authMethod: 'oauth',
        authenticatedAt: Math.floor(Date.now() / 1000),
      },
      grantId: grant.id,
      clientDbId,
      clientId: 'mcp-parity-matrix',
      scopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
      expiresAt: new Date(Date.now() + 60_000),
      resource: 'http://localhost:3001/mcp',
      experimentalMcpUi: false,
    },
  };
}

let requestId = 0;
const exercised = new Set<string>();
async function call<T = unknown>(
  actor: Actor,
  name: string,
  args: OperationArgs = {},
): Promise<{ status: number; body: T; contentType: string | null; acknowledgement?: unknown }> {
  rememberIds(actor.principal.user.id);
  rememberIds(args);
  const operation = policyFor(name, args);
  if (!operation) throw new Error(`missing manifest operation ${name} action=${args.action ?? ''}`);
  const rest = await previewRest(actor, name, args);
  const result = await callAny(actor, name, args);
  expect(
    result.isError,
    `${name}: ${result.message}; raw=${JSON.stringify(lastExecutionResult)}`,
  ).not.toBe(true);
  expect(result.structured.status, name).toBeGreaterThanOrEqual(200);
  expect(result.structured.status, name).toBeLessThan(300);
  expect(result.structured.status, `${name} REST status parity`).toBe(rest.status);
  if (!result.raw) throw new Error(`${name} did not execute its shared handler`);
  expect(result.raw.status, `${name} raw REST status parity`).toBe(rest.status);
  expect(
    result.raw.contentType?.split(';', 1)[0] ?? null,
    `${name} raw REST content-type parity`,
  ).toBe(rest.contentType?.split(';', 1)[0] ?? null);
  expect(normalizeParity(result.raw.body), `${name} raw REST body parity`).toEqual(
    normalizeParity(rest.body),
  );
  expect(
    result.structured.contentType?.split(';', 1)[0] ?? null,
    `${name} REST content-type parity`,
  ).toBe(
    operation.method === 'GET' ? (rest.contentType?.split(';', 1)[0] ?? null) : 'application/json',
  );
  if (operation.method === 'GET') {
    expect(normalizeParity(result.structured.body), `${name} REST body parity`).toEqual(
      normalizeParity(rest.body),
    );
  } else {
    expect(result.structured.body, `${name} compact mutation acknowledgement`).toEqual(
      mutationAcknowledgement(result.raw.body, args, operation),
    );
  }
  rememberIds(result.raw.body);
  exercised.add(operation.action ? `${name}#${operation.action}` : name);
  return {
    ...(operation.method === 'GET' ? result.structured : result.raw),
    ...(operation.method === 'GET' ? {} : { acknowledgement: result.structured.body }),
  } as {
    status: number;
    body: T;
    contentType: string | null;
    acknowledgement?: unknown;
  };
}

async function callAny(
  actor: Actor,
  name: string,
  args: OperationArgs = {},
): Promise<{
  isError: boolean;
  message: string;
  structured: { status: number; body: unknown; contentType: string | null };
  raw: { status: number; body: unknown; contentType: string | null } | null;
}> {
  activePrincipal = actor.principal;
  lastExecutionResult = null;
  const response = await handleMcp(
    new Request('http://localhost:3001/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer gpco_matrix',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++requestId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  );
  expect(response.status, `${name} MCP transport`).toBe(200);
  const envelope = (await response.json()) as {
    result?: {
      isError?: boolean;
      structuredContent?: {
        status: number;
        body: unknown;
        contentType: string | null;
      };
      content?: Array<{ text?: string }>;
    };
  };
  const result = envelope.result;
  if (!result?.structuredContent) {
    throw new Error(`${name} returned no structured result: ${JSON.stringify(envelope)}`);
  }
  return {
    isError: result.isError === true,
    message: result.content?.[0]?.text ?? 'unknown error',
    structured: result.structuredContent,
    raw: lastExecutionResult,
  };
}

function path(id: string, extra: Record<string, string> = {}) {
  return { path: { id, ...extra } };
}

describe('delegated operation behavioral parity', () => {
  afterAll(() => {
    setMediaStorageForTests(undefined);
    closeDb();
  });

  it('executes a successful behavioral fixture through the SDK and shared handler for every tool', async () => {
    const suffix = randomUUID();
    const [client] = await getDb()
      .insert(oauthClients)
      .values({
        clientId: `mcp-parity-${suffix}`,
        name: 'MCP parity matrix',
        redirectUris: ['http://127.0.0.1:49152/callback'],
        allowedScopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
      })
      .returning({ id: oauthClients.id });
    if (!client) throw new Error('client insert failed');
    const owner = await registerActor('owner', client.id);
    const member = await registerActor('member', client.id);

    const mediaCapabilities = await call<{ enabled: boolean; maxInputBytes: number }>(
      owner,
      'media',
      { action: 'capabilities' },
    );
    expect(mediaCapabilities.body.enabled).toBe(true);
    await call(owner, 'get_current_user');
    await call(owner, 'list_campaigns');
    const campaign = (
      await call<{ id: string }>(owner, 'campaign', {
        action: 'create',
        body: { name: `Matrix ${suffix}`, experimentalActiveEffects: true },
      })
    ).body;
    const campaignId = campaign.id as string;
    const filteredCampaigns = await call<Array<{ id: string }>>(owner, 'list_campaigns', {
      query: { search: suffix, limit: 1, offset: 0 },
    });
    expect(filteredCampaigns.body).toEqual([expect.objectContaining({ id: campaignId })]);
    await call(owner, 'get_campaign', path(campaignId));
    await call(owner, 'campaign', {
      action: 'update',
      ...path(campaignId),
      body: { description: 'updated' },
    });
    await call(owner, 'campaign_member', {
      action: 'add',
      ...path(campaignId),
      body: { email: member.email },
    });
    await call(owner, 'campaign_member', {
      action: 'update',
      ...path(campaignId, { userId: member.principal.user.id }),
      body: { role: 'manager' },
    });
    await call(owner, 'campaign_member', {
      action: 'remove',
      ...path(campaignId, { userId: member.principal.user.id }),
    });

    const transferCampaign = (
      await call<{ id: string }>(owner, 'campaign', {
        action: 'create',
        body: { name: `Transfer ${suffix}` },
      })
    ).body;
    await call(owner, 'campaign_member', {
      action: 'add',
      ...path(transferCampaign.id),
      body: { email: member.email },
    });
    await call(owner, 'transfer_campaign', {
      ...path(transferCampaign.id),
      body: { newOwnerId: member.principal.user.id },
    });

    const cancelledInvite = (
      await call<{ id: string }>(owner, 'invite_campaign_member', {
        ...path(campaignId),
        body: { handle: member.email },
      })
    ).body;
    await call(owner, 'list_campaign_invitations', {
      ...path(campaignId),
      query: { limit: 1, offset: 0 },
    });
    await call(
      owner,
      'cancel_campaign_invitation',
      path(campaignId, { invitationId: cancelledInvite.id }),
    );

    const acceptedCampaign = (
      await call<{ id: string }>(owner, 'campaign', {
        action: 'create',
        body: { name: `Accept ${suffix}` },
      })
    ).body;
    const acceptedInvite = (
      await call<{ id: string }>(owner, 'invite_campaign_member', {
        ...path(acceptedCampaign.id),
        body: { handle: member.email },
      })
    ).body;
    await call(member, 'list_invitations', { query: { limit: 1, offset: 0 } });
    await call(member, 'invitation', {
      action: 'accept',
      path: { invitationId: acceptedInvite.id },
    });

    const rejectedCampaign = (
      await call<{ id: string }>(owner, 'campaign', {
        action: 'create',
        body: { name: `Reject ${suffix}` },
      })
    ).body;
    const rejectedInvite = (
      await call<{ id: string }>(owner, 'invite_campaign_member', {
        ...path(rejectedCampaign.id),
        body: { handle: member.email },
      })
    ).body;
    await call(member, 'invitation', {
      action: 'reject',
      path: { invitationId: rejectedInvite.id },
    });

    const notificationCampaign = (
      await call<{ id: string }>(owner, 'campaign', {
        action: 'create',
        body: { name: `Notify ${suffix}` },
      })
    ).body;
    await call(owner, 'invite_campaign_member', {
      ...path(notificationCampaign.id),
      body: { handle: member.email },
    });
    const notificationList = (
      await call(member, 'list_notifications', {
        query: { unreadOnly: 'true', limit: 1, offset: 0 },
      })
    ).body as Array<{ id: string }>;
    expect(notificationList.length).toBeGreaterThan(0);
    const notification = notificationList[0];
    if (!notification) throw new Error('invitation did not create a notification');
    await call(member, 'notification', { action: 'mark_read', path: { id: notification.id } });
    await call(member, 'notification', { action: 'mark_all_read' });
    await call(member, 'notification', { action: 'delete', path: { id: notification.id } });

    await call(owner, 'get_campaign_library', path(campaignId));
    const libraryKinds = [
      ['trait', { name: `Trait ${suffix}`, kind: 'advantage' }],
      ['skill', { name: `Skill ${suffix}`, attribute: 'DX', difficulty: 'A' }],
      ['spell', { name: `Spell ${suffix}` }],
      ['item', { name: `Item ${suffix}` }],
      [
        'enchantment',
        {
          name: `Enchantment ${suffix}`,
          applicability: 'weapon',
          effects: [{ target: 'weapon_attack', value: 1 }],
        },
      ],
      ['active_effect', { name: `Effect ${suffix}`, stacking: { kind: 'additive', key: 'test' } }],
      ['language', { name: `Language ${suffix}` }],
      ['technique', { name: `Technique ${suffix}`, defaultSkillName: 'Broadsword' }],
      ['style', { name: `Style ${suffix}` }],
      [
        'source',
        { name: `Source ${suffix}`, key: `source-${suffix}`, abbreviation: 'MX', priority: 1 },
      ],
      [
        'modifier',
        {
          name: `Modifier ${suffix}`,
          category: 'enhancement',
          costType: 'percent',
          calculation: fixedCalculation({ modifier: { value: 10, unit: 'percentage' } }),
          applicability: { universal: true, traitKinds: [], traitTags: [], traits: [] },
        },
      ],
    ] as const;
    const libraryPathKeys: Record<string, string> = {
      trait: 'traitId',
      skill: 'skillId',
      spell: 'spellId',
      item: 'itemId',
      enchantment: 'enchantmentId',
      active_effect: 'effectId',
      language: 'languageId',
      technique: 'techniqueId',
      style: 'styleId',
      source: 'sourceId',
      modifier: 'modifierId',
    };
    for (const [kind, body] of libraryKinds) {
      const created = (
        await call<{ id: string }>(owner, `library_${kind}`, {
          action: 'create',
          ...path(campaignId),
          body,
        })
      ).body;
      const idKey = libraryPathKeys[kind];
      if (!idKey) throw new Error(`missing library path key for ${kind}`);
      const itemPath = path(campaignId, { [idKey]: created.id });
      await call(owner, `library_${kind}`, {
        action: 'update',
        ...itemPath,
        body:
          kind === 'source'
            ? { priority: 2 }
            : kind === 'modifier'
              ? { calculation: fixedCalculation({ modifier: { value: 15, unit: 'percentage' } }) }
              : { name: `${body.name} updated` },
      });
      if (kind === 'skill') {
        const detail = await call<{
          kind: 'library_skill';
          skill: { id: string; name: string };
          experimentalActiveEffects: boolean;
        }>(owner, 'get_campaign_library_skill', path(campaignId, { skillId: created.id }));
        expect(detail.body).toMatchObject({
          kind: 'library_skill',
          skill: { id: created.id, name: `${body.name} updated` },
          experimentalActiveEffects: true,
        });
      }
      if (kind === 'trait') {
        const narrowed = await call<{ traits: Array<{ id: string }>; skills: unknown[] }>(
          owner,
          'get_campaign_library',
          {
            ...path(campaignId),
            query: { section: 'traits', search: suffix, limit: 1, offset: 0 },
          },
        );
        expect(narrowed.body.traits).toEqual([expect.objectContaining({ id: created.id })]);
        expect(narrowed.body.skills).toEqual([]);
      }
      await call(owner, `library_${kind}`, { action: 'delete', ...itemPath });
    }
    // This long parity matrix reaches the per-principal MCP request budget;
    // isolate three additional CRUD operations on their own test actor.
    const raceOwner = await registerActor('race-crud', client.id);
    const raceCampaign = (
      await call<{ id: string }>(raceOwner, 'campaign', {
        action: 'create',
        body: { name: `Race ${suffix}` },
      })
    ).body;
    const race = (
      await call<{ id: string }>(raceOwner, 'library_race', {
        action: 'create',
        ...path(raceCampaign.id),
        body: {
          key: `race-${suffix}`,
          name: `Race ${suffix}`,
          status: 'complete',
          role: 'definition',
          kind: 'race',
          points: 10,
          attributeModifiers: { st: 1 },
          traits: [],
          skills: [],
        },
      })
    ).body;
    const racePath = path(raceCampaign.id, { raceId: race.id });
    await call(raceOwner, 'library_race', {
      action: 'update',
      ...racePath,
      body: { points: 15 },
    });
    await call(raceOwner, 'library_race', { action: 'delete', ...racePath });
    await call(raceOwner, 'campaign', { action: 'delete', ...path(raceCampaign.id) });
    const exported = await call<string>(owner, 'export_campaign_library', path(campaignId));
    expect(typeof exported.body).toBe('string');
    await call(owner, 'import_campaign_library', {
      ...path(campaignId),
      body: { yaml: exported.body, mode: 'merge' },
    });

    await call(owner, 'list_adventure_log', path(campaignId));
    const logEntry = (
      await call<{ id: string }>(owner, 'adventure_log_entry', {
        action: 'create',
        ...path(campaignId),
        body: { sessionDate: '2026-09-12', title: 'Matrix session' },
      })
    ).body;
    const filteredLog = await call<Array<{ id: string }>>(owner, 'list_adventure_log', {
      ...path(campaignId),
      query: { search: 'Matrix', limit: 1, offset: 0 },
    });
    expect(filteredLog.body).toEqual([expect.objectContaining({ id: logEntry.id })]);
    await call(owner, 'adventure_log_entry', {
      action: 'update',
      ...path(campaignId, { entryId: logEntry.id }),
      body: { title: 'Matrix session updated' },
    });
    await call(owner, 'adventure_log_entry', {
      action: 'delete',
      ...path(campaignId, { entryId: logEntry.id }),
    });

    await call(owner, 'list_encounters', path(campaignId));
    const encounter = (
      await call<{
        id: string;
        round: number;
        activeCombatantId: string | null;
        version: number;
        combatants: Array<{ id: string }>;
      }>(owner, 'encounter', {
        action: 'create',
        ...path(campaignId),
        body: {
          name: 'Matrix encounter',
          combatants: [{ kind: 'npc', name: 'Orc', basicSpeed: 5, dx: 10, maxHp: 10 }],
        },
      })
    ).body;
    const filteredEncounters = await call<Array<{ id: string }>>(owner, 'list_encounters', {
      ...path(campaignId),
      query: { search: 'Matrix', limit: 1, offset: 0 },
    });
    expect(filteredEncounters.body).toEqual([expect.objectContaining({ id: encounter.id })]);
    const encounterPath = path(campaignId, { encounterId: encounter.id });
    await call(owner, 'get_encounter', encounterPath);
    await call(owner, 'encounter', {
      action: 'update',
      ...encounterPath,
      body: { name: 'Matrix encounter updated' },
    });
    const initialCombatant = encounter.combatants[0];
    if (!initialCombatant) throw new Error('encounter fixture omitted its initial combatant');
    await call(owner, 'encounter', {
      action: 'advance_turn',
      ...encounterPath,
      body: {
        direction: 'next',
        expectedRound: encounter.round,
        expectedActiveCombatantId: encounter.activeCombatantId,
        expectedVersion: encounter.version + 1,
      },
    });
    const combatant = (
      await call<{ id: string }>(owner, 'encounter_combatant', {
        action: 'create',
        ...encounterPath,
        body: {
          kind: 'npc',
          name: 'Goblin',
          basicSpeed: 5.5,
          dx: 11,
          maxHp: 8,
        },
      })
    ).body;
    const combatantPath = path(campaignId, {
      encounterId: encounter.id,
      combatantId: combatant.id,
    });
    await call(owner, 'encounter_combatant', {
      action: 'update',
      ...combatantPath,
      body: { currentHp: 7 },
    });
    const effect = (
      await call<{ id: string }>(owner, 'encounter_effect', {
        action: 'create',
        ...encounterPath,
        body: {
          targetCombatantId: initialCombatant.id,
          name: 'Stun',
          duration: { unit: 'rounds', amount: 1 },
        },
      })
    ).body;
    const effectPath = path(campaignId, {
      encounterId: encounter.id,
      effectId: effect.id,
    });
    await call(owner, 'encounter_effect', {
      action: 'update',
      ...effectPath,
      body: { notes: 'updated' },
    });
    await call(owner, 'encounter_effect', { action: 'delete', ...effectPath });
    await call(owner, 'encounter_combatant', { action: 'delete', ...combatantPath });

    await call(owner, 'list_characters');
    const character = (
      await call<{ id: string }>(owner, 'character', {
        action: 'create',
        body: { name: `Character ${suffix}`, campaignId },
      })
    ).body;
    const characterId = character.id as string;
    const filteredCharacters = await call<Array<{ id: string }>>(owner, 'list_characters', {
      query: { search: suffix, limit: 1, offset: 0 },
    });
    expect(filteredCharacters.body).toEqual([expect.objectContaining({ id: characterId })]);
    await call(owner, 'get_character', path(characterId));
    const mediaBytes = await sharp({
      create: { width: 24, height: 16, channels: 3, background: { r: 75, g: 120, b: 165 } },
    })
      .png()
      .toBuffer();
    const mediaDeclaration = {
      clientUploadId: randomUUID(),
      targetType: 'character',
      targetId: characterId,
      byteLength: mediaBytes.length,
      sha256: createHash('sha256').update(mediaBytes).digest('hex'),
      base64: mediaBytes.toString('base64'),
    };
    const mediaReady = await call<{ id: string; state: string; thumbUrl: string | null }>(
      owner,
      'media',
      {
        action: 'upload',
        body: mediaDeclaration,
      },
    );
    const mediaStatus = await call<{ id: string; state: string }>(owner, 'media', {
      action: 'status',
      ...path(mediaDeclaration.clientUploadId),
      query: { lookup: 'clientUploadId' },
    });
    expect(mediaStatus.body).toMatchObject({ id: mediaReady.body.id, state: 'ready' });
    const mediaRetry = await call<{ id: string; state: string }>(owner, 'media', {
      action: 'upload',
      body: mediaDeclaration,
    });
    expect(mediaRetry.body).toMatchObject({ id: mediaReady.body.id, state: 'ready' });
    expect(mediaReady.body.thumbUrl).not.toBeNull();
    await call(owner, 'character', {
      action: 'update',
      ...path(characterId),
      body: { portraitAssetId: mediaReady.body.id },
    });
    const cancelClientUploadId = randomUUID();
    failNextMediaPut = true;
    const failed = await callAny(owner, 'media', {
      action: 'upload',
      body: {
        ...mediaDeclaration,
        clientUploadId: cancelClientUploadId,
      },
    });
    expect(failed.structured.status).toBe(503);
    const cancelled = await call<{ state: string }>(owner, 'media', {
      action: 'cancel',
      ...path(cancelClientUploadId),
      query: { lookup: 'clientUploadId' },
    });
    expect(cancelled.body.state).toBe('cancelled');
    await call(owner, 'character', { action: 'update', ...path(characterId), body: { st: 11 } });
    await call(owner, 'dismiss_character_warning', {
      ...path(characterId),
      body: { code: 'matrix_warning', dismissed: true },
    });
    const characterKinds = [
      ['trait', 'traitId', { name: `C Trait ${suffix}`, kind: 'advantage' }, { points: 5 }],
      [
        'skill',
        'skillId',
        {
          name: `C Skill ${suffix}`,
          attribute: 'DX',
          difficulty: 'A',
          points: 1,
        },
        { points: 2 },
      ],
      ['spell', 'spellId', { name: `C Spell ${suffix}`, points: 1 }, { points: 2 }],
      ['language', 'languageId', { name: `C Language ${suffix}`, points: 1 }, { points: 2 }],
      [
        'technique',
        'techniqueId',
        {
          name: `C Technique ${suffix}`,
          defaultSkillName: 'Broadsword',
          points: 1,
        },
        { points: 2 },
      ],
    ] as const;
    for (const [kind, idKey, body, update] of characterKinds) {
      const created = (
        await call<Record<string, { id: string }>>(owner, `character_${kind}`, {
          action: 'create',
          ...path(characterId),
          body,
        })
      ).body;
      const child = created[kind];
      if (!child) throw new Error(`character ${kind} response omitted its row`);
      const childPath = path(characterId, { [idKey]: child.id });
      await call(owner, `character_${kind}`, { action: 'update', ...childPath, body: update });
      const deleted = await call(owner, `character_${kind}`, { action: 'delete', ...childPath });
      expect(deleted.acknowledgement).toEqual({ acknowledged: true, resourceId: child.id });
    }
    const inventory = (
      await call<{ item: { id: string } }>(owner, 'character_inventory', {
        action: 'create',
        ...path(characterId),
        body: { name: `Pack ${suffix}`, isContainer: true },
      })
    ).body;
    const inventoryPath = path(characterId, { itemId: inventory.item.id });
    const pouch = (
      await call<{ item: { id: string } }>(owner, 'character_inventory', {
        action: 'create',
        ...path(characterId),
        body: { name: `A Pouch ${suffix}`, isContainer: true, parentId: inventory.item.id },
      })
    ).body;
    await call(owner, 'character_inventory', {
      action: 'create',
      ...path(characterId),
      body: { name: `Token ${suffix}`, parentId: pouch.item.id },
    });
    await call(owner, 'character_inventory', {
      action: 'create',
      ...path(characterId),
      body: { name: `B Compass ${suffix}`, parentId: inventory.item.id },
    });
    const itemDetail = await call<{
      kind: string;
      characterId: string;
      characterName: string;
      item: { id: string; name: string };
      contents: Array<{ name: string }>;
    }>(owner, 'get_character_inventory_item', inventoryPath);
    expect(itemDetail.body).toMatchObject({
      kind: 'inventory_item',
      characterId,
      characterName: `Character ${suffix}`,
      item: { id: inventory.item.id, name: `Pack ${suffix}` },
    });
    expect(itemDetail.body.contents.map((item) => item.name)).toEqual([
      `A Pouch ${suffix}`,
      `Token ${suffix}`,
      `B Compass ${suffix}`,
    ]);
    await call(owner, 'character_inventory', {
      action: 'update',
      ...inventoryPath,
      body: { quantity: 2 },
    });
    await call(owner, 'character_inventory', { action: 'delete', ...inventoryPath });
    await call(owner, 'update_character_combat', {
      ...path(characterId),
      body: { currentHp: 9 },
    });
    await call(owner, 'character_condition_group', {
      action: 'activate',
      ...path(characterId, { group: 'matrix' }),
    });
    await call(owner, 'character_condition_group', {
      action: 'deactivate',
      ...path(characterId, { group: 'matrix' }),
    });
    await call(owner, 'get_character_history', path(characterId));
    await call(owner, 'get_campaign_history', path(campaignId));
    await call(owner, 'character', { action: 'delete', ...path(characterId) });

    const deleteCampaign = (
      await call<{ id: string }>(owner, 'campaign', {
        action: 'create',
        body: { name: `Delete ${suffix}` },
      })
    ).body;
    await call(owner, 'campaign', { action: 'delete', ...path(deleteCampaign.id) });

    expect([...exercised].sort()).toEqual(
      TOOLS.map((tool) => (tool.action ? `${tool.tool}#${tool.action}` : tool.tool)).sort(),
    );
  });

  it('enforces the declared OAuth scope before dispatch for every tool', async () => {
    for (const tool of TOOLS) {
      activePrincipal = {
        user: {
          id: randomUUID(),
          email: 'scope-matrix@example.com',
          displayName: 'Scope matrix',
          suspendedAt: null,
          authMethod: 'oauth',
          authVersion: 1,
          authenticatedAt: Math.floor(Date.now() / 1000),
        },
        grantId: randomUUID(),
        clientDbId: randomUUID(),
        clientId: `scope-${randomUUID()}`,
        scopes: (['gpc:read', 'gpc:write', 'gpc:manage'] as OAuthScope[]).filter(
          (scope) => scope !== tool.scope,
        ),
        expiresAt: new Date(Date.now() + 60_000),
        resource: 'http://localhost:3001/mcp',
        experimentalMcpUi: false,
      };
      const response = await handleMcp(
        new Request('http://localhost:3001/mcp', {
          method: 'POST',
          headers: {
            authorization: 'Bearer gpco_scope_matrix',
            'content-type': 'application/json',
            'mcp-protocol-version': '2025-11-25',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++requestId,
            method: 'tools/call',
            params: {
              name: tool.tool,
              arguments: tool.action ? { action: tool.action } : {},
            },
          }),
        }),
      );
      expect(response.status, tool.tool).toBe(403);
      expect(response.headers.get('www-authenticate'), tool.tool).toContain(
        `scope="${tool.scope}"`,
      );
    }
  });

  it('matches REST privacy projection and ownership denial through the delegated graph', async () => {
    const suffix = randomUUID();
    const [client] = await getDb()
      .insert(oauthClients)
      .values({
        clientId: `mcp-parity-access-${suffix}`,
        name: 'MCP access parity',
        redirectUris: ['http://127.0.0.1:49152/callback'],
        allowedScopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
      })
      .returning({ id: oauthClients.id });
    if (!client) throw new Error('client insert failed');
    const gm = await registerActor('access-gm', client.id);
    const owner = await registerActor('access-owner', client.id);
    const viewer = await registerActor('access-viewer', client.id);
    const outsider = await registerActor('access-outsider', client.id);
    const campaign = (
      await call<{ id: string }>(gm, 'campaign', {
        action: 'create',
        body: {
          name: `Private ${suffix}`,
          shareCharacterSheets: false,
          allowGmCharacterEditing: false,
        },
      })
    ).body;
    for (const actor of [owner, viewer]) {
      await call(gm, 'campaign_member', {
        action: 'add',
        ...path(campaign.id),
        body: { email: actor.email },
      });
    }
    const character = (
      await call<{ id: string }>(owner, 'character', {
        action: 'create',
        body: { name: 'Private sheet', campaignId: campaign.id, st: 14 },
      })
    ).body;

    const restRead = await app.request(`/api/v1/characters/${character.id}`, {
      headers: { authorization: `Bearer ${viewer.accessToken}` },
    });
    const mcpRead = await call<Record<string, unknown>>(
      viewer,
      'get_character',
      path(character.id),
    );
    expect(restRead.status).toBe(200);
    expect(mcpRead.status).toBe(restRead.status);
    expect(mcpRead.body).toEqual(await restRead.json());
    expect(mcpRead.body).toMatchObject({
      view: 'minimal',
      name: 'Private sheet',
    });
    expect(mcpRead.body.st).toBeUndefined();

    const privateItem = (
      await call<{ item: { id: string } }>(owner, 'character_inventory', {
        action: 'create',
        ...path(character.id),
        body: { name: 'Private case', isContainer: true },
      })
    ).body.item;
    const inventoryArgs = path(character.id, { itemId: privateItem.id });
    const itemRead = await call<{ kind: string; item: { id: string } }>(
      owner,
      'get_character_inventory_item',
      inventoryArgs,
    );
    expect(itemRead.body).toMatchObject({
      kind: 'inventory_item',
      item: { id: privateItem.id, name: 'Private case' },
    });
    const privateItemRest = await previewRest(
      viewer,
      'get_character_inventory_item',
      inventoryArgs,
    );
    const privateItemMcp = await callAny(viewer, 'get_character_inventory_item', inventoryArgs);
    expect(privateItemRest.status).toBe(403);
    expect(privateItemMcp.isError).toBe(true);
    expect(privateItemMcp.structured.status).toBe(privateItemRest.status);
    expect(privateItemMcp.structured.body).toEqual(privateItemRest.body);

    const otherCharacter = (
      await call<{ id: string }>(owner, 'character', {
        action: 'create',
        body: { name: 'Other private sheet', campaignId: campaign.id },
      })
    ).body;
    const crossCharacterArgs = path(otherCharacter.id, { itemId: privateItem.id });
    const crossCharacterRest = await previewRest(
      owner,
      'get_character_inventory_item',
      crossCharacterArgs,
    );
    const crossCharacterMcp = await callAny(
      owner,
      'get_character_inventory_item',
      crossCharacterArgs,
    );
    expect(crossCharacterRest.status).toBe(404);
    expect(crossCharacterMcp.isError).toBe(true);
    expect(crossCharacterMcp.structured.status).toBe(crossCharacterRest.status);
    expect(crossCharacterMcp.structured.body).toEqual(crossCharacterRest.body);

    const publicSkill = (
      await call<{ id: string }>(gm, 'library_skill', {
        action: 'create',
        ...path(campaign.id),
        body: { name: 'Public campaign skill', attribute: 'DX', difficulty: 'A' },
      })
    ).body;
    const publicSkillArgs = path(campaign.id, { skillId: publicSkill.id });
    const memberSkill = await call<{
      kind: string;
      skill: { id: string; name: string };
    }>(viewer, 'get_campaign_library_skill', publicSkillArgs);
    expect(memberSkill.body).toMatchObject({
      kind: 'library_skill',
      skill: { id: publicSkill.id, name: 'Public campaign skill' },
    });
    const outsiderRest = await previewRest(outsider, 'get_campaign_library_skill', publicSkillArgs);
    const outsiderMcp = await callAny(outsider, 'get_campaign_library_skill', publicSkillArgs);
    expect(outsiderRest.status).toBe(403);
    expect(outsiderMcp.isError).toBe(true);
    expect(outsiderMcp.structured.status).toBe(outsiderRest.status);
    expect(outsiderMcp.structured.body).toEqual(outsiderRest.body);

    const restrictedSkill = (
      await call<{ id: string }>(gm, 'library_skill', {
        action: 'create',
        ...path(campaign.id),
        body: {
          name: 'Restricted campaign skill',
          attribute: 'IQ',
          difficulty: 'H',
          restricted: true,
        },
      })
    ).body;
    const restrictedArgs = path(campaign.id, { skillId: restrictedSkill.id });
    expect((await call(gm, 'get_campaign_library_skill', restrictedArgs)).body).toMatchObject({
      kind: 'library_skill',
      skill: { id: restrictedSkill.id, restricted: true },
    });
    const restrictedRest = await previewRest(viewer, 'get_campaign_library_skill', restrictedArgs);
    const restrictedMcp = await callAny(viewer, 'get_campaign_library_skill', restrictedArgs);
    expect(restrictedRest.status).toBe(404);
    expect(restrictedMcp.isError).toBe(true);
    expect(restrictedMcp.structured.status).toBe(restrictedRest.status);
    expect(restrictedMcp.structured.body).toEqual(restrictedRest.body);

    const otherCampaign = (
      await call<{ id: string }>(gm, 'campaign', {
        action: 'create',
        body: { name: `Cross-parent ${suffix}` },
      })
    ).body;
    const crossCampaignArgs = path(otherCampaign.id, { skillId: publicSkill.id });
    const crossCampaignRest = await previewRest(
      gm,
      'get_campaign_library_skill',
      crossCampaignArgs,
    );
    const crossCampaignMcp = await callAny(gm, 'get_campaign_library_skill', crossCampaignArgs);
    expect(crossCampaignRest.status).toBe(404);
    expect(crossCampaignMcp.isError).toBe(true);
    expect(crossCampaignMcp.structured.status).toBe(crossCampaignRest.status);
    expect(crossCampaignMcp.structured.body).toEqual(crossCampaignRest.body);

    const updateBody = { name: 'Must remain private' };
    const restDenied = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${viewer.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(updateBody),
    });
    const mcpDenied = await callAny(viewer, 'character', {
      action: 'update',
      ...path(character.id),
      body: updateBody,
    });
    expect(restDenied.status).toBe(403);
    expect(mcpDenied.isError).toBe(true);
    expect(mcpDenied.structured.status).toBe(restDenied.status);
    expect(mcpDenied.structured.body).toEqual(await restDenied.json());
  });

  it('matches campaign rule fields and attribute-cap rejections through REST and MCP', async () => {
    const suffix = randomUUID();
    const [client] = await getDb()
      .insert(oauthClients)
      .values({
        clientId: `mcp-parity-caps-${suffix}`,
        name: 'MCP campaign rules parity',
        redirectUris: ['http://127.0.0.1:49152/callback'],
        allowedScopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
      })
      .returning({ id: oauthClients.id });
    if (!client) throw new Error('client insert failed');
    const owner = await registerActor('campaign-rules', client.id);

    const campaign = (
      await call<{
        id: string;
        enforceAttributeCaps: boolean;
        houseRules: {
          ruleSet: string;
          protectNaturalDr: boolean;
          eyeMissHitsFace: boolean;
        };
      }>(owner, 'campaign', {
        action: 'create',
        body: {
          name: `Campaign rules ${suffix}`,
          enforceAttributeCaps: true,
          houseRules: {
            ruleSet: 'custom',
            protectNaturalDr: false,
            eyeMissHitsFace: true,
          },
        },
      })
    ).body;
    expect(campaign).toMatchObject({
      enforceAttributeCaps: true,
      houseRules: {
        ruleSet: 'custom',
        protectNaturalDr: false,
        eyeMissHitsFace: true,
      },
    });

    const preset = (
      await call<typeof campaign>(owner, 'campaign', {
        action: 'update',
        ...path(campaign.id),
        body: {
          enforceAttributeCaps: true,
          houseRules: { ruleSet: 'j_talisar' },
        },
      })
    ).body;
    expect(preset).toMatchObject({
      enforceAttributeCaps: true,
      houseRules: {
        ruleSet: 'j_talisar',
        protectNaturalDr: true,
        eyeMissHitsFace: true,
      },
    });

    const character = (
      await call<{ id: string; dx: number }>(owner, 'character', {
        action: 'create',
        body: { name: `Capped ${suffix}`, campaignId: campaign.id, dx: 20 },
      })
    ).body;
    const updateArgs = { ...path(character.id), body: { dx: 21 } };
    const restRejected = await previewRest(owner, 'character', { action: 'update', ...updateArgs });
    const mcpRejected = await callAny(owner, 'character', { action: 'update', ...updateArgs });
    expect(restRejected.status).toBe(422);
    expect(mcpRejected.isError).toBe(true);
    expect(mcpRejected.structured.status).toBe(restRejected.status);
    expect(mcpRejected.structured.contentType?.split(';', 1)[0] ?? null).toBe(
      restRejected.contentType?.split(';', 1)[0] ?? null,
    );
    expect(mcpRejected.structured.body).toEqual(restRejected.body);
    expect(mcpRejected.structured.body).toMatchObject({
      error: expect.stringContaining('DX'),
    });

    const unchanged = await call<{ dx: number }>(owner, 'get_character', path(character.id));
    expect(unchanged.body.dx).toBe(20);
  });

  // Manifest anchor: effects-authoring-parity.
  it('preserves library and owned effects, YAML v12 portability, retries and refinement errors', async () => {
    const [client] = await getDb()
      .insert(oauthClients)
      .values({
        clientId: `mcp-effects-${randomUUID()}`,
        name: 'Effects parity',
        redirectUris: ['http://127.0.0.1:49152/callback'],
        allowedScopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
      })
      .returning({ id: oauthClients.id });
    if (!client) throw new Error('client insert failed');
    const owner = await registerActor('effects-owner', client.id);
    const member = await registerActor('effects-member', client.id);
    const campaign = (
      await call<{ id: string }>(owner, 'campaign', {
        action: 'create',
        body: { name: 'Effects parity', shareCharacterSheets: false },
      })
    ).body;
    await call(owner, 'campaign_member', {
      action: 'add',
      ...path(campaign.id),
      body: { email: member.email },
    });
    const sourceItem = (
      await call<{ id: string }>(owner, 'library_item', {
        action: 'create',
        ...path(campaign.id),
        body: {
          name: 'Spear',
          weaponData: { skill: 'Spear', damage: 'thr+2 imp' },
        },
      })
    ).body;
    const portableEffects: [LibraryTraitEffect, LibraryTraitEffect] = [
      {
        target: 'weapon_damage',
        value: 2,
        scaling: 'per_level',
        weaponSelector: {
          kind: 'library_item',
          libraryItemId: sourceItem.id,
          libraryItemName: 'Spear',
          modeName: 'Primary',
        },
      },
      {
        target: 'weapon_attack',
        value: 1,
        scaling: 'flat',
        weaponSelector: { kind: 'weapon_skill', skillName: 'Spear' },
        conditionGroup: 'focused',
        conditionLabel: 'Focused',
      },
    ];
    const libraryTrait = (
      await call<{ id: string; effects: unknown[] }>(owner, 'library_trait', {
        action: 'create',
        ...path(campaign.id),
        body: {
          name: 'Spear Mastery',
          kind: 'advantage',
          effects: portableEffects,
        },
      })
    ).body;
    expect(libraryTrait.effects).toEqual(portableEffects);
    await call(owner, 'library_trait', {
      action: 'update',
      ...path(campaign.id, { traitId: libraryTrait.id }),
      body: { effects: [...portableEffects].reverse() },
    });
    const skillEffects: [LibraryTraitEffect] = [
      {
        target: 'weapon_parry',
        value: 1,
        scaling: 'flat',
        weaponSelector: { kind: 'weapon_name', weaponName: 'Spear' },
      },
    ];
    const librarySkill = (
      await call<{ id: string }>(owner, 'library_skill', {
        action: 'create',
        ...path(campaign.id),
        body: {
          name: 'Spear',
          attribute: 'DX',
          difficulty: 'A',
          effects: skillEffects,
          prerequisiteRules: {
            kind: 'all',
            children: [
              { kind: 'attribute', attribute: 'DX', minimum: 10 },
              {
                kind: 'any',
                children: [
                  { kind: 'trait', name: 'Weapon Master' },
                  { kind: 'gm_permission', label: 'Martial training approved' },
                ],
              },
            ],
          },
          defaultSpecialization: 'One-Handed',
          specializationPolicy: {
            kind: 'required_catalog',
            options: [
              {
                name: 'One-Handed',
                defaults: [
                  {
                    kind: 'skill',
                    name: 'Spear Thrower',
                    specialization: { kind: 'same' },
                    modifier: -3,
                  },
                ],
              },
            ],
          },
        },
      })
    ).body;
    await call(owner, 'library_skill', {
      action: 'update',
      ...path(campaign.id, { skillId: librarySkill.id }),
      body: { effects: skillEffects },
    });
    const exported = await call<string>(owner, 'export_campaign_library', path(campaign.id));
    const yaml = parseLibraryYaml(exported.body);
    expect(yaml.version).toBe(15);
    expect(exported.body).not.toContain('libraryItemId');
    expect(yaml.library.traits[0]?.effects).toEqual([
      portableEffects[1],
      {
        ...portableEffects[0],
        weaponSelector: {
          kind: 'library_item',
          libraryItemName: 'Spear',
          modeName: 'Primary',
        },
      },
    ]);
    expect(yaml.library.skills[0]?.effects).toEqual(skillEffects);
    expect(yaml.library.skills[0]?.prerequisiteRules).toEqual({
      kind: 'all',
      children: [
        { kind: 'attribute', attribute: 'DX', minimum: 10 },
        {
          kind: 'any',
          children: [
            { kind: 'trait', name: 'Weapon Master' },
            { kind: 'gm_permission', label: 'Martial training approved' },
          ],
        },
      ],
    });
    expect(yaml.library.skills[0]?.specializationPolicy).toEqual({
      kind: 'required_catalog',
      options: [
        {
          name: 'One-Handed',
          defaults: [
            {
              kind: 'skill',
              name: 'Spear Thrower',
              specialization: { kind: 'same' },
              modifier: -3,
            },
          ],
        },
      ],
    });
    const importArgs = {
      ...path(campaign.id),
      body: { yaml: exported.body, mode: 'merge' },
      idempotencyKey: randomUUID(),
    };
    const imported = await call(owner, 'import_campaign_library', importArgs);
    expect((await callAny(owner, 'import_campaign_library', importArgs)).structured.body).toEqual(
      mutationAcknowledgement(imported.body, importArgs, {
        method: 'POST',
        path: '/api/v1/campaigns/{id}/library/import',
      }),
    );
    const library = (
      await call<{
        traits: Array<{ effects: unknown[] }>;
        skills: Array<{ effects: unknown[]; specializationPolicy: unknown }>;
      }>(owner, 'get_campaign_library', path(campaign.id))
    ).body;
    expect(library.traits[0]?.effects).toEqual(yaml.library.traits[0]?.effects);
    expect(library.skills[0]?.effects).toEqual(skillEffects);
    expect(library.skills[0]?.specializationPolicy).toEqual(
      yaml.library.skills[0]?.specializationPolicy,
    );

    const character = (
      await call<{ id: string }>(owner, 'character', {
        action: 'create',
        body: { name: 'Owned effects', campaignId: campaign.id },
      })
    ).body;
    const learnedSkill = (
      await call<{
        skill: { id: string; specialization: string; defaults: unknown };
      }>(owner, 'character_skill', {
        action: 'create',
        ...path(character.id),
        body: {
          name: 'Spear',
          attribute: 'DX',
          difficulty: 'A',
          specialization: ' one-handed ',
          librarySkillId: librarySkill.id,
        },
      })
    ).body.skill;
    expect(learnedSkill.specialization).toBe('One-Handed');
    expect(learnedSkill.defaults).toEqual([
      {
        kind: 'skill',
        name: 'Spear Thrower',
        specialization: { kind: 'same' },
        modifier: -3,
      },
    ]);
    const inventory = (
      await call<{ item: { id: string } }>(owner, 'character_inventory', {
        action: 'create',
        ...path(character.id),
        body: {
          name: 'Spear',
          equipped: true,
          weaponData: { skill: 'Spear', damage: 'thr+2 imp' },
        },
      })
    ).body.item;
    const customEffects: [TraitEffect] = [
      {
        target: 'weapon_attack',
        value: 3,
        scaling: 'flat',
        weaponSelector: {
          kind: 'inventory_item',
          inventoryItemId: inventory.id,
          modeName: 'Primary',
        },
      },
    ];
    const createArgs = {
      ...path(character.id),
      body: { name: 'My spear mastery', kind: 'advantage', customEffects },
      idempotencyKey: randomUUID(),
    };
    const created = (
      await call<{ trait: { id: string; customEffects: unknown[] } }>(owner, 'character_trait', {
        action: 'create',
        ...createArgs,
      })
    ).body;
    expect(created.trait.customEffects).toEqual(customEffects);
    expect(
      (await callAny(owner, 'character_trait', { action: 'create', ...createArgs })).structured
        .body,
    ).toEqual(
      mutationAcknowledgement(created, createArgs, {
        method: 'POST',
        path: '/api/v1/characters/{id}/traits',
      }),
    );
    const detail = (
      await call<{ traits: unknown[]; effects: unknown[] }>(
        owner,
        'get_character',
        path(character.id),
      )
    ).body;
    expect(detail.traits).toHaveLength(1);
    expect(detail.effects).toContainEqual(
      expect.objectContaining({
        target: 'weapon_attack',
        value: 3,
        weaponSelector: customEffects[0]?.weaponSelector,
        matchedInventoryItemIds: [inventory.id],
        weaponMatchStatus: 'one',
      }),
    );
    const history = (
      await call<HistoryEventOut[]>(owner, 'get_character_history', {
        ...path(character.id),
        query: { detail: '1' },
      })
    ).body;
    const traitHistory = history.filter((event) => event.entityId === created.trait.id);
    expect(traitHistory).toHaveLength(1);
    expect(traitHistory[0]).toMatchObject({
      actorUserId: owner.principal.user.id,
      agentClientId: client.id,
      agentGrantId: owner.principal.grantId,
      newRow: { custom_effects: customEffects },
    });

    // These Zod refinements cannot be expressed by OpenAPI's field types; the
    // delegated handler must preserve REST's field-specific failures.
    for (const [name, args, status] of [
      [
        'library_trait',
        {
          action: 'create',
          ...path(campaign.id),
          body: { name: 'Invalid', kind: 'advantage', effects: customEffects },
        },
        422,
      ],
      [
        'library_skill',
        {
          action: 'create',
          ...path(campaign.id),
          body: {
            name: 'Invalid',
            attribute: 'DX',
            difficulty: 'A',
            effects: customEffects,
          },
        },
        422,
      ],
      [
        'character_trait',
        {
          action: 'update',
          ...path(character.id, { traitId: created.trait.id }),
          body: { customEffects: [{ target: 'weapon_damage', value: 1 }] },
        },
        422,
      ],
      [
        'character_trait',
        {
          action: 'update',
          ...path(character.id, { traitId: created.trait.id }),
          body: {
            customEffects: [{ ...customEffects[0], target: 'weapon_parry' }],
          },
        },
        422,
      ],
    ] as const) {
      const rest = await previewRest(owner, name, args);
      const mcp = await callAny(owner, name, args);
      expect(rest.status).toBe(status);
      expect(mcp.isError).toBe(true);
      expect(mcp.structured.status).toBe(rest.status);
      expect(mcp.structured.body).toEqual(rest.body);
    }
    const traitPath = path(character.id, { traitId: created.trait.id });
    const deniedArgs = { ...traitPath, body: { customEffects: [] } };
    const deniedRest = await previewRest(member, 'character_trait', {
      action: 'update',
      ...deniedArgs,
    });
    const deniedMcp = await callAny(member, 'character_trait', { action: 'update', ...deniedArgs });
    expect(deniedRest.status).toBe(403);
    expect(deniedMcp.structured.body).toEqual(deniedRest.body);
    const privateRead = await call<Record<string, unknown>>(
      member,
      'get_character',
      path(character.id),
    );
    expect(privateRead.body).toMatchObject({ view: 'minimal' });
    expect(privateRead.body).not.toHaveProperty('effects');
    expect(privateRead.body).not.toHaveProperty('traits');
    await call(owner, 'character_trait', {
      action: 'update',
      ...traitPath,
      body: { customEffects: [] },
    });
    const cleared = await call<{ effects: unknown[] }>(owner, 'get_character', path(character.id));
    expect(cleared.body.effects).not.toContainEqual(
      expect.objectContaining({
        target: 'weapon_attack',
        sourceId: created.trait.id,
      }),
    );
    expect(cleared.body.effects).toContainEqual(
      expect.objectContaining({
        target: 'weapon_parry',
        sourceId: learnedSkill.id,
      }),
    );
  });

  it('keeps log attachments, point awards, and character caps identical through REST and MCP', async () => {
    const [client] = await getDb()
      .insert(oauthClients)
      .values({
        clientId: `mcp-points-${randomUUID()}`,
        name: 'Award parity',
        redirectUris: ['http://127.0.0.1:49152/callback'],
        allowedScopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
      })
      .returning({ id: oauthClients.id });
    if (!client) throw new Error('client insert failed');
    const owner = await registerActor('points-owner', client.id);
    const campaign = (
      await call<{ id: string }>(owner, 'campaign', {
        action: 'create',
        body: { name: 'Award parity campaign', pointTarget: 150 },
      })
    ).body;
    const first = (
      await call<{ id: string }>(owner, 'character', {
        action: 'create',
        body: { name: 'Awarded PC', campaignId: campaign.id },
      })
    ).body;
    const second = (
      await call<{ id: string }>(owner, 'character', {
        action: 'create',
        body: { name: 'Absent PC', campaignId: campaign.id },
      })
    ).body;
    const entry = (
      await call<{ id: string; xpAwards: unknown[] }>(owner, 'adventure_log_entry', {
        action: 'create',
        ...path(campaign.id),
        body: {
          sessionDate: '2026-09-12',
          title: 'Award session',
          pointsGained: 3,
          characterId: first.id,
        },
      })
    ).body;
    expect(entry.xpAwards).toHaveLength(2);
    const attached = await call<
      Array<{ id: string; characterId: string | null; visibility: string }>
    >(owner, 'list_adventure_log', path(campaign.id));
    expect(attached.body).toContainEqual(
      expect.objectContaining({ id: entry.id, characterId: first.id, visibility: 'private' }),
    );
    await call(owner, 'adventure_log_entry', {
      action: 'update',
      ...path(campaign.id, { entryId: entry.id }),
      body: { characterId: null },
    });
    const shared = await call<
      Array<{ id: string; characterId: string | null; visibility: string }>
    >(owner, 'list_adventure_log', path(campaign.id));
    expect(shared.body).toContainEqual(
      expect.objectContaining({ id: entry.id, characterId: null, visibility: 'campaign' }),
    );
    const read = async (id: string) =>
      (
        await call<{ earnedPoints: number; points: { unspent: number } }>(
          owner,
          'get_character',
          path(id),
        )
      ).body;
    expect((await read(first.id)).earnedPoints).toBe(3);
    expect((await read(second.id)).earnedPoints).toBe(3);
    await call(owner, 'adventure_log_entry', {
      action: 'update',
      ...path(campaign.id, { entryId: entry.id }),
      body: { pointsGained: 6, awardCharacterIds: [first.id] },
    });
    expect((await read(first.id)).earnedPoints).toBe(6);
    expect((await read(first.id)).points.unspent).toBe(156);
    expect((await read(second.id)).earnedPoints).toBe(0);
    await call(owner, 'adventure_log_entry', {
      action: 'delete',
      ...path(campaign.id, { entryId: entry.id }),
    });
    expect((await read(first.id)).earnedPoints).toBe(0);
  });
});
