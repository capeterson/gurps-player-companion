/**
 * Emit the current OpenAPI document to stdout.
 *
 * Used by `bun run openapi:emit` to refresh `docs/openapi.json` whenever
 * routes change.  CI runs `openapi:check` against the committed file so
 * route changes that aren't reflected in the spec fail the build.
 */

import { createApp } from '../app.ts';
import type { AppConfig } from '../config.ts';

const config: AppConfig = {
  environment: 'development',
  port: 3000,
  host: '0.0.0.0',
  databaseUrl: 'postgres://emit-only-no-db@localhost/none',
  jwtSecret: 'spec-emit-only-secret-which-is-deliberately-very-long',
  jwtAccessTtlMinutes: 15,
  jwtRefreshTtlDays: 14,
  apiKeyPepper: 'spec-emit-only-secret-which-is-deliberately-very-long',
  corsOrigins: [],
};

const app = createApp(config);
const doc = app.getOpenAPIDocument({
  openapi: '3.0.0',
  info: {
    title: 'GURPS Player Companion API',
    version: '0.1.0',
    description: 'Local-first GURPS character + campaign companion.',
  },
});

process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
