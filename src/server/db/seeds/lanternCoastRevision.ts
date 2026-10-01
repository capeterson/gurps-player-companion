import { and, eq } from 'drizzle-orm';
import { withAudit } from '../auditContext.ts';
import { getDb } from '../client.ts';
import { demoSeedUpdates } from '../schema.ts';

export const LANTERN_SEED_VERSION = 2;
export const LANTERN_SEED_KEY = 'lantern-coast';

export async function lanternSeedIsCurrent(campaignId: string) {
  const [row] = await getDb()
    .select({ version: demoSeedUpdates.version })
    .from(demoSeedUpdates)
    .where(
      and(
        eq(demoSeedUpdates.campaignId, campaignId),
        eq(demoSeedUpdates.seed, LANTERN_SEED_KEY),
        eq(demoSeedUpdates.version, LANTERN_SEED_VERSION),
      ),
    );
  return row !== undefined;
}

/** Called inside the same transaction as every refreshed content write. */
export async function recordLanternSeedVersion(campaignId: string, actorId: string) {
  await withAudit(actorId, undefined, async (tx) => {
    await tx
      .insert(demoSeedUpdates)
      .values({ campaignId, seed: LANTERN_SEED_KEY, version: LANTERN_SEED_VERSION })
      .onConflictDoNothing();
  });
}
