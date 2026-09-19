import { createApp } from '../app.ts';
import type { AppConfig } from '../config.ts';
import { buildToolCatalog } from './catalog.ts';
import { OPERATION_POLICY } from './operationManifest.ts';
import { describeMcpTool } from './transport.ts';

export const snapshotConfig: AppConfig = {
  environment: 'development',
  port: 3000,
  host: '0.0.0.0',
  databaseUrl: 'postgres://emit-only-no-db@localhost/none',
  jwtSecret: 'spec-emit-only-secret-which-is-deliberately-very-long',
  jwtAccessTtlMinutes: 15,
  jwtRefreshTtlDays: 14,
  apiKeyPepper: 'spec-emit-only-secret-which-is-deliberately-very-long',
  corsOrigins: [],
  resendApiKey: undefined,
  resendFromEmail: undefined,
  appBaseUrl: undefined,
  oauthClients: [],
  trustProxy: false,
  authRateLimitWindowSeconds: 600,
  authRateLimitLoginMax: 10,
  authRateLimitRegisterMax: 5,
  authRateLimitResetMax: 3,
  authRateLimitChallengeMax: 10,
};

export function generateMcpSnapshot() {
  const app = createApp(snapshotConfig);
  const document = app.getOpenAPIDocument({
    openapi: '3.0.0',
    info: { title: 'GURPS Player Companion API', version: '0.1.0' },
  });
  const catalog = buildToolCatalog(document, app.openAPIRegistry.definitions);
  return {
    protocolVersion: '2025-11-25',
    operations: OPERATION_POLICY,
    tools: catalog.map((entry) => ({
      ...describeMcpTool(entry),
      operation: `${entry.policy.method} ${entry.policy.path}`,
      scope: entry.policy.scope,
      destructive: entry.policy.destructive,
      handler: entry.policy.handler,
      schemaSource: entry.policy.schemaSource,
      parityTests: entry.policy.parityTests,
    })),
  };
}
