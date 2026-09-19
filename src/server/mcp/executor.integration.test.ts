import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../db/client.ts';
import { oauthClients } from '../db/schema.ts';
import { createOpenApiApp } from '../openapi/app.ts';
import type { TrustedExecutionContext } from '../services/executionContext.ts';
import { executeOperation } from './executor.ts';
import type { IncludedOperation } from './operationManifest.ts';

const operation: IncludedOperation = {
  kind: 'tool',
  method: 'POST',
  path: '/api/v1/test-operation',
  tool: 'gpc_test_operation',
  scope: 'gpc:write',
  destructive: false,
  handler: 'shared-openapi-handler',
  schemaSource: 'openapi-zod-registry',
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

describe('delegated executor transaction settlement', () => {
  afterAll(closeDb);

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
