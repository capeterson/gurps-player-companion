import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import type { AppConfig } from '../config.ts';
import { closeDb, getDb } from '../db/client.ts';
import { oauthAuthorizationCodes } from '../db/schema.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

const clientId = 'independent-boundary-review';
const redirectUri = 'http://127.0.0.1:49153/callback';
const resource = 'http://localhost:3001/mcp';
const config: AppConfig = {
  ...integrationTestConfig,
  appBaseUrl: 'http://localhost:3001',
  oauthClients: [
    {
      clientId,
      name: 'Boundary review client',
      redirectUris: [redirectUri],
      scopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
    },
  ],
  authRateLimitRegisterMax: 10_000,
};
configureIntegrationTestEnvironment();
const app = createApp(config);
const password = 'BoundaryPassword123!';
const jsonHeaders = { 'content-type': 'application/json' };

async function player() {
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      email: `boundary-${randomUUID()}@example.com`,
      password,
      displayName: 'Review Player',
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { accessToken: string; refreshToken: string };
}

async function authorization(sessionToken: string, scope = 'gpc:read') {
  const verifier = createHash('sha256').update(randomUUID()).digest('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    scope,
    state: randomUUID(),
    resource,
  });
  const headers = { ...jsonHeaders, authorization: `Bearer ${sessionToken}` };
  const detailsResponse = await app.request(`/api/v1/oauth/authorization?${query}`, { headers });
  expect(detailsResponse.status).toBe(200);
  const details = (await detailsResponse.json()) as { csrfToken: string };
  const response = await app.request('/api/v1/oauth/authorization', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...Object.fromEntries(query),
      csrf_token: details.csrfToken,
      decision: 'approve',
    }),
  });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { redirectTo: string };
  const code = new URL(result.redirectTo).searchParams.get('code');
  if (!code) throw new Error('authorization did not issue code');
  return { code, verifier };
}

async function tokenForm(fields: Record<string, string>) {
  return app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
}
function exchangeFields(code: string, verifier: string) {
  return {
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
    resource,
  };
}
async function grant(sessionToken: string, scopes = 'gpc:read') {
  const { code, verifier } = await authorization(sessionToken, scopes);
  const response = await tokenForm(exchangeFields(code, verifier));
  expect(response.status).toBe(200);
  return (await response.json()) as { access_token: string; refresh_token: string; scope: string };
}
async function listTools(token: string) {
  return app.request('/mcp', {
    method: 'POST',
    headers: {
      ...jsonHeaders,
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
}

// These exercise the actual externally reachable paths rather than calling
// private authorization helpers with pre-trusted state.
describe('independent delegated-access boundary review', () => {
  beforeEach(configureIntegrationTestEnvironment);
  afterAll(closeDb);

  for (const [field, wrong] of [
    ['code_verifier', 'b'.repeat(43)],
    ['resource', 'https://another.example/mcp'],
    ['client_id', 'another-client'],
    ['redirect_uri', 'http://127.0.0.1:49153/other'],
  ] as const) {
    test(`rejects wrong ${field} on a fresh code, while the bound exchange still succeeds`, async () => {
      const session = await player();
      const { code, verifier } = await authorization(session.accessToken);
      const fields = exchangeFields(code, verifier);
      const invalid = await tokenForm({ ...fields, [field]: wrong });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: 'invalid_grant' });
      expect((await tokenForm(fields)).status).toBe(200);
    });
  }

  test('rejects an expired code independently of replay and PKCE validation', async () => {
    const session = await player();
    const { code, verifier } = await authorization(session.accessToken);
    await getDb()
      .update(oauthAuthorizationCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthAuthorizationCodes.codeHash, createHash('sha256').update(code).digest('hex')));
    expect((await tokenForm(exchangeFields(code, verifier))).status).toBe(400);
  });

  test('approving more scopes never widens previously issued read-only access', async () => {
    const session = await player();
    const read = await grant(session.accessToken);
    const write = await grant(session.accessToken, 'gpc:read gpc:write');
    const oldResponse = await listTools(read.access_token);
    const newResponse = await listTools(write.access_token);
    expect(oldResponse.status).toBe(200);
    expect(newResponse.status).toBe(200);
    const oldCatalog = (await oldResponse.json()) as { result: { tools: Array<{ name: string }> } };
    const newCatalog = (await newResponse.json()) as { result: { tools: Array<{ name: string }> } };
    expect(oldCatalog.result.tools.some((tool) => tool.name === 'gpc_create_character')).toBe(
      false,
    );
    expect(newCatalog.result.tools.some((tool) => tool.name === 'gpc_create_character')).toBe(true);
  });

  test('password change invalidates delegated tokens and reapproval never resurrects them', async () => {
    const email = `password-boundary-${randomUUID()}@example.com`;
    const registered = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ email, password, displayName: 'Review Player' }),
    });
    const session = (await registered.json()) as { accessToken: string };
    const old = await grant(session.accessToken);
    const newPassword = 'ChangedBoundaryPassword123!';
    const changed = await app.request('/api/v1/auth/password', {
      method: 'POST',
      headers: { ...jsonHeaders, authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ currentPassword: password, newPassword }),
    });
    expect(changed.status).toBe(204);
    expect((await listTools(old.access_token)).status).toBe(401);
    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ email, password: newPassword }),
    });
    const next = (await login.json()) as { accessToken: string };
    await grant(next.accessToken, 'gpc:read gpc:write');
    expect((await listTools(old.access_token)).status).toBe(401);
  });

  test('standard OAuth refresh replay without a custom request ID commits revocation', async () => {
    const session = await player();
    const original = await grant(session.accessToken);
    const fields = {
      grant_type: 'refresh_token',
      client_id: clientId,
      resource,
      refresh_token: original.refresh_token,
    };
    const refreshed = await tokenForm(fields);
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect((await tokenForm(fields)).status).toBe(400);
    expect((await listTools(next.access_token)).status).toBe(401);
    expect((await tokenForm({ ...fields, refresh_token: next.refresh_token })).status).toBe(400);
  });

  test('revoking a connected grant invalidates existing access on the next request', async () => {
    const session = await player();
    const tokens = await grant(session.accessToken);
    const headers = { authorization: `Bearer ${session.accessToken}` };
    const listing = await app.request('/api/v1/oauth/grants', { headers });
    const grants = (await listing.json()) as Array<{ id: string }>;
    const active = grants[0];
    if (!active) throw new Error('grant missing from Settings');
    expect(
      (await app.request(`/api/v1/oauth/grants/${active.id}`, { method: 'DELETE', headers }))
        .status,
    ).toBe(204);
    expect((await listTools(tokens.access_token)).status).toBe(401);
  });

  test('external headers cannot inject an actor and app tokens cannot substitute for delegated tokens', async () => {
    const session = await player();
    const forged = await app.request('/api/v1/characters', {
      headers: {
        'x-gpc-user-id': randomUUID(),
        'x-gpc-trusted-execution': 'true',
        'x-gpc-auth-method': 'oauth',
      },
    });
    expect(forged.status).toBe(401);
    expect((await listTools(session.accessToken)).status).toBe(401);
  });
});
