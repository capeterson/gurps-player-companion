/**
 * Seed script: ensures the local database has a "Sample" campaign with
 * the bootstrap library imported.  Idempotent — re-running it just
 * upserts the library entries.
 *
 * Usage: bun run db:seed
 */

import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { parseLibraryYaml } from '../../shared/yaml/library.ts';
import { hashPassword } from '../auth/password.ts';
import { upsertByKey } from '../routes/campaignLibraryCrud.ts';
import {
  itemEntity,
  skillEntity,
  spellEntity,
  traitEntity,
} from '../routes/campaignLibraryEntities.ts';
import { withAudit } from './auditContext.ts';
import { closeDb, getDb } from './client.ts';
import { campaignMemberships, campaigns, users } from './schema.ts';

const SAMPLE_CAMPAIGN_NAME = 'Sample';
const SEED_USER_EMAIL = 'seed@example.invalid';
const SEED_USER_DISPLAY_NAME = 'Seed';
const SEED_USER_PASSWORD = 'change-me-please-this-is-a-seed-account';

async function seedUser(db: ReturnType<typeof getDb>): Promise<string> {
  const existing = await db.select().from(users).where(eq(users.email, SEED_USER_EMAIL));
  const existingUser = existing[0];
  if (existingUser) return existingUser.id;
  const passwordHash = await hashPassword(SEED_USER_PASSWORD);
  const [created] = await db
    .insert(users)
    .values({
      email: SEED_USER_EMAIL,
      passwordHash,
      displayName: SEED_USER_DISPLAY_NAME,
    })
    .returning({ id: users.id });
  if (!created) throw new Error('failed to insert seed user');
  return created.id;
}

async function seedCampaign(db: ReturnType<typeof getDb>, ownerId: string): Promise<string> {
  const existing = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.name, SAMPLE_CAMPAIGN_NAME));
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
  const yamlText = await readFile('bootstrap/sample_library.yaml', 'utf8');
  const doc = parseLibraryYaml(yamlText);

  await withAudit(actorId, undefined, async (tx) => {
    await upsertByKey(tx, traitEntity, campaignId, doc.library.traits, 'merge');
    await upsertByKey(tx, skillEntity, campaignId, doc.library.skills, 'merge');
    await upsertByKey(tx, spellEntity, campaignId, doc.library.spells, 'merge');
    await upsertByKey(tx, itemEntity, campaignId, doc.library.items, 'merge');
  });
}

async function run(): Promise<void> {
  const db = getDb();
  const userId = await seedUser(db);
  const campaignId = await seedCampaign(db, userId);
  await seedLibrary(userId, campaignId);
  console.log(`seeded ${SAMPLE_CAMPAIGN_NAME} campaign with library content`);
  await closeDb();
}

run().catch(async (err) => {
  console.error('seed failed', err);
  await closeDb();
  process.exit(1);
});
