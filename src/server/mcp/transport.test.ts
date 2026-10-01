import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { OAuthPrincipal } from '../oauth/service.ts';
import { OAuthError } from '../oauth/service.ts';
import { createOpenApiApp } from '../openapi/app.ts';
import { integrationTestConfig } from '../testConfig.ts';
import { buildToolCatalog, toolsForScopes } from './catalog.ts';
import {
  MAX_MCP_BODY_BYTES,
  createMcpHandler,
  describeMcpTool,
  mutationAcknowledgement,
  readBoundedMcpJson,
} from './transport.ts';
import { CHARACTER_UI_URI, MCP_APP_MIME_TYPE, characterUiResource } from './ui.ts';

const document = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
const config = { ...integrationTestConfig, appHostname: 'localhost', port: 3001 };
const resource = 'http://localhost:3001/mcp';
function principal(): OAuthPrincipal {
  return {
    user: {
      id: randomUUID(),
      email: 'reader@example.com',
      displayName: 'Reader',
      suspendedAt: null,
      authMethod: 'oauth',
      authVersion: 1,
      authenticatedAt: null,
    },
    grantId: randomUUID(),
    clientDbId: randomUUID(),
    clientId: 'transport-tests',
    scopes: ['gpc:read'],
    expiresAt: new Date(Date.now() + 60_000),
    resource,
    experimentalMcpUi: true,
  };
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(resource, {
    method: 'POST',
    headers: {
      authorization: 'Bearer gpco_test',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
function handler(
  options: {
    principal?: OAuthPrincipal;
    resolveFailure?: Error;
    executeFailure?: Error;
    executeResponse?: () => Response;
    readUiFailure?: boolean;
  } = {},
) {
  const actor = options.principal ?? principal();
  let executed = 0;
  let readUiCalls = 0;
  const handle = createMcpHandler(config, createOpenApiApp(), document, {
    async readUi() {
      readUiCalls++;
      if (options.readUiFailure) throw new Error('private filesystem error');
      return { contents: [{ ...characterUiResource, text: '<html>Generic character UI</html>' }] };
    },
    async resolvePrincipal() {
      if (options.resolveFailure) throw options.resolveFailure;
      return actor;
    },
    async execute() {
      executed++;
      if (options.executeFailure) throw options.executeFailure;
      if (options.executeResponse) return options.executeResponse();
      return Response.json([]);
    },
  });
  return { handle, executed: () => executed, readUiCalls: () => readUiCalls, actor };
}
const listing = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const readCall = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'list_characters', arguments: {} },
};

describe('MCP Apps character resource', () => {
  test('advertises shared and focused detail UIs and preserves tool hints', async () => {
    const { handle } = handler();
    const result = await (await handle(request(listing))).json();
    const tools = result.result.tools as Array<{
      name: string;
      _meta: Record<string, unknown>;
      annotations: Record<string, unknown>;
    }>;
    expect(tools.find((tool) => tool.name === 'get_character')).toMatchObject({
      _meta: { ui: { resourceUri: CHARACTER_UI_URI } },
      annotations: { readOnlyHint: true },
    });
    expect(
      tools
        .filter((tool) => tool._meta.ui)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['get_campaign_library_skill', 'get_character', 'get_character_inventory_item']);
  });

  test('initialization advertises resources and reads a generic, uncached shell without domain execution', async () => {
    const { handle, executed } = handler();
    const initialized = await (
      await handle(
        request({
          jsonrpc: '2.0',
          id: 8,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        }),
      )
    ).json();
    expect(initialized.result.capabilities).toMatchObject({ tools: {}, resources: {} });
    const listed = await (
      await handle(request({ jsonrpc: '2.0', id: 9, method: 'resources/list' }))
    ).json();
    expect(listed.result.resources).toEqual([characterUiResource]);
    const response = await handle(
      request({
        jsonrpc: '2.0',
        id: 10,
        method: 'resources/read',
        params: { uri: CHARACTER_UI_URI },
      }),
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      result: {
        contents: [
          {
            uri: CHARACTER_UI_URI,
            mimeType: MCP_APP_MIME_TYPE,
            text: '<html>Generic character UI</html>',
            _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
          },
        ],
      },
    });
    expect(executed()).toBe(0);
  });

  test('resource access requires read scope and unknown resources never touch the filesystem', async () => {
    const actor = principal();
    actor.scopes = ['gpc:write'];
    const { handle } = handler({ principal: actor });
    const listed = await (
      await handle(request({ jsonrpc: '2.0', id: 11, method: 'resources/list' }))
    ).json();
    expect(listed.result.resources).toEqual([]);
    const denied = await handle(
      request({
        jsonrpc: '2.0',
        id: 12,
        method: 'resources/read',
        params: { uri: CHARACTER_UI_URI },
      }),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get('www-authenticate')).toContain('gpc:read');
    const unknown = await handler().handle(
      request({
        jsonrpc: '2.0',
        id: 13,
        method: 'resources/read',
        params: { uri: 'file:///etc/passwd' },
      }),
    );
    const unknownResult = await unknown.json();
    expect(unknownResult.error.code).toBe(-32602);
    expect(unknownResult.error.message).toContain('Unknown UI resource');
  });

  test('account feature gate hides UI metadata/resources but leaves ordinary tools available', async () => {
    const actor = principal();
    actor.experimentalMcpUi = false;
    const { handle, executed, readUiCalls } = handler({ principal: actor });
    const listedTools = await (await handle(request(listing))).json();
    const tools = listedTools.result.tools as Array<{ name: string; _meta?: { ui?: unknown } }>;
    expect(tools.find((tool) => tool.name === 'get_character')).toBeDefined();
    expect(tools.filter((tool) => tool._meta?.ui)).toEqual([]);

    const listedResources = await (
      await handle(request({ jsonrpc: '2.0', id: 21, method: 'resources/list' }))
    ).json();
    expect(listedResources.result.resources).toEqual([]);
    const denied = await handle(
      request({
        jsonrpc: '2.0',
        id: 22,
        method: 'resources/read',
        params: { uri: CHARACTER_UI_URI },
      }),
    );
    expect(denied.status).toBe(200);
    const deniedResult = await denied.json();
    expect(deniedResult.error.code).toBe(-32602);
    expect(deniedResult.error.message).toContain('Unknown UI resource');
    expect(readUiCalls()).toBe(0);

    const ordinary = await handle(request(readCall));
    expect(ordinary.status).toBe(200);
    expect(executed()).toBe(1);
  });

  test('refreshes the MCP UI gate on every request on the same handler', async () => {
    const actor = principal();
    actor.experimentalMcpUi = false;
    const { handle } = handler({ principal: actor });
    const toolList = async () =>
      (await handle(request({ jsonrpc: '2.0', id: 31, method: 'tools/list' }))).json();
    const resourceList = async () =>
      (await handle(request({ jsonrpc: '2.0', id: 32, method: 'resources/list' }))).json();
    expect(
      (await toolList()).result.tools.filter(
        (tool: { _meta?: { ui?: unknown } }) => tool._meta?.ui,
      ),
    ).toEqual([]);
    expect((await resourceList()).result.resources).toEqual([]);

    actor.experimentalMcpUi = true;
    expect(
      (await toolList()).result.tools
        .filter((tool: { _meta?: { ui?: unknown } }) => tool._meta?.ui)
        .map((tool: { name: string }) => tool.name)
        .sort(),
    ).toEqual(['get_campaign_library_skill', 'get_character', 'get_character_inventory_item']);
    expect((await resourceList()).result.resources).toEqual([characterUiResource]);

    actor.experimentalMcpUi = false;
    expect(
      (await toolList()).result.tools.filter(
        (tool: { _meta?: { ui?: unknown } }) => tool._meta?.ui,
      ),
    ).toEqual([]);
    expect((await resourceList()).result.resources).toEqual([]);
  });

  test('missing builds produce an actionable error without server paths', async () => {
    const response = await handler({ readUiFailure: true }).handle(
      request({
        jsonrpc: '2.0',
        id: 14,
        method: 'resources/read',
        params: { uri: CHARACTER_UI_URI },
      }),
    );
    const result = await response.json();
    expect(result.error.message).toContain('build the MCP UI assets');
    expect(JSON.stringify(result)).not.toContain('private filesystem');
  });
});

describe('MCP streaming request boundary', () => {
  test('stops an oversized chunked request before reading the remaining stream', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(400_000));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const input = new Request(resource, { method: 'POST', body });
    await expect(readBoundedMcpJson(input)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(100);
  });

  test('checks Content-Length and rejects malformed UTF-8/JSON', async () => {
    const tooLarge = new Request(resource, {
      method: 'POST',
      headers: { 'content-length': String(MAX_MCP_BODY_BYTES + 1) },
      body: '{}',
    });
    await expect(readBoundedMcpJson(tooLarge)).rejects.toMatchObject({ status: 413 });
    await expect(
      readBoundedMcpJson(new Request(resource, { method: 'POST', body: '{' })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readBoundedMcpJson(new Request(resource, { method: 'POST', body: new Uint8Array([0xff]) })),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await readBoundedMcpJson(new Request(resource, { method: 'POST', body: '{"ok":true}' })),
    ).toEqual({ ok: true });
  });
});

describe('compact mutation acknowledgements', () => {
  test('prefers the affected child and falls back to the most specific path id', () => {
    const childId = '0198aa77-1111-7111-8111-111111111111';
    const characterId = '0198aa77-2222-7222-8222-222222222222';
    expect(
      mutationAcknowledgement(
        {
          item: { id: childId, revision: 7, name: 'Spear' },
          character: { id: characterId, revision: 12, inventory: [] },
        },
        { path: { id: characterId } },
        { method: 'POST', path: '/api/v1/characters/{id}/inventory' },
      ),
    ).toEqual({ acknowledged: true, resourceId: childId, revision: 7 });
    expect(
      mutationAcknowledgement(
        null,
        { path: { id: characterId, itemId: childId } },
        { method: 'DELETE', path: '/api/v1/characters/{id}/inventory/{itemId}' },
      ),
    ).toEqual({ acknowledged: true, resourceId: childId });
  });

  test('uses canonical path order and identifies deleted children instead of returned parents', () => {
    const childId = '0198aa77-1111-7111-8111-111111111111';
    const characterId = '0198aa77-2222-7222-8222-222222222222';
    const operation = {
      method: 'DELETE' as const,
      path: '/api/v1/characters/{id}/skills/{skillId}',
    };
    for (const path of [
      { id: characterId, skillId: childId },
      { skillId: childId, id: characterId },
    ]) {
      // Character child DELETE handlers return the refreshed character detail.
      for (const body of [null, { id: characterId, revision: 12, skills: [] }]) {
        expect(mutationAcknowledgement(body, { path }, operation)).toEqual({
          acknowledged: true,
          resourceId: childId,
        });
      }
    }
    expect(
      mutationAcknowledgement(
        { id: childId, revision: 7 },
        { path: { id: characterId, skillId: childId } },
        operation,
      ),
    ).toEqual({ acknowledged: true, resourceId: childId, revision: 7 });
  });

  test('never reports a media retry alias as the canonical asset ID', () => {
    const clientUploadId = '0198aa77-1111-7111-8111-111111111111';
    const assetId = '0198aa77-2222-7222-8222-222222222222';
    const operation = { method: 'DELETE' as const, path: '/api/v1/media/uploads/{id}' };
    const input = { path: { id: clientUploadId }, query: { lookup: 'clientUploadId' } };
    expect(mutationAcknowledgement({ id: assetId }, input, operation)).toEqual({
      acknowledged: true,
      resourceId: assetId,
    });
    expect(mutationAcknowledgement(null, input, operation)).toEqual({ acknowledged: true });
    expect(mutationAcknowledgement(null, { path: { id: assetId } }, operation)).toEqual({
      acknowledged: true,
      resourceId: assetId,
    });
  });
});

describe('MCP protocol and OAuth transport', () => {
  test('bounds concurrent envelope parsing and releases capacity after responses settle', async () => {
    const actor = principal();
    let entered = 0;
    let signalReady!: () => void;
    const allEntered = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = createMcpHandler(config, createOpenApiApp(), document, {
      async resolvePrincipal() {
        entered++;
        if (entered === 4) signalReady();
        await gate;
        return actor;
      },
      async execute() {
        return Response.json([]);
      },
    });
    const pending = Array.from({ length: 4 }, () => handle(request(listing)));
    await allEntered;

    const rejected = await handle(request(listing));
    expect(rejected.status).toBe(503);
    expect(rejected.headers.get('retry-after')).toBe('1');

    release();
    expect((await Promise.all(pending)).every((response) => response.status === 200)).toBe(true);
    expect((await handle(request(listing))).status).toBe(200);
  });

  test('live tools/list uses the same schemas and hints as the shared catalog projection', async () => {
    const { handle, actor } = handler();
    const response = await handle(request(listing));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: unknown[] } };
    const expected = toolsForScopes(buildToolCatalog(document), actor.scopes).map((tool) =>
      describeMcpTool(tool, actor.experimentalMcpUi),
    );
    expect(body.result.tools).toEqual(expected);
    expect(body.result.tools).toContainEqual(expect.objectContaining({ name: 'list_characters' }));
    expect(body.result.tools).not.toContainEqual(
      expect.objectContaining({ name: 'gpc_list_characters' }),
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    const media = body.result.tools.find((tool) => (tool as { name?: string }).name === 'media') as
      | {
          _meta?: {
            actions?: Array<{
              action: string;
              requiredScope: string;
              operation: string;
              resultMode: string;
            }>;
          };
        }
      | undefined;
    expect(media?._meta?.actions).toEqual([
      {
        action: 'capabilities',
        requiredScope: 'gpc:read',
        operation: 'GET /api/v1/media/capabilities',
        resultMode: 'canonical-read',
      },
      {
        action: 'status',
        requiredScope: 'gpc:read',
        operation: 'GET /api/v1/media/uploads/{id}',
        resultMode: 'canonical-read',
      },
    ]);
  });

  test('marks only email invitations as open-world operations', () => {
    const annotations = new Map(
      buildToolCatalog(document).map((tool) => [
        tool.policy.tool,
        describeMcpTool(tool).annotations,
      ]),
    );
    expect(annotations.get('list_characters')?.openWorldHint).toBe(false);
    expect(annotations.get('character')?.openWorldHint).toBe(false);
    expect(annotations.get('campaign_member')?.openWorldHint).toBe(false);
    expect(annotations.get('invite_campaign_member')?.openWorldHint).toBe(true);
  });

  test('stateless SDK supports successive list/call requests and typed output', async () => {
    const fixture = handler();
    expect((await fixture.handle(request(listing))).status).toBe(200);
    const response = await fixture.handle(request(readCall));
    expect(await response.json()).toMatchObject({
      result: { structuredContent: { status: 200, body: [] } },
    });
    expect(fixture.executed()).toBe(1);
  });

  test('successful writes return the compact acknowledgement without duplicating it as text', async () => {
    const actor = principal();
    actor.scopes = ['gpc:write'];
    const fixture = handler({
      principal: actor,
      executeResponse: () => new Response(null, { status: 204 }),
    });
    const response = await fixture.handle(
      request({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'notification', arguments: { action: 'mark_all_read' } },
      }),
    );
    expect(await response.json()).toMatchObject({
      result: {
        content: [{ type: 'text', text: 'HTTP 204; result is available in structuredContent.' }],
        structuredContent: {
          status: 204,
          contentType: 'application/json',
          body: { acknowledged: true },
        },
      },
    });
  });

  test('successful reads keep the payload only in structuredContent', async () => {
    const fixture = handler();
    const response = await fixture.handle(request(readCall));
    expect(await response.json()).toMatchObject({
      result: {
        content: [{ type: 'text', text: 'HTTP 200; result is available in structuredContent.' }],
        structuredContent: { status: 200, body: [] },
      },
    });
  });

  test('insufficient scope challenges at HTTP level and never executes a write', async () => {
    const fixture = handler();
    const response = await fixture.handle(
      request({
        ...readCall,
        params: { name: 'character', arguments: { action: 'create', body: { name: 'Nope' } } },
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(response.headers.get('www-authenticate')).toContain('scope="gpc:write"');
    expect(fixture.executed()).toBe(0);
  });

  test('grouped library deletes require manage scope and disappear from write-only discovery', async () => {
    const actor = principal();
    actor.scopes = ['gpc:read', 'gpc:write'];
    const fixture = handler({ principal: actor });
    const discovery = await fixture.handle(request(listing));
    const payload = (await discovery.json()) as {
      result: {
        tools: Array<{
          name: string;
          annotations: { readOnlyHint: boolean; destructiveHint: boolean };
          _meta: { actions?: Array<{ action: string }> };
        }>;
      };
    };
    for (const name of ['library_source', 'library_modifier']) {
      const listed = payload.result.tools.find((tool) => tool.name === name);
      expect(listed?._meta.actions?.map((action) => action.action).sort()).toEqual([
        'create',
        'update',
      ]);
      expect(listed?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      const denied = await fixture.handle(
        request({
          ...readCall,
          params: { name, arguments: { action: 'delete', path: { id: randomUUID() } } },
        }),
      );
      expect(denied.status).toBe(403);
      expect(denied.headers.get('www-authenticate')).toContain('scope="gpc:manage"');
    }
    expect(fixture.executed()).toBe(0);
  });

  test('media actions select strict schemas, enforce each action scope, and validate selected outputs', async () => {
    const invalid = handler();
    const unknownAction = await invalid.handle(
      request({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'media', arguments: { action: 'remove-everything' } },
      }),
    );
    expect(await unknownAction.json()).toMatchObject({
      result: { isError: true, structuredContent: { status: 422 } },
    });
    const mixedAction = await invalid.handle(
      request({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'media',
          arguments: { action: 'capabilities', body: { base64: 'not-allowed-here' } },
        },
      }),
    );
    expect(await mixedAction.json()).toMatchObject({
      result: { isError: true, structuredContent: { status: 422 } },
    });
    expect(invalid.executed()).toBe(0);

    const readOnly = handler();
    const write = await readOnly.handle(
      request({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: { name: 'media', arguments: { action: 'upload', body: {} } },
      }),
    );
    expect(write.status).toBe(403);
    expect(write.headers.get('www-authenticate')).toContain('scope="gpc:write"');
    expect(readOnly.executed()).toBe(0);

    const wrongOutput = handler({
      executeResponse: () =>
        Response.json({
          id: '0198aa77-1111-7111-8111-111111111111',
          state: 'ready',
          thumbUrl: null,
          displayUrl: null,
          width: 24,
          height: 16,
          reason: null,
        }),
    });
    const capabilities = await wrongOutput.handle(
      request({
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: { name: 'media', arguments: { action: 'capabilities' } },
      }),
    );
    expect(await capabilities.json()).toMatchObject({
      result: {
        isError: true,
        structuredContent: { status: 500, body: { error: 'response_contract_error' } },
      },
    });
    expect(wrongOutput.executed()).toBe(1);
  });

  test('media cancel acknowledgements retain the asset ID for direct and retry-alias lookups', async () => {
    const clientUploadId = randomUUID();
    const assetId = randomUUID();
    const actor = principal();
    actor.scopes = ['gpc:write'];
    const fixture = handler({
      principal: actor,
      executeResponse: () =>
        Response.json({
          id: assetId,
          state: 'cancelled',
          thumbUrl: null,
          displayUrl: null,
          width: null,
          height: null,
          reason: null,
        }),
    });
    for (const lookup of [undefined, 'assetId', 'clientUploadId']) {
      const response = await fixture.handle(
        request({
          jsonrpc: '2.0',
          id: 16,
          method: 'tools/call',
          params: {
            name: 'media',
            arguments: {
              action: 'cancel',
              path: { id: lookup === 'clientUploadId' ? clientUploadId : assetId },
              ...(lookup ? { query: { lookup } } : {}),
            },
          },
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: {
          structuredContent: {
            status: 200,
            body: { acknowledged: true, resourceId: assetId },
          },
        },
      });
    }
    expect(fixture.executed()).toBe(3);
  });

  test('discovery challenges distinguish missing/invalid credentials from verification outages', async () => {
    const noAuth = await handler().handle(request(listing, { authorization: '' }));
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get('www-authenticate')).toContain(
      '/.well-known/oauth-protected-resource/mcp',
    );
    const invalid = await handler({
      resolveFailure: new OAuthError('invalid_token', 'private detail'),
    }).handle(request(listing));
    expect(invalid.status).toBe(401);
    expect(await invalid.text()).not.toContain('private detail');
    const unavailable = await handler({ resolveFailure: new Error('postgres secret host') }).handle(
      request(listing),
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('www-authenticate')).toBeNull();
    expect(await unavailable.text()).not.toContain('postgres');
  });

  test('invalid Origin, methods, and malformed JSON remain uncached protocol responses', async () => {
    const fixture = handler();
    const origin = await fixture.handle(request(listing, { origin: 'https://evil.example' }));
    expect(origin.status).toBe(403);
    expect(origin.headers.get('cache-control')).toBe('no-store');
    const unsupported = await fixture.handle(new Request(resource, { method: 'DELETE' }));
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get('allow')).toBe('POST');
    const malformed = await fixture.handle(
      new Request(resource, { method: 'POST', headers: request(listing).headers, body: '{' }),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32700 },
      id: null,
    });
  });

  test('internal execution failures do not disclose server errors or claim rollback', async () => {
    const response = await handler({
      executeFailure: new Error('secret postgres connection string'),
    }).handle(request(readCall));
    const text = await response.text();
    expect(text).not.toContain('secret postgres');
    expect(text).toContain('operation_failed');
    expect(text).toContain('same idempotency key');
  });
});
