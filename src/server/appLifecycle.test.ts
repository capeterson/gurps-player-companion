import { describe, expect, it } from 'bun:test';

// Seeds, refreshes and contract generators reuse the API in-process. Building the
// app must not start server maintenance (notably the notification LISTEN session),
// or those scripts never exit after closing the database pool.
const script = `
import { createApp } from './src/server/app.ts';
import { closeDb } from './src/server/db/client.ts';
import { integrationTestConfig } from './src/server/testConfig.ts';
createApp({ ...integrationTestConfig, environment: 'development' });
await closeDb();
`;

describe('createApp process lifecycle', () => {
  it('lets a development script exit after building the app', async () => {
    const child = Bun.spawn(['bun', '-e', script], {
      cwd: new URL('../../', import.meta.url).pathname,
      env: { ...process.env, ENVIRONMENT: 'development', NODE_ENV: 'development' },
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const outcome = await Promise.race([
      child.exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20_000)),
    ]);
    if (outcome === 'timeout') child.kill();
    expect(outcome, await new Response(child.stderr).text()).toBe(0);
  }, 30_000);
});
