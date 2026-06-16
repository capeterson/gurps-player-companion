/**
 * Guard 1 — trigger coverage enforcement.
 *
 * Every table in SYNCABLE_TABLES must have a `record_history_trg` AFTER
 * INSERT OR UPDATE OR DELETE trigger so new entity classes can never slip
 * through without history capture.
 *
 * Requires a live Postgres. Skipped when DATABASE_URL is not set (local
 * unit test runs without a DB). CI always provides DATABASE_URL.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Pool } from 'pg';
import { SYNCABLE_TABLES } from '../../shared/schemas/history.ts';

const DB_URL = process.env.DATABASE_URL ?? process.env.DATABASE_URL;
const skip = !DB_URL;

let pool: Pool | null = null;

beforeAll(async () => {
  if (skip) return;
  pool = new Pool({ connectionString: DB_URL! });
});

afterAll(async () => {
  if (pool) await pool.end();
});

describe('entity_history trigger coverage', () => {
  it('every SYNCABLE_TABLES entry has record_history_trg', async () => {
    if (skip) {
      console.log('Skipping historyTriggers test: DATABASE_URL not set');
      return;
    }

    const client = await pool!.connect();
    try {
      const res = await client.query<{ table_name: string; trigger_name: string }>(`
        SELECT event_object_table AS table_name, trigger_name
        FROM information_schema.triggers
        WHERE trigger_name = 'record_history_trg'
          AND trigger_schema = 'public'
      `);
      const triggeredTables = new Set(res.rows.map((r) => r.table_name));

      for (const [entityClass, { table }] of Object.entries(SYNCABLE_TABLES)) {
        expect(
          triggeredTables.has(table),
          `Table "${table}" (entity class "${entityClass}") is missing the record_history_trg trigger.\n` +
            `Add AFTER INSERT OR UPDATE OR DELETE trigger "record_history_trg" on "${table}" ` +
            `(see migration 0013_entity_history.sql for the pattern).`,
        ).toBe(true);
      }
    } finally {
      client.release();
    }
  });

  it('SYNCABLE_TABLES covers every EntityClass in the enum', async () => {
    // This is a pure schema test — no DB needed.
    const { entityClass } = await import('../../shared/schemas/sync.ts');
    const enumValues = entityClass.options as string[];
    for (const cls of enumValues) {
      expect(
        cls in SYNCABLE_TABLES,
        `EntityClass "${cls}" is not in SYNCABLE_TABLES. ` +
          `Add it to src/shared/schemas/history.ts when adding a new entity class.`,
      ).toBe(true);
    }
  });
});
