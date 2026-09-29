import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { userOut } from '../../shared/schemas/auth.ts';
import { createApp } from '../app.ts';
import { appUrl } from '../config.ts';
import { closeDb, getDb } from '../db/client.ts';
import { oauthAccessTokens, oauthClients, oauthGrants, users } from '../db/schema.ts';
import { productionHttps } from '../https.ts';
import { resolveOAuthAccessToken } from '../oauth/service.ts';
import { createOpenApiApp } from '../openapi/app.ts';
import type { TrustedExecutionContext } from '../services/executionContext.ts';
import { stopUserPurgeMaintenance } from '../services/userPurge.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { executeOperation } from './executor.ts';
import { type IncludedOperation, TOOLS } from './operationManifest.ts';

const operation: IncludedOperation = {
  kind: 'tool',
  method: 'POST',
  path: '/api/v1/test-operation',
  tool: 'test_operation',
  scope: 'gpc:write',
  destructive: false,
  openWorld: false,
  handler: 'shared-openapi-handler',
  schemaSource: 'openapi-zod-registry',
  resultMode: 'compact-mutation-ack',
  parityTests: [
    'src/server/mcp/parity.integration.test.ts#executes-success-and-rest-differential',
    'src/server/mcp/parity.integration.test.ts#enforces-declared-oauth-scope',
  ],
};
const context: TrustedExecutionContext = {
  user: {
    id: randomUUID(),
    email: 'executor@example.com',
    displayName: 'Executor',
    suspendedAt: null,
    authMethod: 'oauth',
    authVersion: 1,
    authenticatedAt: null,
  },
  oauthClientDbId: randomUUID(),
  oauthClientId: 'executor-test',
  oauthGrantId: randomUUID(),
  scopes: ['gpc:write'],
};

