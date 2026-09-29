/**
 * Playwright configuration for end-to-end smoke tests.
 *
 * Tests run against the worktree's host-mapped Docker port,
 * `http://localhost:3001`; spin the dev stack with
 * `docker compose -f docker-compose.dev.yml up` before invoking
 * `bun run test:e2e`.
 *
 * MCP_E2E_START_SERVER=1 starts the app for local delegated-access acceptance.
 * Its public origin and registered OAuth client come from the environment.
 * Named image promotion instead starts the candidate container itself and
 * points this suite at it without asking Playwright to start a server.
 */

import { constants, accessSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Chromium drops capabilities that can let the runner bypass directory modes.
// Check ordinary user permissions as well as an actual write before launching.
const browserTmpDir = tmpdir();
let tempProbe: string | undefined;
try {
  const directory = statSync(browserTmpDir);
  const uid = process.getuid?.();
  const groups = process.getgroups?.() ?? [];
  const gid = process.getgid?.();
  if (gid !== undefined) groups.push(gid);
  const mask = directory.uid === uid ? 0o300 : groups.includes(directory.gid) ? 0o030 : 0o003;
  if (uid !== undefined && (directory.mode & mask) !== mask) {
    throw new Error('Directory permissions do not allow Chromium to write and traverse it');
  }
  accessSync(browserTmpDir, constants.W_OK | constants.X_OK);
  tempProbe = mkdtempSync(join(browserTmpDir, 'gpc-playwright-preflight-'));
  writeFileSync(join(tempProbe, 'write-check'), 'ok');
} catch (cause) {
  throw new Error(
    `Playwright TMPDIR ${browserTmpDir} is not writable by Chromium. Mount a writable disk directory or worktree-specific Docker volume and set TMPDIR to it.`,
    { cause },
  );
} finally {
  if (tempProbe) rmSync(tempProbe, { recursive: true, force: true });
}

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
const CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  ...(process.env.MCP_E2E_START_SERVER === '1'
    ? {
        webServer: {
          command:
            process.env.MCP_E2E_BUILT_SERVER === '1'
              ? 'bun run dist/server/index.js'
              : 'bun run dev',
          url: new URL('/api/v1/healthz', BASE_URL).toString(),
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }
    : {}),
  use: {
    baseURL: BASE_URL,
    ...(CHROMIUM_EXECUTABLE ? { launchOptions: { executablePath: CHROMIUM_EXECUTABLE } } : {}),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
