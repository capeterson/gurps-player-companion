import { createRoute, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { getDb } from '../db/client.ts';
import { createOpenApiApp } from '../openapi/app.ts';

const healthSchema = z.object({ ok: z.boolean(), release: z.string() }).openapi('Health');

const healthRoute = createRoute({
  method: 'get',
  path: '/healthz',
  tags: ['health'],
  summary: 'Liveness probe',
  responses: {
    200: {
      description: 'Server is alive',
      content: { 'application/json': { schema: healthSchema } },
    },
  },
});

export const healthRouter = createOpenApiApp();
healthRouter.openapi(healthRoute, (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, release: process.env.APP_RELEASE ?? 'development' }, 200);
});

const readyRoute = createRoute({
  method: 'get',
  path: '/readyz',
  tags: ['health'],
  summary: 'Database and migration readiness probe',
  responses: {
    200: {
      description: 'Postgres 18 is reachable and this image’s migrations are applied',
      content: { 'application/json': { schema: healthSchema } },
    },
    503: {
      description: 'Database unavailable or required migrations missing',
      content: { 'application/json': { schema: healthSchema } },
    },
  },
});

let requiredMigrationHash: string | undefined;
healthRouter.openapi(readyRoute, async (c) => {
  c.header('Cache-Control', 'no-store');
  const release = process.env.APP_RELEASE ?? 'development';
  try {
    requiredMigrationHash ??= readMigrationFiles({
      migrationsFolder: 'src/server/db/migrations',
    }).at(-1)?.hash;
    if (!requiredMigrationHash) throw new Error('missing migration manifest');
    const ready = await getDb().transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '2s'`);
      const result = await tx.execute<{ ready: boolean }>(sql`
        select current_setting('server_version_num')::integer between 180000 and 189999
          and exists(select 1 from drizzle.__drizzle_migrations
            where hash = ${requiredMigrationHash}) as ready
      `);
      return result.rows[0]?.ready === true;
    });
    return c.json({ ok: ready, release }, ready ? 200 : 503);
  } catch {
    // Do not disclose database errors, credentials, or schema internals.
    return c.json({ ok: false, release }, 503);
  }
});
