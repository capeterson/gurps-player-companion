/**
 * Standard development/test seed: refresh the Sample library and create the
 * populated Lantern Coast campaign once. Repeat runs preserve Lantern play
 * state; all seeding is atomic and serialized against other seed runs.
 *
 * Usage: bun run db:seed
 */

import { readFile } from 'node:fs/promises';
import { and, eq, sql } from 'drizzle-orm';
import { parseLibraryYaml } from '../../shared/yaml/library.ts';
import { upsertByKey } from '../routes/campaignLibraryCrud.ts';
import {
  itemEntity,
  skillEntity,
  spellEntity,
  traitEntity,
} from '../routes/campaignLibraryEntities.ts';
import { withAudit } from './auditContext.ts';
import { closeDb, getDb, runInDbTransaction } from './client.ts';
import { campaignMemberships, campaigns } from './schema.ts';
import { ensureDemoUser } from './seeds/accounts.ts';
import { seedLanternCoast } from './seeds/lanternCoast.ts';

const SAMPLE_CAMPAIGN_NAME = 'Sample';
const SEED_USER_EMAIL = 'seed@example.invalid';
const SEED_USER_DISPLAY_NAME = 'Seed';
async function seedCampaign(db: ReturnType<typeof getDb>, ownerId: string): Promise<string> {
  const existing = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.name, SAMPLE_CAMPAIGN_NAME), eq(campaigns.ownerId, ownerId)));
  const existingCampaign = existing[0];
  if (existingCampaign) return existingCampaign.id;
  const [created] = await db
    .insert(campaigns)
    .values({
      name: SAMPLE_CAMPAIGN_NAME,
      description: 'Bootstrap campaign created by `bun run db:seed`.',
      ownerId,
      pointTarget: 150,
      disadvantageCap: 50,
      quirkCap: 5,
      enforceAttributeCaps: true,
    })
    .returning({ id: campaigns.id });
  if (!created) throw new Error('failed to insert seed campaign');
  await db.insert(campaignMemberships).values({
    campaignId: created.id,
    userId: ownerId,
    role: 'owner',
  });
  return created.id;
}

/**
 * Upserts the bootstrap YAML into the campaign library, keyed the same
 * way the `/library/import` route does (`upsertByKey`, natural-key
 * match), so this stays in lockstep with the route's field mapping
 * instead of hand-duplicating it — the previous version of this
 * function used raw `onConflictDoUpdate` with a plain-column conflict
 * target, which stopped matching once the natural-key unique indexes
 * became case-insensitive functional indexes (migration 0021).
 */
async function seedLibrary(actorId: string, campaignId: string): Promise<void> {
  const yamlText = await readFile(
    new URL('../../../bootstrap/sample_library.yaml', import.meta.url),
    'utf8',
  );
  const doc = parseLibraryYaml(yamlText);

  await withAudit(actorId, undefined, async (tx) => {
    await upsertByKey(tx, traitEntity, campaignId, doc.library.traits, 'merge');
    await upsertByKey(tx, skillEntity, campaignId, doc.library.skills, 'merge');
    await upsertByKey(tx, spellEntity, campaignId, doc.library.spells, 'merge');
    await upsertByKey(tx, itemEntity, campaignId, doc.library.items, 'merge');
  });
}

export async function seedDatabase(): Promise<void> {
  await runInDbTransaction(async () => {
    await getDb().execute(
      sql`select pg_advisory_xact_lock(hashtextextended('gpc:standard-seed', 0))`,
    );
    const user = await ensureDemoUser(SEED_USER_EMAIL, SEED_USER_DISPLAY_NAME);
    const campaignId = await withAudit(user.id, undefined, () => seedCampaign(getDb(), user.id));
    await seedLibrary(user.id, campaignId);
    const lantern = await seedLanternCoast(user.id);
    console.log(
      `seeded Sample library; Lantern Coast ${lantern.created ? 'created' : 'already present (preserved)'}`,
    );
  });
}

if (import.meta.main) {
  try {
    await seedDatabase();
  } catch (err) {
    console.error('seed failed', err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
