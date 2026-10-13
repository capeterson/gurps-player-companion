import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../../app.ts';
import { signAccessToken } from '../../auth/jwt.ts';
import { loadConfig } from '../../config.ts';
import { closeDb, getDb, runInDbSavepoint, runInDbTransaction } from '../client.ts';
import { campaigns, users } from '../schema.ts';
import { ensureDemoUser } from './accounts.ts';
import { readLanternCoastYaml } from './bootstrapFiles.ts';
import { LANTERN_CAMPAIGN_NAME, populateLanternCoast } from './lanternCoastContent.ts';
import { recordLanternSeedVersion } from './lanternCoastRevision.ts';
import { inProcessSeedRequest, lanternArtworkUploader } from './seedTransport.ts';
export { LANTERN_CAMPAIGN_NAME } from './lanternCoastContent.ts';
export { inProcessSeedRequest, lanternArtworkUploader } from './seedTransport.ts';

/**
 * A single atomic, insert-once fixture. Normal routes validate all campaign and
 * character writes, capture owned library mechanics, and record audit/revisions.
 * The owner/name key deliberately does not adopt another account's demo campaign.
 * libraryText lets integration tests exercise a late fixture failure and rollback.
 */
export async function seedLanternCoast(ownerId: string, libraryText?: string) {
  return runInDbSavepoint(async () => {
    const db = getDb();
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`seed:lantern:${ownerId}`}, 0))`,
    );
    const [existing] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.ownerId, ownerId), eq(campaigns.name, LANTERN_CAMPAIGN_NAME)));
    if (existing) return { campaignId: existing.id, created: false };

    const yaml = libraryText ?? (await readLanternCoastYaml());
    const app = createApp(loadConfig());
    const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
    if (!owner) throw new Error('Seed owner does not exist');
    const ownerToken = (await signAccessToken(owner.id, owner.authVersion)).token;
    const request = inProcessSeedRequest(app);
    const result = await populateLanternCoast({
      yaml,
      request,
      uploadArtwork: lanternArtworkUploader(request),
      ownerActor: ownerToken,
      async playerFor(fixture, campaignPath) {
        const player = await ensureDemoUser(fixture.email, fixture.displayName);
        await request(ownerToken, `${campaignPath}/members`, 'POST', { email: player.email });
        if (fixture.manager)
          await request(ownerToken, `${campaignPath}/members/${player.id}`, 'PATCH', {
            role: 'manager',
          });
        return (await signAccessToken(player.id, player.authVersion)).token;
      },
      async nextEffectId() {
        const result = await db.execute<{ id: string }>(sql`select uuidv7()::text as id`);
        const id = result.rows[0]?.id;
        if (!id) throw new Error('Failed to generate active effect UUID');
        return id;
      },
    });
    await recordLanternSeedVersion(result.campaignId, ownerId);
    return { campaignId: result.campaignId, created: true };
  });
}

/** Standalone reusable seed; the standard db:seed script also calls this export. */
if (import.meta.main) {
  try {
    const result = await runInDbTransaction(async () => {
      const owner = await ensureDemoUser('seed@example.invalid', 'Seed');
      return seedLanternCoast(owner.id);
    });
    console.log(`Lantern Coast ${result.created ? 'created' : 'preserved'}: ${result.campaignId}`);
  } catch (error) {
    console.error('Lantern seed failed', error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
