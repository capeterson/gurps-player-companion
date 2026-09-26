import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { OAuthPrincipal } from '../oauth/service.ts';
import { OAuthError } from '../oauth/service.ts';
import { createOpenApiApp } from '../openapi/app.ts';
import { integrationTestConfig } from '../testConfig.ts';
import { buildToolCatalog } from './catalog.ts';
import {
  MAX_MCP_BODY_BYTES,
  createMcpHandler,
  describeMcpTool,
  mutationAcknowledgement,
  readBoundedMcpJson,
} from './transport.ts';

const document = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
const config = { ...integrationTestConfig, appBaseUrl: 'http://localhost:3001' };
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
  } = {},
) {
  const actor = options.principal ?? principal();
  let executed = 0;
  const handle = createMcpHandler(config, createOpenApiApp(), document, {
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
  return { handle, executed: () => executed, actor };
}
const listing = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const readCall = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'gpc_list_characters', arguments: {} },
};

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
    expect(pulls).toBe(3);
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
      ),
    ).toEqual({ acknowledged: true, resourceId: childId, revision: 7 });
    expect(
      mutationAcknowledgement(null, {
        path: { id: characterId, itemId: childId },
      }),
    ).toEqual({ acknowledged: true, resourceId: childId });
  });
});

describe('MCP protocol and OAuth transport', () => {
  test('live tools/list uses the same schemas and hints as the shared catalog projection', async () => {
    const { handle, actor } = handler();
    const response = await handle(request(listing));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: unknown[] } };
    const expected = buildToolCatalog(document)
      .filter((tool) => actor.scopes.includes(tool.policy.scope))
      .map(describeMcpTool);
    expect(body.result.tools).toEqual(expected);
    expect(response.headers.get('cache-control')).toBe('no-store');
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
        params: { name: 'gpc_mark_all_notifications_read', arguments: {} },
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
        params: { name: 'gpc_create_character', arguments: { body: { name: 'Nope' } } },
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(response.headers.get('www-authenticate')).toContain('scope="gpc:write"');
    expect(fixture.executed()).toBe(0);
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
