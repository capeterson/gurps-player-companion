import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { LibraryTraitEffect, TraitEffect } from '../../shared/schemas/effects.ts';
import type { HistoryEventOut } from '../../shared/schemas/history.ts';
import type { OAuthScope } from '../../shared/schemas/oauth.ts';
import { parseLibraryYaml } from '../../shared/yaml/library.ts';
import { createApp } from '../app.ts';
import type { AppConfig } from '../config.ts';
import { closeDb, getDb, runInDbTransaction } from '../db/client.ts';
import { oauthClients, oauthGrants } from '../db/schema.ts';
import type { OAuthPrincipal } from '../oauth/service.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { executeOperation } from './executor.ts';
import { TOOLS } from './operationManifest.ts';
import { createMcpHandler } from './transport.ts';

configureIntegrationTestEnvironment();

const config: AppConfig = {
  ...integrationTestConfig,
  appBaseUrl: 'http://localhost:3001',
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
const handleMcp = createMcpHandler(config, app, document, {
  async resolvePrincipal() {
    return activePrincipal;
  },
  execute: executeOperation,
});
const toolByName = new Map(TOOLS.map((tool) => [tool.tool, tool]));
const stableIds = new Set<string>();

interface OperationArgs {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  idempotencyKey?: string;
}

class RestPreview extends Error {
  constructor(readonly result: { status: number; body: unknown; contentType: string | null }) {
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
  const tool = toolByName.get(name);
  if (!tool) throw new Error(`missing manifest tool ${name}`);
  let pathname = tool.path;
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
          method: tool.method,
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
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Matrix ${label}` }),
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
    },
  };
}

let requestId = 0;
const exercised = new Set<string>();
async function call<T = unknown>(
  actor: Actor,
  name: string,
  args: OperationArgs = {},
): Promise<{ status: number; body: T; contentType: string | null }> {
  rememberIds(actor.principal.user.id);
  rememberIds(args);
  const rest = await previewRest(actor, name, args);
  const result = await callAny(actor, name, args);
  expect(result.isError, `${name}: ${result.message}`).not.toBe(true);
  expect(result.structured.status, name).toBeGreaterThanOrEqual(200);
  expect(result.structured.status, name).toBeLessThan(300);
  expect(result.structured.status, `${name} REST status parity`).toBe(rest.status);
  expect(
    result.structured.contentType?.split(';', 1)[0] ?? null,
    `${name} REST content-type parity`,
  ).toBe(rest.contentType?.split(';', 1)[0] ?? null);
  expect(normalizeParity(result.structured.body), `${name} REST body parity`).toEqual(
    normalizeParity(rest.body),
  );
  rememberIds(result.structured.body);
  exercised.add(name);
  return result.structured as { status: number; body: T; contentType: string | null };
}

async function callAny(
  actor: Actor,
  name: string,
  args: OperationArgs = {},
): Promise<{
  isError: boolean;
  message: string;
  structured: { status: number; body: unknown; contentType: string | null };
}> {
  activePrincipal = actor.principal;
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
      structuredContent?: { status: number; body: unknown; contentType: string | null };
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
  };
}

function path(id: string, extra: Record<string, string> = {}) {
  return { path: { id, ...extra } };
}

describe('delegated operation behavioral parity', () => {
  afterAll(closeDb);

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

    await call(owner, 'gpc_get_current_user');
    await call(owner, 'gpc_list_campaigns');
    const campaign = (
      await call<{ id: string }>(owner, 'gpc_create_campaign', {
        body: { name: `Matrix ${suffix}` },
      })
    ).body;
    const campaignId = campaign.id as string;
    await call(owner, 'gpc_get_campaign', path(campaignId));
    await call(owner, 'gpc_update_campaign', {
      ...path(campaignId),
      body: { description: 'updated' },
    });
    await call(owner, 'gpc_add_campaign_member', {
      ...path(campaignId),
      body: { email: member.email },
    });
    await call(owner, 'gpc_update_campaign_member', {
      ...path(campaignId, { userId: member.principal.user.id }),
      body: { role: 'manager' },
    });
    await call(
      owner,
      'gpc_remove_campaign_member',
      path(campaignId, { userId: member.principal.user.id }),
    );

    const transferCampaign = (
      await call<{ id: string }>(owner, 'gpc_create_campaign', {
        body: { name: `Transfer ${suffix}` },
      })
    ).body;
    await call(owner, 'gpc_add_campaign_member', {
      ...path(transferCampaign.id),
      body: { email: member.email },
    });
    await call(owner, 'gpc_transfer_campaign', {
      ...path(transferCampaign.id),
      body: { newOwnerId: member.principal.user.id },
    });

    const cancelledInvite = (
      await call<{ id: string }>(owner, 'gpc_invite_campaign_member', {
        ...path(campaignId),
        body: { handle: member.email },
      })
    ).body;
    await call(owner, 'gpc_list_campaign_invitations', path(campaignId));
    await call(
      owner,
      'gpc_cancel_campaign_invitation',
      path(campaignId, { invitationId: cancelledInvite.id }),
    );

    const acceptedCampaign = (
      await call<{ id: string }>(owner, 'gpc_create_campaign', {
        body: { name: `Accept ${suffix}` },
      })
    ).body;
    const acceptedInvite = (
      await call<{ id: string }>(owner, 'gpc_invite_campaign_member', {
        ...path(acceptedCampaign.id),
        body: { handle: member.email },
      })
    ).body;
    await call(member, 'gpc_list_invitations');
    await call(member, 'gpc_accept_invitation', { path: { invitationId: acceptedInvite.id } });

    const rejectedCampaign = (
      await call<{ id: string }>(owner, 'gpc_create_campaign', {
        body: { name: `Reject ${suffix}` },
      })
    ).body;
    const rejectedInvite = (
      await call<{ id: string }>(owner, 'gpc_invite_campaign_member', {
        ...path(rejectedCampaign.id),
        body: { handle: member.email },
      })
    ).body;
    await call(member, 'gpc_reject_invitation', { path: { invitationId: rejectedInvite.id } });

    const notificationCampaign = (
      await call<{ id: string }>(owner, 'gpc_create_campaign', {
        body: { name: `Notify ${suffix}` },
      })
    ).body;
    await call(owner, 'gpc_invite_campaign_member', {
      ...path(notificationCampaign.id),
      body: { handle: member.email },
    });
    const notificationList = (await call(member, 'gpc_list_notifications')).body as Array<{
      id: string;
    }>;
    expect(notificationList.length).toBeGreaterThan(0);
    const notification = notificationList[0];
    if (!notification) throw new Error('invitation did not create a notification');
    await call(member, 'gpc_mark_notification_read', { path: { id: notification.id } });
    await call(member, 'gpc_mark_all_notifications_read');
    await call(member, 'gpc_delete_notification', { path: { id: notification.id } });

    await call(owner, 'gpc_get_campaign_library', path(campaignId));
    const libraryKinds = [
      ['trait', { name: `Trait ${suffix}`, kind: 'advantage' }],
      ['skill', { name: `Skill ${suffix}`, attribute: 'DX', difficulty: 'A' }],
      ['spell', { name: `Spell ${suffix}` }],
      ['item', { name: `Item ${suffix}` }],
      ['language', { name: `Language ${suffix}` }],
      ['technique', { name: `Technique ${suffix}`, defaultSkillName: 'Broadsword' }],
      ['style', { name: `Style ${suffix}` }],
    ] as const;
    const libraryPathKeys: Record<string, string> = {
      trait: 'traitId',
      skill: 'skillId',
      spell: 'spellId',
      item: 'itemId',
      language: 'languageId',
      technique: 'techniqueId',
      style: 'styleId',
    };
    for (const [kind, body] of libraryKinds) {
      const created = (
        await call<{ id: string }>(owner, `gpc_create_library_${kind}`, {
          ...path(campaignId),
          body,
        })
      ).body;
      const idKey = libraryPathKeys[kind];
      if (!idKey) throw new Error(`missing library path key for ${kind}`);
      const itemPath = path(campaignId, { [idKey]: created.id });
      await call(owner, `gpc_update_library_${kind}`, {
        ...itemPath,
        body: { name: `${body.name} updated` },
      });
      await call(owner, `gpc_delete_library_${kind}`, itemPath);
    }
    const exported = await call<string>(owner, 'gpc_export_campaign_library', path(campaignId));
    expect(typeof exported.body).toBe('string');
    await call(owner, 'gpc_import_campaign_library', {
      ...path(campaignId),
      body: { yaml: exported.body, mode: 'merge' },
    });

    await call(owner, 'gpc_list_adventure_log', path(campaignId));
    const logEntry = (
      await call<{ id: string }>(owner, 'gpc_create_adventure_log_entry', {
        ...path(campaignId),
        body: { sessionDate: '2026-09-12', title: 'Matrix session' },
      })
    ).body;
    await call(owner, 'gpc_update_adventure_log_entry', {
      ...path(campaignId, { entryId: logEntry.id }),
      body: { title: 'Matrix session updated' },
    });
    await call(owner, 'gpc_delete_adventure_log_entry', path(campaignId, { entryId: logEntry.id }));

    await call(owner, 'gpc_list_encounters', path(campaignId));
    const encounter = (
      await call<{
        id: string;
        round: number;
        activeCombatantId: string | null;
        version: number;
        combatants: Array<{ id: string }>;
      }>(owner, 'gpc_create_encounter', {
        ...path(campaignId),
        body: {
          name: 'Matrix encounter',
          combatants: [{ kind: 'npc', name: 'Orc', basicSpeed: 5, dx: 10, maxHp: 10 }],
        },
      })
    ).body;
    const encounterPath = path(campaignId, { encounterId: encounter.id });
    await call(owner, 'gpc_get_encounter', encounterPath);
    await call(owner, 'gpc_update_encounter', {
      ...encounterPath,
      body: { name: 'Matrix encounter updated' },
    });
    const initialCombatant = encounter.combatants[0];
    if (!initialCombatant) throw new Error('encounter fixture omitted its initial combatant');
    await call(owner, 'gpc_advance_encounter_turn', {
      ...encounterPath,
      body: {
        direction: 'next',
        expectedRound: encounter.round,
        expectedActiveCombatantId: encounter.activeCombatantId,
        expectedVersion: encounter.version + 1,
      },
    });
    const combatant = (
      await call<{ id: string }>(owner, 'gpc_create_encounter_combatant', {
        ...encounterPath,
        body: { kind: 'npc', name: 'Goblin', basicSpeed: 5.5, dx: 11, maxHp: 8 },
      })
    ).body;
    const combatantPath = path(campaignId, {
      encounterId: encounter.id,
      combatantId: combatant.id,
    });
    await call(owner, 'gpc_update_encounter_combatant', {
      ...combatantPath,
      body: { currentHp: 7 },
    });
    const effect = (
      await call<{ id: string }>(owner, 'gpc_create_encounter_effect', {
        ...encounterPath,
        body: {
          targetCombatantId: initialCombatant.id,
          name: 'Stun',
          duration: { unit: 'rounds', amount: 1 },
        },
      })
    ).body;
    const effectPath = path(campaignId, { encounterId: encounter.id, effectId: effect.id });
    await call(owner, 'gpc_update_encounter_effect', { ...effectPath, body: { notes: 'updated' } });
    await call(owner, 'gpc_delete_encounter_effect', effectPath);
    await call(owner, 'gpc_delete_encounter_combatant', combatantPath);

    await call(owner, 'gpc_list_characters');
    const character = (
      await call<{ id: string }>(owner, 'gpc_create_character', {
        body: { name: `Character ${suffix}`, campaignId },
      })
    ).body;
    const characterId = character.id as string;
    await call(owner, 'gpc_get_character', path(characterId));
    await call(owner, 'gpc_update_character', { ...path(characterId), body: { st: 11 } });
    await call(owner, 'gpc_dismiss_character_warning', {
      ...path(characterId),
      body: { code: 'matrix_warning', dismissed: true },
    });
    const characterKinds = [
      ['trait', 'traitId', { name: `C Trait ${suffix}`, kind: 'advantage' }, { points: 5 }],
      [
        'skill',
        'skillId',
        { name: `C Skill ${suffix}`, attribute: 'DX', difficulty: 'A', points: 1 },
        { points: 2 },
      ],
      ['spell', 'spellId', { name: `C Spell ${suffix}`, points: 1 }, { points: 2 }],
      ['language', 'languageId', { name: `C Language ${suffix}`, points: 1 }, { points: 2 }],
      [
        'technique',
        'techniqueId',
        { name: `C Technique ${suffix}`, defaultSkillName: 'Broadsword', points: 1 },
        { points: 2 },
      ],
    ] as const;
    for (const [kind, idKey, body, update] of characterKinds) {
      const created = (
        await call<Record<string, { id: string }>>(owner, `gpc_create_character_${kind}`, {
          ...path(characterId),
          body,
        })
      ).body;
      const child = created[kind];
      if (!child) throw new Error(`character ${kind} response omitted its row`);
      const childPath = path(characterId, { [idKey]: child.id });
      await call(owner, `gpc_update_character_${kind}`, { ...childPath, body: update });
      await call(owner, `gpc_delete_character_${kind}`, childPath);
    }
    const inventory = (
      await call<{ item: { id: string } }>(owner, 'gpc_create_inventory_item', {
        ...path(characterId),
        body: { name: `Pack ${suffix}` },
      })
    ).body;
    const inventoryPath = path(characterId, { itemId: inventory.item.id });
    await call(owner, 'gpc_update_inventory_item', { ...inventoryPath, body: { quantity: 2 } });
    await call(owner, 'gpc_delete_inventory_item', inventoryPath);
    await call(owner, 'gpc_update_character_combat', {
      ...path(characterId),
      body: { currentHp: 9 },
    });
    await call(owner, 'gpc_activate_condition_group', path(characterId, { group: 'matrix' }));
    await call(owner, 'gpc_deactivate_condition_group', path(characterId, { group: 'matrix' }));
    await call(owner, 'gpc_get_character_history', path(characterId));
    await call(owner, 'gpc_get_campaign_history', path(campaignId));
    await call(owner, 'gpc_delete_character', path(characterId));

    const deleteCampaign = (
      await call<{ id: string }>(owner, 'gpc_create_campaign', {
        body: { name: `Delete ${suffix}` },
      })
    ).body;
    await call(owner, 'gpc_delete_campaign', path(deleteCampaign.id));

    expect([...exercised].sort()).toEqual(TOOLS.map((tool) => tool.tool).sort());
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
            params: { name: tool.tool, arguments: {} },
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
    const campaign = (
      await call<{ id: string }>(gm, 'gpc_create_campaign', {
        body: {
          name: `Private ${suffix}`,
          shareCharacterSheets: false,
          allowGmCharacterEditing: false,
        },
      })
    ).body;
    for (const actor of [owner, viewer]) {
      await call(gm, 'gpc_add_campaign_member', {
        ...path(campaign.id),
        body: { email: actor.email },
      });
    }
    const character = (
      await call<{ id: string }>(owner, 'gpc_create_character', {
        body: { name: 'Private sheet', campaignId: campaign.id, st: 14 },
      })
    ).body;

    const restRead = await app.request(`/api/v1/characters/${character.id}`, {
      headers: { authorization: `Bearer ${viewer.accessToken}` },
    });
    const mcpRead = await call<Record<string, unknown>>(
      viewer,
      'gpc_get_character',
      path(character.id),
    );
    expect(restRead.status).toBe(200);
    expect(mcpRead.status).toBe(restRead.status);
    expect(mcpRead.body).toEqual(await restRead.json());
    expect(mcpRead.body).toMatchObject({ view: 'minimal', name: 'Private sheet' });
    expect(mcpRead.body.st).toBeUndefined();

    const updateBody = { name: 'Must remain private' };
    const restDenied = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${viewer.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(updateBody),
    });
    const mcpDenied = await callAny(viewer, 'gpc_update_character', {
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
      }>(owner, 'gpc_create_campaign', {
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
      await call<typeof campaign>(owner, 'gpc_update_campaign', {
        ...path(campaign.id),
        body: { enforceAttributeCaps: true, houseRules: { ruleSet: 'j_talisar' } },
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
      await call<{ id: string; dx: number }>(owner, 'gpc_create_character', {
        body: { name: `Capped ${suffix}`, campaignId: campaign.id, dx: 20 },
      })
    ).body;
    const updateArgs = { ...path(character.id), body: { dx: 21 } };
    const restRejected = await previewRest(owner, 'gpc_update_character', updateArgs);
    const mcpRejected = await callAny(owner, 'gpc_update_character', updateArgs);
    expect(restRejected.status).toBe(422);
    expect(mcpRejected.isError).toBe(true);
    expect(mcpRejected.structured.status).toBe(restRejected.status);
    expect(mcpRejected.structured.contentType?.split(';', 1)[0] ?? null).toBe(
      restRejected.contentType?.split(';', 1)[0] ?? null,
    );
    expect(mcpRejected.structured.body).toEqual(restRejected.body);
    expect(mcpRejected.structured.body).toMatchObject({ error: expect.stringContaining('DX') });

    const unchanged = await call<{ dx: number }>(owner, 'gpc_get_character', path(character.id));
    expect(unchanged.body.dx).toBe(20);
  });

  // Manifest anchor: effects-authoring-parity.
  it('preserves library and owned effects, YAML v7 portability, retries and refinement errors', async () => {
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
      await call<{ id: string }>(owner, 'gpc_create_campaign', {
        body: { name: 'Effects parity', shareCharacterSheets: false },
      })
    ).body;
    await call(owner, 'gpc_add_campaign_member', {
      ...path(campaign.id),
      body: { email: member.email },
    });
    const sourceItem = (
      await call<{ id: string }>(owner, 'gpc_create_library_item', {
        ...path(campaign.id),
        body: { name: 'Spear', weaponData: { skill: 'Spear', damage: 'thr+2 imp' } },
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
      await call<{ id: string; effects: unknown[] }>(owner, 'gpc_create_library_trait', {
        ...path(campaign.id),
        body: { name: 'Spear Mastery', kind: 'advantage', effects: portableEffects },
      })
    ).body;
    expect(libraryTrait.effects).toEqual(portableEffects);
    await call(owner, 'gpc_update_library_trait', {
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
      await call<{ id: string }>(owner, 'gpc_create_library_skill', {
        ...path(campaign.id),
        body: { name: 'Spear', attribute: 'DX', difficulty: 'A', effects: skillEffects },
      })
    ).body;
    await call(owner, 'gpc_update_library_skill', {
      ...path(campaign.id, { skillId: librarySkill.id }),
      body: { effects: skillEffects },
    });
    const exported = await call<string>(owner, 'gpc_export_campaign_library', path(campaign.id));
    const yaml = parseLibraryYaml(exported.body);
    expect(yaml.version).toBe(7);
    expect(exported.body).not.toContain('libraryItemId');
    expect(yaml.library.traits[0]?.effects).toEqual([
      portableEffects[1],
      {
        ...portableEffects[0],
        weaponSelector: { kind: 'library_item', libraryItemName: 'Spear', modeName: 'Primary' },
      },
    ]);
    expect(yaml.library.skills[0]?.effects).toEqual(skillEffects);
    const importArgs = {
      ...path(campaign.id),
      body: { yaml: exported.body, mode: 'merge' },
      idempotencyKey: randomUUID(),
    };
    const imported = await call(owner, 'gpc_import_campaign_library', importArgs);
    expect(
      (await callAny(owner, 'gpc_import_campaign_library', importArgs)).structured.body,
    ).toEqual(imported.body);
    const library = (
      await call<{ traits: Array<{ effects: unknown[] }>; skills: Array<{ effects: unknown[] }> }>(
        owner,
        'gpc_get_campaign_library',
        path(campaign.id),
      )
    ).body;
    expect(library.traits[0]?.effects).toEqual(yaml.library.traits[0]?.effects);
    expect(library.skills[0]?.effects).toEqual(skillEffects);

    const character = (
      await call<{ id: string }>(owner, 'gpc_create_character', {
        body: { name: 'Owned effects', campaignId: campaign.id },
      })
    ).body;
    const inventory = (
      await call<{ item: { id: string } }>(owner, 'gpc_create_inventory_item', {
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
      await call<{ trait: { id: string; customEffects: unknown[] } }>(
        owner,
        'gpc_create_character_trait',
        createArgs,
      )
    ).body;
    expect(created.trait.customEffects).toEqual(customEffects);
    expect(
      (await callAny(owner, 'gpc_create_character_trait', createArgs)).structured.body,
    ).toEqual(created);
    const detail = (
      await call<{ traits: unknown[]; effects: unknown[] }>(
        owner,
        'gpc_get_character',
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
      await call<HistoryEventOut[]>(owner, 'gpc_get_character_history', {
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
        'gpc_create_library_trait',
        {
          ...path(campaign.id),
          body: { name: 'Invalid', kind: 'advantage', effects: customEffects },
        },
        422,
      ],
      [
        'gpc_create_library_skill',
        {
          ...path(campaign.id),
          body: { name: 'Invalid', attribute: 'DX', difficulty: 'A', effects: customEffects },
        },
        422,
      ],
      [
        'gpc_update_character_trait',
        {
          ...path(character.id, { traitId: created.trait.id }),
          body: { customEffects: [{ target: 'weapon_damage', value: 1 }] },
        },
        422,
      ],
      [
        'gpc_update_character_trait',
        {
          ...path(character.id, { traitId: created.trait.id }),
          body: { customEffects: [{ ...customEffects[0], target: 'weapon_parry' }] },
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
    const deniedRest = await previewRest(member, 'gpc_update_character_trait', deniedArgs);
    const deniedMcp = await callAny(member, 'gpc_update_character_trait', deniedArgs);
    expect(deniedRest.status).toBe(403);
    expect(deniedMcp.structured.body).toEqual(deniedRest.body);
    const privateRead = await call<Record<string, unknown>>(
      member,
      'gpc_get_character',
      path(character.id),
    );
    expect(privateRead.body).toMatchObject({ view: 'minimal' });
    expect(privateRead.body).not.toHaveProperty('effects');
    expect(privateRead.body).not.toHaveProperty('traits');
    await call(owner, 'gpc_update_character_trait', { ...traitPath, body: { customEffects: [] } });
    const cleared = await call<{ effects: unknown[] }>(
      owner,
      'gpc_get_character',
      path(character.id),
    );
    expect(cleared.body.effects).toEqual([]);
  });
});
