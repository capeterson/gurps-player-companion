/** Exercise the upgrade and repeat application inside a rolled-back test transaction. */
import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { configureIntegrationTestEnvironment } from '../testConfig.ts';

configureIntegrationTestEnvironment();

it('migration 0037 defaults existing campaigns on, advances their cursor, and preserves later opt-outs on rerun', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const sql = readFileSync(`${import.meta.dir}/migrations/0037_campaign_house_rules.sql`, 'utf8');
  try {
    await client.query('BEGIN');
    // Recreate the pre-upgrade shape in this transaction only. The final
    // rollback restores the column and every existing value even on failure.
    await client.query('ALTER TABLE campaigns DROP COLUMN house_rules');
    const owner = await client.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Migration test') RETURNING id",
      [`house-rule-migration-${crypto.randomUUID()}@example.com`],
    );
    const created = await client.query<{ id: string; revision: string }>(
      "INSERT INTO campaigns (owner_id, name) VALUES ($1, 'Legacy campaign') RETURNING id, revision",
      [owner.rows[0]?.id],
    );
    const campaign = created.rows[0];
    if (!campaign) throw new Error('Missing campaign');
    await client.query(sql);
    const upgraded = await client.query(
      'SELECT house_rules, revision FROM campaigns WHERE id = $1',
      [campaign.id],
    );
    expect(upgraded.rows[0].house_rules).toEqual({ protectNaturalDr: true });
    expect(Number(upgraded.rows[0].revision)).toBeGreaterThan(Number(campaign.revision));
    const optedOut = await client.query(
      'UPDATE campaigns SET house_rules = \'{"protectNaturalDr":false}\'::jsonb WHERE id = $1 RETURNING revision',
      [campaign.id],
    );
    await client.query(sql);
    const repeated = await client.query(
      'SELECT house_rules, revision FROM campaigns WHERE id = $1',
      [campaign.id],
    );
    expect(repeated.rows[0].house_rules).toEqual({ protectNaturalDr: false });
    expect(repeated.rows[0].revision).toBe(optedOut.rows[0].revision);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
