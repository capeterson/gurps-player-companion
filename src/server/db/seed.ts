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
import { closeDb, getDb } from './client.ts';
import {
  campaignLibraryItems,
  campaignLibrarySkills,
  campaignLibrarySpells,
  campaignLibraryTraits,
  campaignMemberships,
  campaigns,
  users,
} from './schema.ts';

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

async function seedLibrary(db: ReturnType<typeof getDb>, campaignId: string): Promise<void> {
  const yamlText = await readFile('bootstrap/sample_library.yaml', 'utf8');
  const doc = parseLibraryYaml(yamlText);

  for (const t of doc.library.traits) {
    await db
      .insert(campaignLibraryTraits)
      .values({
        campaignId,
        name: t.name,
        kind: t.kind,
        basePoints: t.basePoints,
        description: t.description ?? null,
        source: t.source ?? null,
        availableModifiers: t.availableModifiers ?? [],
        tags: t.tags ?? [],
      })
      .onConflictDoUpdate({
        target: [
          campaignLibraryTraits.campaignId,
          campaignLibraryTraits.name,
          campaignLibraryTraits.kind,
        ],
        set: {
          basePoints: t.basePoints,
          description: t.description ?? null,
          source: t.source ?? null,
          availableModifiers: t.availableModifiers ?? [],
          tags: t.tags ?? [],
          updatedAt: new Date(),
        },
      });
  }

  for (const s of doc.library.skills) {
    await db
      .insert(campaignLibrarySkills)
      .values({
        campaignId,
        name: s.name,
        attribute: s.attribute,
        difficulty: s.difficulty,
        techLevel: s.techLevel ?? null,
        description: s.description ?? null,
        source: s.source ?? null,
        defaultSpecialization: s.defaultSpecialization ?? null,
        prerequisites: s.prerequisites ?? null,
        situationalModifiers: s.situationalModifiers ?? [],
      })
      .onConflictDoUpdate({
        target: [campaignLibrarySkills.campaignId, campaignLibrarySkills.name],
        set: {
          attribute: s.attribute,
          difficulty: s.difficulty,
          techLevel: s.techLevel ?? null,
          description: s.description ?? null,
          source: s.source ?? null,
          defaultSpecialization: s.defaultSpecialization ?? null,
          prerequisites: s.prerequisites ?? null,
          situationalModifiers: s.situationalModifiers ?? [],
          updatedAt: new Date(),
        },
      });
  }

  for (const s of doc.library.spells) {
    await db
      .insert(campaignLibrarySpells)
      .values({
        campaignId,
        name: s.name,
        college: s.college ?? null,
        difficulty: s.difficulty,
        baseEnergyCost: s.baseEnergyCost,
        maintenanceCost: s.maintenanceCost ?? null,
        castingTime: s.castingTime ?? null,
        duration: s.duration ?? null,
        prerequisites: s.prerequisites ?? null,
        description: s.description ?? null,
        source: s.source ?? null,
      })
      .onConflictDoUpdate({
        target: [campaignLibrarySpells.campaignId, campaignLibrarySpells.name],
        set: {
          college: s.college ?? null,
          difficulty: s.difficulty,
          baseEnergyCost: s.baseEnergyCost,
          maintenanceCost: s.maintenanceCost ?? null,
          castingTime: s.castingTime ?? null,
          duration: s.duration ?? null,
          prerequisites: s.prerequisites ?? null,
          description: s.description ?? null,
          source: s.source ?? null,
          updatedAt: new Date(),
        },
      });
  }

  for (const i of doc.library.items) {
    await db
      .insert(campaignLibraryItems)
      .values({
        campaignId,
        name: i.name,
        category: i.category,
        defaultQuantity: i.defaultQuantity,
        weightLbs: String(i.weightLbs),
        cost: String(i.cost),
        description: i.description ?? null,
        source: i.source ?? null,
        isArmor: i.isArmor,
        armor: i.armor ?? null,
        weaponData: i.weaponData ?? null,
      })
      .onConflictDoUpdate({
        target: [campaignLibraryItems.campaignId, campaignLibraryItems.name],
        set: {
          category: i.category,
          defaultQuantity: i.defaultQuantity,
          weightLbs: String(i.weightLbs),
          cost: String(i.cost),
          description: i.description ?? null,
          source: i.source ?? null,
          isArmor: i.isArmor,
          armor: i.armor ?? null,
          weaponData: i.weaponData ?? null,
          updatedAt: new Date(),
        },
      });
  }
}

async function run(): Promise<void> {
  const db = getDb();
  const userId = await seedUser(db);
  const campaignId = await seedCampaign(db, userId);
  await seedLibrary(db, campaignId);
  console.log(`seeded ${SAMPLE_CAMPAIGN_NAME} campaign with library content`);
  await closeDb();
}

run().catch(async (err) => {
  console.error('seed failed', err);
  await closeDb();
  process.exit(1);
});
