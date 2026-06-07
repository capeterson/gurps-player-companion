/**
 * Drift check: compare the live-generated OpenAPI document against the
 * committed snapshot at `docs/openapi.json`.  Exits non-zero if they
 * differ so CI fails when routes are added/changed without re-running
 * `bun run openapi:emit`.
 */

import { readFile } from 'node:fs/promises';
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
  resendApiKey: undefined,
  resendFromEmail: undefined,
  appBaseUrl: undefined,
};

const SNAPSHOT_PATH = 'docs/openapi.json';

const app = createApp(config);
const generated = app.getOpenAPIDocument({
  openapi: '3.0.0',
  info: {
    title: 'GURPS Player Companion API',
    version: '0.1.0',
    description: 'Local-first GURPS character + campaign companion.',
  },
});
const generatedJson = `${JSON.stringify(generated, null, 2)}\n`;

let committed: string;
try {
  committed = await readFile(SNAPSHOT_PATH, 'utf8');
} catch {
  console.error(`OpenAPI: ${SNAPSHOT_PATH} is missing. Run \`bun run openapi:emit\` and commit.`);
  process.exit(1);
}

if (generatedJson !== committed) {
  console.error(
    `OpenAPI drift detected: ${SNAPSHOT_PATH} is stale.\nRun \`bun run openapi:emit\` and commit the result.`,
  );
  process.exit(1);
}

console.log(`OpenAPI: ${SNAPSHOT_PATH} is in sync.`);
