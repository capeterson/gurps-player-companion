import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  await pool.query('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

describe('commit-safe revision allocation', () => {
  it('serializes revision allocation until the earlier allocating transaction commits', async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      const firstRevision = Number(
        (await first.query<{ revision: string }>('SELECT next_sync_revision() AS revision')).rows[0]
          ?.revision,
      );

      await second.query('BEGIN');
      const secondAllocation = second
        .query<{ revision: string }>('SELECT next_sync_revision() AS revision')
        .then((result) => Number(result.rows[0]?.revision));
      expect(
        await Promise.race([
          secondAllocation.then(() => 'allocated'),
          Bun.sleep(50).then(() => 'blocked'),
        ]),
      ).toBe('blocked');

      await first.query('COMMIT');
      expect(await secondAllocation).toBeGreaterThan(firstRevision);
      await second.query('COMMIT');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
  });

  it('routes live-row defaults, history, and every tombstone wrapper through the fence', async () => {
    const defaults = await pool.query<{ table_name: string; column_default: string }>(`
      SELECT table_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'revision'
        AND table_name IN (
          'campaigns', 'campaign_memberships', 'characters', 'character_traits',
          'character_skills', 'character_spells', 'character_languages',
          'character_techniques', 'inventory_items', 'combat_states',
          'campaign_library_traits', 'campaign_library_skills',
          'campaign_library_spells', 'campaign_library_items',
          'campaign_library_languages', 'campaign_library_techniques',
          'campaign_library_styles', 'adventure_log_entries', 'entity_history'
        )
    `);
    expect(defaults.rows).toHaveLength(19);
    for (const row of defaults.rows) {
      expect(row.column_default, row.table_name).toContain('next_sync_revision()');
    }

    const wrappers = await pool.query<{ name: string; definition: string }>(`
      SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'record_character_tombstone', 'record_character_child_tombstone',
          'record_campaign_tombstone', 'record_combat_tombstone'
        )
    `);
    expect(wrappers.rows).toHaveLength(4);
    for (const row of wrappers.rows) {
      expect(row.definition, row.name).toContain('next_sync_revision()');
    }
  });
});
