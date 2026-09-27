/** Exercise migration 0055 against legacy rows inside a rolled-back transaction. */
import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { configureIntegrationTestEnvironment } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const migration = readFileSync(
  `${import.meta.dir}/migrations/0055_library_rule_backfill.sql`,
  'utf8',
);
const statements = migration
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);

it('migration 0055 preserves modifier precision and fills nullable legacy weapon mode values', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owner = await client.query<{ id: string }>(
      "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Backfill test') RETURNING id",
      [`library-backfill-${crypto.randomUUID()}@example.com`],
    );
    const campaign = await client.query<{ id: string }>(
      "INSERT INTO campaigns (owner_id, name) VALUES ($1, 'Backfill test') RETURNING id",
      [owner.rows[0]?.id],
    );
    const campaignId = campaign.rows[0]?.id;
    if (!campaignId) throw new Error('Missing campaign fixture');

    await client.query(
      `INSERT INTO campaign_library_traits (campaign_id, name, kind, available_modifiers)
       VALUES ($1, 'Legacy trait', 'advantage', $2::jsonb)`,
      [
        campaignId,
        JSON.stringify([
          { name: 'Fine', category: 'enhancement', costType: 'percent', costValue: 0.001 },
        ]),
      ],
    );
    await client.query(
      `INSERT INTO campaign_library_items (campaign_id, name, weapon_data)
       VALUES ($1, 'Legacy blade', $2::jsonb)`,
      [
        campaignId,
        JSON.stringify({
          damage: 'thr+1',
          reach: '1',
          parry: '0',
          skill: 'Broadsword',
          stRequired: 10,
          ranged: { range: '100/200' },
          alternateModes: [
            {
              name: 'Swing',
              damage: 'sw+2',
              reach: null,
              parry: null,
              skill: null,
              stRequired: null,
              ranged: null,
            },
          ],
        }),
      ],
    );

    for (const statement of statements) await client.query(statement);

    const modifierRows = await client.query<{
      available_modifiers: Array<{ calculation: { outputs: Array<{ increment: number }> } }>;
    }>('SELECT available_modifiers FROM campaign_library_traits WHERE campaign_id = $1', [
      campaignId,
    ]);
    expect(modifierRows.rows[0]?.available_modifiers[0]?.calculation.outputs[0]?.increment).toBe(
      0.001,
    );

    const itemRows = await client.query<{
      weapon_data: {
        modes: Array<{
          name: string;
          reach?: string;
          parry?: string;
          skill?: string;
          stRequired?: number;
          ranged?: unknown;
        }>;
      };
    }>('SELECT weapon_data FROM campaign_library_items WHERE campaign_id = $1', [campaignId]);
    const modes = itemRows.rows[0]?.weapon_data.modes;
    expect(modes).toHaveLength(2);
    expect(modes?.[1]).toMatchObject({
      name: 'Swing',
      reach: '1',
      parry: '0',
      skill: 'Broadsword',
      stRequired: 10,
    });
    // Explicit legacy null remains an explicit no-ranged override.
    expect(modes?.[1]).not.toHaveProperty('ranged');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
