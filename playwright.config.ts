/**
 * Playwright configuration for end-to-end smoke tests.
 *
 * The suite is intentionally tiny right now — `tests/e2e/smoke.spec.ts`
 * only verifies that the SPA boots, the login form renders, and
 * registration → login → sheet round-trips against a running stack.
 * Tests run against `http://localhost:3000`; spin the dev stack with
 * `docker compose -f docker-compose.dev.yml up` before invoking
 * `bun run test:e2e`.
 *
 * CI wiring is deferred — local-first developer ergonomics first; we
 * add a `webServer` block once we move dependency installation off
 * Docker and into the CI image.
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
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
