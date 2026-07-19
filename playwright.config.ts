/**
 * Playwright configuration for end-to-end smoke tests.
 *
 * Tests run against the worktree's host-mapped Docker port,
 * `http://localhost:3001`; spin the dev stack with
 * `docker compose -f docker-compose.dev.yml up` before invoking
 * `bun run test:e2e`.
 *
 * CI wiring is deferred — local-first developer ergonomics first; we
 * add a `webServer` block once we move dependency installation off
 * Docker and into the CI image.
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
const CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
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
