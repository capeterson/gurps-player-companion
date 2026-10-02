/** Run migration 0068 against legacy-shaped tables in a rolled-back schema. */
import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Pool, type PoolClient } from 'pg';
import { configureIntegrationTestEnvironment } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const migration = readFileSync(
  `${import.meta.dir}/migrations/0068_sourcebook_uuid_references.sql`,
  'utf8',
);
const statements = migration
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);

async function createLegacySchema(client: PoolClient, schema: string): Promise<void> {
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET LOCAL search_path TO ${schema}, public`);
  await client.query(`
    CREATE TABLE campaign_library_sources (
      id uuid PRIMARY KEY,
      campaign_id uuid NOT NULL,
      name text NOT NULL,
      key text NOT NULL,
      abbreviation text NOT NULL,
      edition text,
      UNIQUE (campaign_id, key)
    );
    CREATE TABLE characters (id uuid PRIMARY KEY, campaign_id uuid, race jsonb);
    CREATE TABLE character_traits (
      id uuid PRIMARY KEY,
      character_id uuid NOT NULL,
      pricing_resolution jsonb,
      modifiers jsonb NOT NULL DEFAULT '[]'::jsonb
    );
    CREATE TABLE inventory_items (
      id uuid PRIMARY KEY,
      character_id uuid NOT NULL,
      pricing_resolution jsonb
    );
    CREATE TABLE campaign_library_races (
      id uuid PRIMARY KEY,
      campaign_id uuid NOT NULL,
      name text NOT NULL,
      kind varchar(16) NOT NULL DEFAULT 'race',
      key text NOT NULL DEFAULT '',
      source_key text
    );
  `);
  for (const table of [
    'campaign_library_traits',
    'campaign_library_skills',
    'campaign_library_spells',
    'campaign_library_items',
    'campaign_library_languages',
    'campaign_library_techniques',
    'campaign_library_styles',
    'campaign_library_enchantments',
    'campaign_library_active_effects',
    'campaign_library_modifiers',
  ]) {
    const fields =
      table === 'campaign_library_traits'
        ? `kind text, calculation jsonb, available_modifiers jsonb NOT NULL DEFAULT '[]'::jsonb`
        : table === 'campaign_library_modifiers'
          ? 'calculation jsonb, applicability jsonb'
          : table === 'campaign_library_enchantments'
            ? `applicability varchar(16) NOT NULL DEFAULT 'any'`
            : '';
    await client.query(`
      CREATE TABLE ${table} (
        id uuid PRIMARY KEY,
        campaign_id uuid NOT NULL,
        name text NOT NULL,
        key text NOT NULL DEFAULT '',
        source_key text${fields ? `, ${fields}` : ''}
      )
    `);
  }
}

async function applyMigration(client: PoolClient): Promise<void> {
  for (const statement of statements) await client.query(statement);
}

async function withIsolatedSchema<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const schema = `sourcebook_migration_${crypto.randomUUID().replaceAll('-', '')}`;
    await createLegacySchema(client, schema);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}

const campaignOne = '10000000-0000-4000-8000-000000000001';
const campaignTwo = '10000000-0000-4000-8000-000000000002';
const sourceOne = '20000000-0000-4000-8000-000000000001';
const sourceTwo = '20000000-0000-4000-8000-000000000002';
const traitId = '30000000-0000-4000-8000-000000000001';
const itemDefinitionId = '30000000-0000-4000-8000-000000000005';
const raceDefinitionId = '30000000-0000-4000-8000-000000000008';
const lensDefinitionId = '30000000-0000-4000-8000-000000000009';
const characterId = '40000000-0000-4000-8000-000000000001';

it('migration 0068 resolves campaign-scoped references and preserves detached purchase snapshots', async () => {
  await withIsolatedSchema(async (client) => {
    await client.query(
      `INSERT INTO campaign_library_sources (id, campaign_id, name, key, abbreviation) VALUES
       ($1, $2, 'Core One', 'Core', 'C1'), ($3, $4, 'Core Two', 'Core', 'C2')`,
      [sourceOne, campaignOne, sourceTwo, campaignTwo],
    );
    await client.query(
      `INSERT INTO campaign_library_traits
         (id, campaign_id, name, kind, source_key, calculation, available_modifiers)
       VALUES ($1, $2, 'Trait', 'advantage', ' cOrE ', $3::jsonb, $4::jsonb),
              ('30000000-0000-4000-8000-000000000002', $5, 'Unattributed', 'advantage', NULL, NULL, '[]')`,
      [
        traitId,
        campaignOne,
        JSON.stringify({ inputs: [{ sourceKey: 'CORE', cost: 75 }], outputs: [{ amount: 12 }] }),
        JSON.stringify([{ calculation: { inputs: [{ sourceKey: 'core', paid: 9 }] } }]),
        campaignTwo,
      ],
    );
    await client.query(
      `INSERT INTO campaign_library_modifiers (id, campaign_id, name, source_key, applicability)
       VALUES ('30000000-0000-4000-8000-000000000006', $1, 'Modifier', 'CORE', $2::jsonb)`,
      [campaignOne, JSON.stringify({ sourceKey: 'Core', rule: 'armor' })],
    );
    await client.query(
      `INSERT INTO campaign_library_enchantments (id, campaign_id, name, source_key, applicability)
       VALUES ('30000000-0000-4000-8000-000000000007', $1, 'Enchantment', 'core', 'armor')`,
      [campaignOne],
    );
    await client.query(
      `INSERT INTO campaign_library_skills (id, campaign_id, name, source_key)
       VALUES ('30000000-0000-4000-8000-000000000003', $1, 'Skill', 'CORE')`,
      [campaignTwo],
    );
    await client.query(
      `INSERT INTO campaign_library_items (id, campaign_id, name, source_key)
       VALUES ($1, $2, 'Legacy item', 'CORE')`,
      [itemDefinitionId, campaignOne],
    );
    await client.query(
      `INSERT INTO campaign_library_races (id, campaign_id, name, kind, key, source_key)
       VALUES ($1, $2, 'Stonekin', 'race', 'stonekin', 'Core'),
              ($3, $4, 'Stonekin lens', 'lens', 'stonekin-lens', 'Core')`,
      [raceDefinitionId, campaignOne, lensDefinitionId, campaignTwo],
    );
    await client.query(
      'INSERT INTO characters (id, campaign_id, race) VALUES ($1, $2, $3::jsonb)',
      [
        characterId,
        campaignTwo,
        JSON.stringify({
          selection: {
            raceId: raceDefinitionId,
            variantKey: null,
            lensIds: [lensDefinitionId],
            formKey: 'water',
          },
          snapshot: {
            name: 'Stonekin · Tidal',
            description: 'Owned form',
            points: 27,
            attributeModifiers: { st: 2 },
            traits: [{ key: 'stone-skin', name: 'Stone Skin', points: 5 }],
            skills: [],
            features: ['Stone bones'],
            effects: [],
            sources: [
              {
                id: raceDefinitionId,
                campaignId: campaignOne,
                revision: 3,
                key: 'stonekin',
                sourceKey: 'Core',
                name: 'Stonekin',
                source: 'Mariner',
                sourceLocator: '42',
              },
              {
                id: lensDefinitionId,
                campaignId: campaignTwo,
                revision: 2,
                key: 'stonekin-lens',
                sourceKey: 'Core',
                name: 'Stonekin lens',
                source: 'Mariner',
                sourceLocator: '43',
              },
            ],
            naturalForm: { key: 'natural', name: 'Stonekin', description: null, points: 27 },
            forms: [{ key: 'water', name: 'Stonekin · Tidal', description: null, points: 27 }],
          },
        }),
      ],
    );
    await client.query(
      `INSERT INTO character_traits (id, character_id, pricing_resolution, modifiers)
       VALUES ('50000000-0000-4000-8000-000000000001', $1,
         '{"reference":{"section":"traits","key":"Trait","kind":"advantage","sourceKey":" Core "},"definitionId":"30000000-0000-4000-8000-000000000001","paidPoints":31,"rules":{"level":3}}'::jsonb,
         '[{"sourceKey":"retired-book","paidValue":7}]'::jsonb),
         ('50000000-0000-4000-8000-000000000003', $1,
          '{"reference":{"section":"traits","key":"Detached Trait","kind":"advantage","sourceKey":"Core"},"definitionId":"30000000-0000-4000-8000-000000000099","paidPoints":19,"rules":{"level":2}}'::jsonb,
           '[]'::jsonb)`,
      [characterId],
    );
    await client.query(
      `INSERT INTO inventory_items (id, character_id, pricing_resolution)
       VALUES ('50000000-0000-4000-8000-000000000002', $1,
         '{"reference":{"section":"items","key":"Legacy item","sourceKey":"Core"},"definitionId":"30000000-0000-4000-8000-000000000005","paidCost":42.25}'::jsonb)`,
      [characterId],
    );

    await applyMigration(client);
    // Applying the migration again must leave the upgraded schema and data intact.
    await applyMigration(client);

    const library = await client.query<{
      id: string;
      source_id: string | null;
      calculation: unknown;
      available_modifiers: unknown;
    }>(
      `SELECT id, source_id, calculation, available_modifiers
       FROM campaign_library_traits ORDER BY name`,
    );
    expect(library.rows[0]).toMatchObject({ id: traitId, source_id: sourceOne });
    expect(library.rows[0]?.calculation).toEqual({
      inputs: [{ sourceId: sourceOne, cost: 75 }],
      outputs: [{ amount: 12 }],
    });
    expect(library.rows[0]?.available_modifiers).toEqual([
      { calculation: { inputs: [{ sourceId: sourceOne, paid: 9 }] } },
    ]);
    expect(library.rows[1]).toMatchObject({ source_id: null });
    const modifier = await client.query<{ applicability: unknown }>(
      `SELECT applicability FROM campaign_library_modifiers WHERE name = 'Modifier'`,
    );
    expect(modifier.rows[0]?.applicability).toEqual({ sourceId: sourceOne, rule: 'armor' });
    const enchantment = await client.query<{ source_id: string; applicability: string }>(
      `SELECT source_id, applicability FROM campaign_library_enchantments WHERE name = 'Enchantment'`,
    );
    expect(enchantment.rows[0]).toEqual({ source_id: sourceOne, applicability: 'armor' });

    const otherCampaign = await client.query<{ source_id: string }>(
      'SELECT source_id FROM campaign_library_skills WHERE campaign_id = $1',
      [campaignTwo],
    );
    expect(otherCampaign.rows[0]?.source_id).toBe(sourceTwo);

    const raceRows = await client.query<{ id: string; kind: string; source_id: string }>(
      'SELECT id, kind, source_id FROM campaign_library_races ORDER BY kind',
    );
    expect(raceRows.rows).toEqual([
      { id: lensDefinitionId, kind: 'lens', source_id: sourceTwo },
      { id: raceDefinitionId, kind: 'race', source_id: sourceOne },
    ]);
    const raceCharacter = await client.query<{ race: unknown }>(
      'SELECT race FROM characters WHERE id = $1',
      [characterId],
    );
    expect(raceCharacter.rows[0]?.race).toEqual({
      selection: {
        raceId: raceDefinitionId,
        variantKey: null,
        lensIds: [lensDefinitionId],
        formKey: 'water',
      },
      snapshot: {
        name: 'Stonekin · Tidal',
        description: 'Owned form',
        points: 27,
        attributeModifiers: { st: 2 },
        traits: [{ key: 'stone-skin', name: 'Stone Skin', points: 5 }],
        skills: [],
        features: ['Stone bones'],
        effects: [],
        sources: [
          {
            id: raceDefinitionId,
            campaignId: campaignOne,
            revision: 3,
            key: 'stonekin',
            sourceId: sourceOne,
            name: 'Stonekin',
            source: 'Mariner',
            sourceLocator: '42',
          },
          {
            id: lensDefinitionId,
            campaignId: campaignTwo,
            revision: 2,
            key: 'stonekin-lens',
            sourceId: sourceTwo,
            name: 'Stonekin lens',
            source: 'Mariner',
            sourceLocator: '43',
          },
        ],
        naturalForm: { key: 'natural', name: 'Stonekin', description: null, points: 27 },
        forms: [{ key: 'water', name: 'Stonekin · Tidal', description: null, points: 27 }],
      },
    });

    const character = await client.query<{ pricing_resolution: unknown; modifiers: unknown }>(
      'SELECT pricing_resolution, modifiers FROM character_traits WHERE character_id = $1',
      [characterId],
    );
    expect(character.rows[0]?.pricing_resolution).toEqual({
      reference: {
        section: 'traits',
        key: 'Trait',
        kind: 'advantage',
        sourceId: sourceOne,
      },
      definitionId: traitId,
      paidPoints: 31,
      rules: { level: 3 },
    });
    expect(character.rows[0]?.modifiers).toEqual([{ sourceId: null, paidValue: 7 }]);
    const detached = await client.query<{ pricing_resolution: unknown }>(
      `SELECT pricing_resolution FROM character_traits WHERE id = '50000000-0000-4000-8000-000000000003'`,
    );
    expect(detached.rows[0]?.pricing_resolution).toEqual({
      reference: {
        section: 'traits',
        key: 'Detached Trait',
        kind: 'advantage',
        sourceId: null,
      },
      definitionId: '30000000-0000-4000-8000-000000000099',
      paidPoints: 19,
      rules: { level: 2 },
    });
    const inventory = await client.query<{ pricing_resolution: unknown }>(
      'SELECT pricing_resolution FROM inventory_items WHERE character_id = $1',
      [characterId],
    );
    expect(inventory.rows[0]?.pricing_resolution).toEqual({
      reference: { section: 'items', key: 'Legacy item', sourceId: sourceOne },
      definitionId: itemDefinitionId,
      paidCost: 42.25,
    });

    await client.query('SAVEPOINT before_composite_fk_check');
    await expect(
      client.query(
        `INSERT INTO campaign_library_traits (id, campaign_id, name, kind, source_id)
         VALUES ('30000000-0000-4000-8000-000000000004', $1, 'Foreign', 'advantage', $2)`,
        [campaignOne, sourceTwo],
      ),
    ).rejects.toThrow(/foreign key constraint/i);
    await client.query('ROLLBACK TO SAVEPOINT before_composite_fk_check');
    await client.query('SAVEPOINT before_race_composite_fk_check');
    await expect(
      client.query(
        `INSERT INTO campaign_library_races (id, campaign_id, name, kind, source_id)
         VALUES ('30000000-0000-4000-8000-000000000010', $1, 'Foreign race', 'race', $2)`,
        [campaignOne, sourceTwo],
      ),
    ).rejects.toThrow(/foreign key constraint/i);
    await client.query('ROLLBACK TO SAVEPOINT before_race_composite_fk_check');
    await client.query('SAVEPOINT before_source_delete_check');
    await expect(
      client.query('DELETE FROM campaign_library_sources WHERE id = $1', [sourceOne]),
    ).rejects.toThrow(/campaign_library_traits_source_book_fk/i);
    await client.query('ROLLBACK TO SAVEPOINT before_source_delete_check');
  });
});

it('migration 0068 aborts when a live nested calculation references an unknown sourcebook', async () => {
  await withIsolatedSchema(async (client) => {
    await client.query(
      `INSERT INTO campaign_library_sources (id, campaign_id, name, key, abbreviation)
       VALUES ($1, $2, 'Core', 'core', 'C')`,
      [sourceOne, campaignOne],
    );
    await client.query(
      `INSERT INTO campaign_library_traits (id, campaign_id, name, kind, source_key, calculation)
       VALUES ($1, $2, 'Trait', 'advantage', 'core', '{"inputs":[{"sourceKey":"missing"}]}'::jsonb)`,
      [traitId, campaignOne],
    );
    await client.query('SAVEPOINT before_sourcebook_migration');
    await expect(applyMigration(client)).rejects.toThrow(/unresolved sourcebook missing/i);
    await client.query('ROLLBACK TO SAVEPOINT before_sourcebook_migration');
    const legacy = await client.query<{ source_key: string; calculation: unknown }>(
      'SELECT source_key, calculation FROM campaign_library_traits WHERE id = $1',
      [traitId],
    );
    expect(legacy.rows[0]).toEqual({
      source_key: 'core',
      calculation: { inputs: [{ sourceKey: 'missing' }] },
    });
  });
});
