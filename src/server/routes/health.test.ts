import { describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { createApp } from '../app.ts';
import { getDb, runInDbTransaction } from '../db/client.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

describe('readiness', () => {
  it('reports the running release and is never cached', async () => {
    const response = await app.request('/api/v1/readyz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      release: process.env.APP_RELEASE ?? 'development',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('fails when the image migration is missing but leaves liveness available', async () => {
    const migration = readMigrationFiles({ migrationsFolder: 'src/server/db/migrations' }).at(-1);
    if (!migration) throw new Error('Missing test migration manifest');
    const hash = migration.hash;
    // Change is rolled back; other suites and the dev server keep their schema.
    const rollback = new Error('rollback fixture');
    await expect(
      runInDbTransaction(async () => {
        await getDb().execute(sql`delete from drizzle.__drizzle_migrations where hash = ${hash}`);
        const response = await app.request('/api/v1/readyz');
        expect(response.status).toBe(503);
        expect((await response.json()).ok).toBe(false);
        expect((await app.request('/api/v1/healthz')).status).toBe(200);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});

describe('readiness while draining', () => {
  it('fails readiness and asks clients to reconnect, while liveness stays up', async () => {
    const { _resetDrainingForTests, beginDraining } = await import('../lifecycle.ts');
    beginDraining();
    try {
      const response = await app.request('/api/v1/readyz');
      expect(response.status).toBe(503);
      expect((await response.json()).ok).toBe(false);
      expect(response.headers.get('connection')).toBe('close');
      expect((await app.request('/api/v1/healthz')).status).toBe(200);
    } finally {
      _resetDrainingForTests();
    }
  });
});
