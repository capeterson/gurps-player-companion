import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { productionHttps } from '../https.ts';
import { createOpenApiApp } from '../openapi/app.ts';
import {
  type TrustedExecutionContext,
  currentTrustedExecution,
  trustedExecutionFor,
} from '../services/executionContext.ts';
import { integrationTestConfig } from '../testConfig.ts';
import { executeOperation } from './executor.ts';
import type { IncludedOperation } from './operationManifest.ts';

// Synthetic media handlers exercise the real request dispatch without a database:
// media operations deliberately do not use the executor's outer transaction.
// Database-backed route and OAuth parity remain covered by integration suites.
const context: TrustedExecutionContext = {
  user: {
    id: randomUUID(),
    email: 'executor-https@example.com',
    displayName: 'Executor HTTPS',
    suspendedAt: null,
    authMethod: 'oauth',
    authVersion: 1,
    authenticatedAt: null,
  },
  oauthClientDbId: randomUUID(),
  oauthClientId: 'executor-https-test',
  oauthGrantId: randomUUID(),
  scopes: ['gpc:read', 'gpc:write'],
};

function mediaOperation(method: 'GET' | 'POST', path: string): IncludedOperation {
  return {
    kind: 'tool',
    method,
    path,
    tool: 'media',
    scope: method === 'GET' ? 'gpc:read' : 'gpc:write',
    destructive: false,
    openWorld: false,
    handler: 'shared-openapi-handler',
    schemaSource: 'openapi-zod-registry',
    resultMode: method === 'GET' ? 'canonical-read' : 'compact-mutation-ack',
    parityTests: [
      'src/server/mcp/parity.integration.test.ts#executes-success-and-rest-differential',
      'src/server/mcp/parity.integration.test.ts#enforces-declared-oauth-scope',
    ],
  };
}

function productionApp(trustProxy: boolean) {
  const app = createOpenApiApp();
  let reachedHandler = false;
  app.use(
    '*',
    productionHttps({
      ...integrationTestConfig,
      environment: 'production',
      trustProxy,
      appHostname: 'gpc.example',
    }),
  );
  app.all('*', async (c) => {
    reachedHandler = true;
    return c.json({
      path: c.req.path,
      protocol: new URL(c.req.url).protocol,
      query: c.req.query(),
      ...(c.req.method === 'POST' ? { body: await c.req.json() } : {}),
      trusted: trustedExecutionFor(c.req.raw) === context,
      ambient: currentTrustedExecution() === context,
    });
  });
  return { app, handlerReached: () => reachedHandler };
}

describe('MCP executor through the production HTTPS boundary', () => {
  it('dispatches production reads without requiring proxy headers when trustProxy is enabled', async () => {
    const { app, handlerReached } = productionApp(true);
    const response = await executeOperation(
      app,
      context,
      mediaOperation('GET', '/api/v1/media/capabilities'),
      { query: { section: ['items', 'skills'], search: 'sword & shield' } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(await response.json()).toEqual({
      path: '/api/v1/media/capabilities',
      protocol: 'https:',
      query: { section: 'items', search: 'sword & shield' },
      trusted: true,
      ambient: true,
    });
    expect(handlerReached()).toBe(true);
  });

  it('dispatches POST JSON with path/query encoding when proxy trust is disabled', async () => {
    const { app, handlerReached } = productionApp(false);
    const response = await executeOperation(
      app,
      context,
      mediaOperation('POST', '/api/v1/media/capabilities/{id}'),
      {
        path: { id: 'media/id' },
        query: { lookup: 'clientUploadId', repeated: ['one', 'two'] },
        body: { name: 'Portrait', value: 3 },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: '/api/v1/media/capabilities/media%2Fid',
      protocol: 'https:',
      query: { lookup: 'clientUploadId', repeated: 'one' },
      body: { name: 'Portrait', value: 3 },
      trusted: true,
      ambient: true,
    });
    expect(handlerReached()).toBe(true);
  });

  it('continues to redirect external plain HTTP requests', async () => {
    const { app, handlerReached } = productionApp(true);
    const response = await app.request('http://external.example/api/v1/media/capabilities');

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://gpc.example/api/v1/media/capabilities');
    expect(handlerReached()).toBe(false);
  });
});