describe('production MCP reads through the real authenticated route graph', () => {
  const config = {
    ...integrationTestConfig,
    environment: 'production' as const,
    appHostname: 'gpc.example',
    trustProxy: true,
  };
  const resource = `${appUrl(config)}/mcp`;
  const userId = randomUUID();
  const clientDbId = randomUUID();
  const grantId = randomUUID();
  const accessToken = `gpco_${randomUUID()}`;
  let app: ReturnType<typeof createApp>;
  let actor: TrustedExecutionContext;
  let expectedUser: ReturnType<typeof userOut.parse>;

  beforeAll(async () => {
    configureIntegrationTestEnvironment();
    // Production rejects filesystem media storage. These read-only fixtures
    // need no object store; select the production backend during app creation.
    const previousStorage = process.env.MEDIA_STORAGE;
    try {
      process.env.MEDIA_STORAGE = 's3';
      app = createApp(config);
    } finally {
      if (previousStorage === undefined) Reflect.deleteProperty(process.env, 'MEDIA_STORAGE');
      else process.env.MEDIA_STORAGE = previousStorage;
    }
    const [user] = await getDb()
      .insert(users)
      .values({
        id: userId,
        email: `executor-production-${userId}@example.com`,
        displayName: 'Production MCP Reader',
        passwordHash: 'unused-password-fixture',
      })
      .returning();
    if (!user) throw new Error('Production MCP user fixture was not inserted');
    expectedUser = userOut.parse({
      ...user,
      createdAt: user.createdAt.toISOString(),
      suspendedAt: null,
    });
    await getDb()
      .insert(oauthClients)
      .values({
        id: clientDbId,
        clientId: `executor-production-${clientDbId}`,
        name: 'Production MCP reader',
        registrationMethod: 'dynamic',
        redirectUris: ['http://127.0.0.1/callback'],
        allowedScopes: ['gpc:read'],
      });
    await getDb()
      .insert(oauthGrants)
      .values({
        id: grantId,
        userId,
        clientId: clientDbId,
        scopes: ['gpc:read'],
        resource,
        authVersion: user.authVersion,
      });
    await getDb()
      .insert(oauthAccessTokens)
      .values({
        grantId,
        tokenHash: createHash('sha256').update(accessToken).digest('hex'),
        scopes: ['gpc:read'],
        expiresAt: new Date(Date.now() + 60_000),
      });
    const principal = await resolveOAuthAccessToken(config, accessToken, resource);
    actor = {
      user: principal.user,
      oauthClientDbId: principal.clientDbId,
      oauthClientId: principal.clientId,
      oauthGrantId: principal.grantId,
      scopes: principal.scopes,
    };
  }, 30_000);

  afterAll(async () => {
    try {
      await getDb().delete(users).where(eq(users.id, userId));
      await getDb().delete(oauthClients).where(eq(oauthClients.id, clientDbId));
    } finally {
      await stopUserPurgeMaintenance();
      await closeDb();
    }
  });

  it('executes GET /auth/me without redirecting and returns the canonical user schema', async () => {
    const me = TOOLS.find((entry) => entry.tool === 'get_current_user');
    if (!me) throw new Error('get_current_user operation is missing');
    const response = await executeOperation(app, actor, me, {});

    expect(response.status).toBe(200);
    expect(response.headers.has('location')).toBe(false);
    const body = await response.json();
    expect(userOut.parse(body)).toEqual(expectedUser);
    expect(body).toEqual(expectedUser);
  });

  for (const name of ['get_current_user', 'list_campaigns']) {
    it(`returns a validated successful ${name} tools/call result`, async () => {
      // Enter through the mounted MCP endpoint: real token authorization,
      // executeOperation, shared route authorization and response validation.
      const response = await app.request(resource, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: {} },
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.has('location')).toBe(false);
      const envelope = (await response.json()) as {
        error?: unknown;
        result: { isError?: boolean; structuredContent: { status: number; body: unknown } };
      };
      expect(envelope.error).toBeUndefined();
      expect(envelope.result.isError).not.toBe(true);
      expect(envelope.result.structuredContent.status).toBe(200);
      expect(envelope.result.structuredContent.body).toEqual(
        name === 'get_current_user' ? expectedUser : [],
      );
    });
  }

  it('still redirects external HTTP to the configured HTTPS origin', async () => {
    const response = await app.request('http://external.example/api/v1/auth/me?probe=1', {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://gpc.example/api/v1/auth/me?probe=1');
  });

  it('does not grant external HTTPS requests the trusted execution authority', async () => {
    const response = await app.request('https://gpc.internal/api/v1/auth/me', {
      headers: { 'x-forwarded-proto': 'https', 'x-user-id': userId },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });
});

describe('delegated executor transaction settlement', () => {
  afterAll(closeDb);

  it('commits a database-backed operation through the production HTTPS boundary', async () => {
    const clientId = `executor-production-${randomUUID()}`;
    const app = createOpenApiApp();
    app.use(
      '*',
      productionHttps({
        ...integrationTestConfig,
        environment: 'production',
        trustProxy: false,
        appHostname: 'gpc.example',
      }),
    );
    app.post(operation.path, async (c) => {
      await getDb()
        .insert(oauthClients)
        .values({
          clientId,
          name: 'Production dispatch fixture',
          redirectUris: ['http://127.0.0.1/callback'],
          allowedScopes: ['gpc:read'],
        });
      return c.json({ ok: true }, 201);
    });

    try {
      const response = await executeOperation(app, context, operation, {});
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ ok: true });
      expect(
        await getDb().select().from(oauthClients).where(eq(oauthClients.clientId, clientId)),
      ).toHaveLength(1);
    } finally {
      await getDb().delete(oauthClients).where(eq(oauthClients.clientId, clientId));
    }
  });

  for (const status of [422, 500] as const) {
    it(`rolls back writes when the shared handler returns ${status}`, async () => {
      const clientId = `executor-rollback-${status}-${randomUUID()}`;
      const app = createOpenApiApp();
      app.post('/api/v1/test-operation', async (c) => {
        await getDb()
          .insert(oauthClients)
          .values({
            clientId,
            name: 'Must roll back',
            redirectUris: ['http://127.0.0.1/callback'],
            allowedScopes: ['gpc:read'],
          });
        return c.json({ error: 'deliberate' }, status);
      });

      if (status === 500) {
        await expect(executeOperation(app, context, operation, {})).rejects.toThrow(
          'shared operation failed',
        );
      } else {
        const response = await executeOperation(app, context, operation, {});
        expect(response.status).toBe(422);
      }
      expect(
        await getDb().select().from(oauthClients).where(eq(oauthClients.clientId, clientId)),
      ).toHaveLength(0);
    });
  }
});
