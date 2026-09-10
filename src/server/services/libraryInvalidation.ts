import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.ts';
import { campaignMemberships, campaigns } from '../db/schema.ts';
import { publish } from './wsBus.ts';

/** Post-commit acceleration only; revision fan-out is the durable HTTP path. */
export async function publishLibraryInvalidation(campaignId: string): Promise<void> {
  try {
    const db = getDb();
    const [campaign] = await db
      .select({ ownerId: campaigns.ownerId })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    if (!campaign) return;
    const members = await db
      .select({ userId: campaignMemberships.userId })
      .from(campaignMemberships)
      .where(eq(campaignMemberships.campaignId, campaignId));
    for (const userId of new Set([campaign.ownerId, ...members.map((member) => member.userId)])) {
      publish(userId, {
        kind: 'sync_invalidate',
        campaignId,
        entityClasses: ['character_trait', 'character_skill'],
        emittedAt: new Date().toISOString(),
      });
    }
  } catch {
    // A failed optional nudge cannot turn a committed library edit into an HTTP failure.
  }
}
