import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { configureIntegrationTestEnvironment } from '../testConfig.ts';

configureIntegrationTestEnvironment();

it('migration 0063 defaults existing and new campaigns off and preserves later opt-ins on rerun', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const sql = readFileSync(
    `${import.meta.dir}/migrations/0063_experimental_active_effects.sql`,
    'utf8',
  );
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE campaigns DROP COLUMN experimental_active_effects');
    const owner = await client.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Feature flag test') RETURNING id",
      [`active-effects-migration-${crypto.randomUUID()}@example.com`],
    );
    const beforeUpgrade = await client.query<{ id: string }>(
      "INSERT INTO campaigns (owner_id, name) VALUES ($1, 'Existing campaign') RETURNING id",
      [owner.rows[0]?.id],
    );
    const existingId = beforeUpgrade.rows[0]?.id;
    if (!existingId) throw new Error('Missing pre-upgrade campaign');

    await client.query(sql);
    const upgraded = await client.query<{ experimental_active_effects: boolean }>(
      'SELECT experimental_active_effects FROM campaigns WHERE id = $1',
      [existingId],
    );
    expect(upgraded.rows[0]?.experimental_active_effects).toBe(false);

    await client.query('UPDATE campaigns SET experimental_active_effects = true WHERE id = $1', [
      existingId,
    ]);
    await client.query(sql);
    const afterRerun = await client.query<{ experimental_active_effects: boolean }>(
      'SELECT experimental_active_effects FROM campaigns WHERE id = $1',
      [existingId],
    );
    expect(afterRerun.rows[0]?.experimental_active_effects).toBe(true);

    const insertedAfterUpgrade = await client.query<{ experimental_active_effects: boolean }>(
      "INSERT INTO campaigns (owner_id, name) VALUES ($1, 'New campaign') RETURNING experimental_active_effects",
      [owner.rows[0]?.id],
    );
    expect(insertedAfterUpgrade.rows[0]?.experimental_active_effects).toBe(false);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}, 30_000);
