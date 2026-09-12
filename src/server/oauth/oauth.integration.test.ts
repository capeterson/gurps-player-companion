import { afterAll, describe, expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { createApp } from '../app.ts';
import type { AppConfig } from '../config.ts';
import { closeDb } from '../db/client.ts';
import { integrationTestConfig } from '../testConfig.ts';

const redirectUri = 'http://127.0.0.1:49152/callback';
const config: AppConfig = {
  ...integrationTestConfig,
  appBaseUrl: 'http://localhost:3001',
  oauthClients: [
    {
      clientId: 'oauth-integration-client',
      name: 'OAuth integration client',
      redirectUris: [redirectUri],
      scopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
    },
  ],
  authRateLimitRegisterMax: 10_000,
  authRateLimitLoginMax: 10_000,
};

function challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function issueGrant(scopes = 'gpc:read gpc:write') {
  const app = createApp(config);
  const email = `oauth-${randomUUID()}@example.com`;
  const registered = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: 'OAuth Player' }),
  });
  expect(registered.status).toBe(201);
  const session = (await registered.json()) as { accessToken: string };
  const verifier = 'a'.repeat(43);
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'oauth-integration-client',
    redirect_uri: redirectUri,
    code_challenge: challenge(verifier),
    code_challenge_method: 'S256',
    scope: scopes,
    state: randomUUID(),
    resource: 'http://localhost:3001/mcp',
  });
  const details = await app.request(`/api/v1/oauth/authorization?${query}`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  expect(details.status).toBe(200);
  const consent = (await details.json()) as { csrfToken: string };
  const approved = await app.request('/api/v1/oauth/authorization', {
    method: 'POST',
    headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ...Object.fromEntries(query),
      csrf_token: consent.csrfToken,
      decision: 'approve',
    }),
  });
  expect(approved.status).toBe(200);
  const { redirectTo } = (await approved.json()) as { redirectTo: string };
  const code = new URL(redirectTo).searchParams.get('code');
  expect(code).toBeTruthy();
  if (!code) throw new Error('authorization redirect omitted code');
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: 'oauth-integration-client',
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
    resource: 'http://localhost:3001/mcp',
  });
  const exchanged = await app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  expect(exchanged.status).toBe(200);
  const tokens = (await exchanged.json()) as { access_token: string; refresh_token: string };
  return { app, session, tokens, form };
}

