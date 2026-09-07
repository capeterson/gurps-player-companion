/**
 * Migration 0028 (language-trait backfill) executed verbatim against a
 * seeded character.
 *
 * The migration has already run against the test database by the time
 * these tests execute, so re-running it here is also the idempotency
 * check the migration's doc comment promises: a rerun must not duplicate
 * rows and must be a no-op once the source traits are gone.
 *
 * Requires a live Postgres. Skipped when DATABASE_URL is not set (the
 * same guard historyTriggers.test.ts uses).
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const DB_URL = process.env.DATABASE_URL;

const MIGRATION_SQL = readFileSync(
  join(import.meta.dir, 'migrations/0028_language_trait_backfill.sql'),
  'utf-8',
);

/** The migration's statements, split on drizzle's breakpoint marker. */
const STATEMENTS = MIGRATION_SQL.split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

let pool: Pool | null = null;

beforeAll(() => {
  if (!DB_URL) return;
  pool = new Pool({ connectionString: DB_URL });
});

afterAll(async () => {
  if (pool) await pool.end();
});

async function runBackfill(): Promise<void> {
  if (!pool) return;
  for (const statement of STATEMENTS) {
    await pool.query(statement);
  }
}

/** Seed a user + character and return the character id. */
async function seedCharacter(suffix: string): Promise<string> {
  if (!pool) throw new Error('no pool');
  const email = `backfill-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const { rows: userRows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, 'x', 'Backfill Test') RETURNING id`,
    [email],
  );
  const userId = userRows[0]?.id as string;
  const { rows: charRows } = await pool.query<{ id: string }>(
    'INSERT INTO characters (owner_id, name) VALUES ($1, $2) RETURNING id',
    [userId, `Backfill ${suffix}`],
  );
  return charRows[0]?.id as string;
}

describe('migration 0028 — language trait backfill', () => {
  it('moves kind=language traits into character_languages, preserving points', async () => {
    if (!pool) {
      console.log('Skipping language backfill test: DATABASE_URL not set');
      return;
    }
    const characterId = await seedCharacter('basic');
    await pool.query(
      `INSERT INTO character_traits (character_id, kind, name, points, notes)
       VALUES ($1, 'language', 'Latin', 3, 'from the abbey'),
              ($1, 'language', 'Aramaic', 1, NULL),
              ($1, 'advantage', 'Combat Reflexes', 15, NULL)`,
      [characterId],
    );

    await runBackfill();

    const { rows: languages } = await pool.query<{
      name: string;
      spoken_fluency: string;
      written_fluency: string;
      points: number;
      notes: string | null;
    }>(
      `SELECT name, spoken_fluency, written_fluency, points, notes
       FROM character_languages WHERE character_id = $1 ORDER BY name`,
      [characterId],
    );
    expect(languages).toHaveLength(2);
    expect(languages[0]).toMatchObject({
      name: 'Aramaic',
      spoken_fluency: 'native',
      written_fluency: 'none',
      points: 1,
      notes: null,
    });
    expect(languages[1]).toMatchObject({
      name: 'Latin',
      points: 3,
      notes: 'from the abbey',
    });

    const { rows: traits } = await pool.query<{ kind: string; name: string }>(
      'SELECT kind, name FROM character_traits WHERE character_id = $1',
      [characterId],
    );
    // The language traits are gone; the advantage is untouched.
    expect(traits).toEqual([{ kind: 'advantage', name: 'Combat Reflexes' }]);
  });

  it('leaves the character point total unchanged (advantages -> languages only)', async () => {
    if (!pool) return;
    const characterId = await seedCharacter('total');
    await pool.query(
      `INSERT INTO character_traits (character_id, kind, name, points)
       VALUES ($1, 'language', 'Latin', 3)`,
      [characterId],
    );
    await runBackfill();

    const { rows } = await pool.query<{ trait_points: string; language_points: string }>(
      `SELECT
         coalesce((SELECT sum(points) FROM character_traits WHERE character_id = $1), 0) AS trait_points,
         coalesce((SELECT sum(points) FROM character_languages WHERE character_id = $1), 0) AS language_points`,
      [characterId],
    );
    expect(Number(rows[0]?.trait_points)).toBe(0);
    expect(Number(rows[0]?.language_points)).toBe(3);
  });

  it('is idempotent: a rerun creates no duplicates', async () => {
    if (!pool) return;
    const characterId = await seedCharacter('idempotent');
    await pool.query(
      `INSERT INTO character_traits (character_id, kind, name, points)
       VALUES ($1, 'language', 'Latin', 3)`,
      [characterId],
    );

    await runBackfill();
    await runBackfill();
    await runBackfill();

    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM character_languages WHERE character_id = $1',
      [characterId],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('skips a trait whose language row already exists (case-insensitively)', async () => {
    if (!pool) return;
    const characterId = await seedCharacter('preexisting');
    await pool.query(
      `INSERT INTO character_languages (character_id, name, spoken_fluency, written_fluency, points)
       VALUES ($1, 'Latin', 'accented', 'native', 5)`,
      [characterId],
    );
    await pool.query(
      `INSERT INTO character_traits (character_id, kind, name, points)
       VALUES ($1, 'language', 'latin', 3)`,
      [characterId],
    );

    await runBackfill();

    const { rows } = await pool.query<{ name: string; points: number; spoken_fluency: string }>(
      'SELECT name, points, spoken_fluency FROM character_languages WHERE character_id = $1',
      [characterId],
    );
    // The richer existing row wins; no shadow duplicate is created.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Latin', points: 5, spoken_fluency: 'accented' });
    // The source trait is still removed.
    const { rows: traits } = await pool.query(
      "SELECT 1 FROM character_traits WHERE character_id = $1 AND kind = 'language'",
      [characterId],
    );
    expect(traits).toHaveLength(0);
  });

  it('clamps a negative-point language trait into the schema-valid range', async () => {
    if (!pool) return;
    const characterId = await seedCharacter('negative');
    await pool.query(
      `INSERT INTO character_traits (character_id, kind, name, points)
       VALUES ($1, 'language', 'Cursed Tongue', -2)`,
      [characterId],
    );
    await runBackfill();
    const { rows } = await pool.query<{ points: number }>(
      'SELECT points FROM character_languages WHERE character_id = $1',
      [characterId],
    );
    expect(rows[0]?.points).toBe(0);
  });

  it('writes history rows for both the insert and the delete', async () => {
    if (!pool) return;
    const characterId = await seedCharacter('history');
    await pool.query(
      `INSERT INTO character_traits (character_id, kind, name, points)
       VALUES ($1, 'language', 'Latin', 3)`,
      [characterId],
    );
    await runBackfill();

    const { rows } = await pool.query<{ entity_class: string; op: string }>(
      `SELECT entity_class, op FROM entity_history
       WHERE character_id = $1
         AND entity_class IN ('character_language', 'character_trait')
       ORDER BY revision`,
      [characterId],
    );
    // H1: the triggers fire for migration-driven writes too.
    expect(rows).toContainEqual({ entity_class: 'character_language', op: 'insert' });
    expect(rows).toContainEqual({ entity_class: 'character_trait', op: 'delete' });
  });
});
