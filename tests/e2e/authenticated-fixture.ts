import { randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';

type WorkerAccount = { email: string; password: string };

/**
 * For independent layout tests: reuse one synthetic actor per worker, but keep
 * browser contexts, token sessions, Dexie databases and created rows test-local.
 * Auth/bootstrap and account-mutation scenarios use the ordinary fixture.
 */
export const test = base.extend<Record<never, never>, { workerAccount: WorkerAccount }>({
  workerAccount: [
    async ({ playwright }, use, workerInfo) => {
      const account = {
        email: `layout-worker-${workerInfo.workerIndex}-${randomUUID()}@example.com`,
        password: 'CorrectHorseBatteryStaple1',
      };
      const baseURL = workerInfo.project.use.baseURL;
      if (!baseURL) throw new Error('Authenticated layout fixture requires a configured baseURL');
      const client = await playwright.request.newContext({ baseURL });
      try {
        const response = await client.post('/api/v1/auth/register', {
          data: { ...account, displayName: 'Responsive QA' },
        });
        expect(response.status(), await response.text()).toBe(201);
        await use(account);
      } finally {
        await client.dispose();
      }
    },
    { scope: 'worker' },
  ],
  page: async ({ page, workerAccount }, use) => {
    // A new token pair prevents refresh rotation in one context invalidating
    // another case's copied session. Each worker executes its cases serially.
    const response = await page.request.post('/api/v1/auth/login', { data: workerAccount });
    expect(response.status(), await response.text()).toBe(200);
    const tokens = await response.json();
    const snapshot = {
      ...tokens,
      sessionId: randomUUID(),
      version: 0,
      refreshRequestId: randomUUID(),
    };
    await page.context().addInitScript((pair) => {
      if (!localStorage.getItem('gpc.tokenPair.v1')) {
        localStorage.setItem('gpc.tokenPair.v1', JSON.stringify(pair));
      }
    }, snapshot);
    await page.goto('/');
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
    await use(page);
  },
});