describe('delegated OAuth and MCP', () => {
  afterAll(closeDb);

  it('publishes canonical discovery and rejects app API use of OAuth tokens', async () => {
    const { app, tokens } = await issueGrant('gpc:read');
    const metadata = await app.request('/.well-known/oauth-protected-resource/mcp');
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get('cache-control')).toBe('no-store');
    expect(await metadata.json()).toMatchObject({ resource: 'http://localhost:3001/mcp' });
    const api = await app.request('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(api.status).toBe(401);
  });

  it('scopes OAuth body and rate limits to token and revocation endpoints', async () => {
    const quotaSource = `quota-${randomUUID()}`;
    const limited = createApp({
      ...config,
      trustProxy: true,
      authRateLimitChallengeMax: 1,
    });
    const mcpRequest = () =>
      limited.request('/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-forwarded-for': quotaSource,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'quota-regression', version: '1' },
          },
        }),
      });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await mcpRequest()).status).toBe(401);
    }

    const largeApiResponse = await limited.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': quotaSource },
      body: JSON.stringify({ email: `${'a'.repeat(70_000)}@example.com`, password: 'irrelevant' }),
    });
    expect(largeApiResponse.status).not.toBe(413);

    const invalidTokenForm = new URLSearchParams({
      grant_type: 'unsupported',
      client_id: 'oauth-integration-client',
      resource: 'http://localhost:3001/mcp',
    });
    const firstOAuthRequest = await limited.request('/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': quotaSource,
      },
      body: invalidTokenForm,
    });
    expect(firstOAuthRequest.status).toBe(400);
    expect(await firstOAuthRequest.json()).toMatchObject({ error: 'unsupported_grant_type' });
    const secondOAuthRequest = await limited.request('/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': quotaSource,
      },
      body: invalidTokenForm,
    });
    expect(secondOAuthRequest.status).toBe(429);

    for (const path of ['/oauth/token', '/oauth/revoke']) {
      const oversizedRequest = new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`token=${'x'.repeat(70_000)}`));
            controller.close();
          },
        }),
      });
      const oversizedResponse = await limited.fetch(oversizedRequest);
      expect(oversizedResponse.status).toBe(413);
      expect(await oversizedResponse.json()).toMatchObject({
        error: 'invalid_request',
        error_description: 'request body is too large',
      });
    }
  });

  it('enforces one-time codes, exact resource and PKCE', async () => {
    const { app, form } = await issueGrant();
    const reused = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('rotates refresh tokens idempotently for one request id and revokes on replay', async () => {
    const { app, tokens } = await issueGrant();
    const rotate = (requestId: string) =>
      app.request('/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'oauth-integration-client',
          refresh_token: tokens.refresh_token,
          resource: 'http://localhost:3001/mcp',
          request_id: requestId,
        }),
      });
    const requestId = randomUUID();
    const first = await rotate(requestId);
    const firstBody = (await first.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      scope: string;
      expires_in: number;
    };
    const retry = await rotate(requestId);
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as typeof firstBody;
    expect(retryBody).toMatchObject({
      access_token: firstBody.access_token,
      refresh_token: firstBody.refresh_token,
      token_type: firstBody.token_type,
      scope: firstBody.scope,
    });
    expect(retryBody.expires_in).toBeGreaterThan(0);
    expect(retryBody.expires_in).toBeLessThanOrEqual(firstBody.expires_in);
    const replay = await rotate(randomUUID());
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
    const descendant = firstBody;
    const denied = await app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${descendant.access_token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      }),
    });
    expect(denied.status).toBe(401);
  });

  it('negotiates MCP 2025-11-25 and exposes only granted-scope tools', async () => {
    const { app, tokens } = await issueGrant('gpc:read');
    const call = (body: unknown) =>
      app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify(body),
      });
    const initialized = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    });
    expect(initialized.status).toBe(200);
    expect(await initialized.json()).toMatchObject({ result: { protocolVersion: '2025-11-25' } });
    const listed = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(listed.status).toBe(200);
    const payload = (await listed.json()) as {
      result?: { tools: Array<{ name: string }> };
      error?: unknown;
    };
    expect(payload.error).toBeUndefined();
    expect(payload.result?.tools.some((tool) => tool.name === 'gpc_get_current_user')).toBe(true);
    expect(payload.result?.tools.some((tool) => tool.name === 'gpc_create_character')).toBe(false);
    const called = await call({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'gpc_get_current_user', arguments: {} },
    });
    expect(called.status).toBe(200);
    const callPayload = (await called.json()) as {
      result: { structuredContent: { body: { displayName: string } } };
    };
    expect(callPayload.result.structuredContent.body.displayName).toBe('OAuth Player');
  });

  it('executes mutations through the shared route graph with durable retry and audit provenance', async () => {
    const { app, session, tokens } = await issueGrant('gpc:read gpc:write gpc:manage');
    const callTool = async (name: string, args: unknown) => {
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: randomUUID(),
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<{
        result: { isError?: boolean; structuredContent: { status: number; body: unknown } };
      }>;
    };
    const idempotencyKey = randomUUID();
    const created = await callTool('gpc_create_character', {
      body: { name: 'Agent Character' },
      idempotencyKey,
    });
    expect(created.result.isError).not.toBe(true);
    const createdBody = created.result.structuredContent.body as { id: string };
    const replayed = await callTool('gpc_create_character', {
      body: { name: 'Agent Character' },
      idempotencyKey,
    });
    expect(replayed.result.structuredContent.body).toEqual(createdBody);
    const conflict = await callTool('gpc_create_character', {
      body: { name: 'Different Character' },
      idempotencyKey,
    });
    expect(conflict.result.isError).toBe(true);
    expect(conflict.result.structuredContent.status).toBe(409);

    const history = await app.request(`/api/v1/characters/${createdBody.id}/history`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(history.status).toBe(200);
    const events = (await history.json()) as Array<{
      agentClientName: string | null;
      agentGrantId: string | null;
    }>;
    expect(events[0]?.agentClientName).toBe('OAuth integration client');
    expect(events[0]?.agentGrantId).toBeTruthy();
  });

  it('returns OAuth protocol errors for unsupported grants and unknown scopes', async () => {
    const { app, session } = await issueGrant('gpc:read');
    const unsupported = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'oauth-integration-client',
        resource: 'http://localhost:3001/mcp',
      }),
    });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({ error: 'unsupported_grant_type' });

    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'oauth-integration-client',
      redirect_uri: redirectUri,
      code_challenge: challenge('b'.repeat(43)),
      code_challenge_method: 'S256',
      scope: 'gpc:read gpc:unknown',
      state: randomUUID(),
      resource: 'http://localhost:3001/mcp',
    });
    const unknownScope = await app.request(`/api/v1/oauth/authorization?${query}`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(unknownScope.status).toBe(400);
    expect(await unknownScope.json()).toMatchObject({ error: expect.stringContaining('scope') });
  });

  it('bounds chunked token bodies before form parsing without hanging on the cloned tee', async () => {
    const chunk = new Uint8Array(40_000).fill(0x61);
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
        if (pulls === 2) controller.close();
      },
    });
    const response = await createApp(config).fetch(
      new Request('http://localhost:3001/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('invalidates existing tokens immediately when configured client scopes narrow', async () => {
    const { app, tokens } = await issueGrant('gpc:read gpc:write');
    const configured = config.oauthClients[0];
    if (!configured) throw new Error('missing configured OAuth client');
    const originalScopes = configured.scopes;
    configured.scopes = ['gpc:read'];
    try {
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('invalid_token');
    } finally {
      configured.scopes = originalScopes;
    }
  });
});
