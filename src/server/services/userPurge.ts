import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import {
  campaignMemberships,
  campaigns,
  characters,
  encounterEffects,
  encounters,
  users,
} from '../db/schema.ts';
import { advanceCampaignProjectionRevision } from './libraryInvalidation.ts';
import { detachLibraryReferencesForTransfer } from './ownedLibraryMechanics.ts';
import { publish } from './wsBus.ts';

/** Due accounts are removed atomically; a failed account remains queued for the next night. */
export async function sweepUserPurges(now = new Date()): Promise<number> {
  const db = getDb();
  // Keep the sweep lock on its own connection. Each account commits separately
  // so a large nightly queue does not hold the sync revision fence all night.
  return db.transaction(async (lockTx) => {
    const lock = await lockTx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('gpc:user-purge')) as acquired`,
    );
    if (!lock.rows[0]?.acquired) return 0;
    const due = await db
      .select({ id: users.id })
      .from(users)
      .where(and(isNotNull(users.suspendedAt), lte(users.purgeScheduledAt, now)))
      .orderBy(asc(users.purgeScheduledAt), asc(users.id));
    let purged = 0;
    for (const candidate of due) {
      try {
        // Empty actor denotes system maintenance. Each audited transaction
        // isolates an account's failure and publishes nudges only after commit.
        const deleted = await withAudit('', undefined, async (tx) => {
          const [target] = await tx
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.id, candidate.id),
                isNotNull(users.suspendedAt),
                lte(users.purgeScheduledAt, now),
              ),
            )
            .for('update', { skipLocked: true });
          // Cancellation/rescheduling is authoritative even after enumeration.
          if (!target) return false;
          const ownedCampaigns = await tx
            .select({ id: campaigns.id })
            .from(campaigns)
            .where(eq(campaigns.ownerId, target.id))
            .orderBy(asc(campaigns.id))
            .for('update');
          const ownedCampaignIds = new Set(ownedCampaigns.map((campaign) => campaign.id));
          const memberships = await tx
            .select({ campaignId: campaignMemberships.campaignId })
            .from(campaignMemberships)
            .where(eq(campaignMemberships.userId, target.id));
          const ownedCharacters = await tx
            .select({ campaignId: characters.campaignId })
            .from(characters)
            .where(eq(characters.ownerId, target.id));
          const authoredEffects = await tx
            .select({ encounterId: encounters.id, campaignId: encounters.campaignId })
            .from(encounterEffects)
            .innerJoin(encounters, eq(encounters.id, encounterEffects.encounterId))
            .where(eq(encounterEffects.createdById, target.id));
          const affectedCampaignIds = new Set([
            ...ownedCampaignIds,
            ...memberships.map((membership) => membership.campaignId),
            ...ownedCharacters.flatMap((character) =>
              character.campaignId ? [character.campaignId] : [],
            ),
            ...authoredEffects.map((effect) => effect.campaignId),
          ]);
          const recipients = new Set<string>();
          if (affectedCampaignIds.size) {
            const members = await tx
              .select({ userId: campaignMemberships.userId })
              .from(campaignMemberships)
              .where(inArray(campaignMemberships.campaignId, [...affectedCampaignIds]));
            const owners = await tx
              .select({ userId: campaigns.ownerId })
              .from(campaigns)
              .where(inArray(campaigns.id, [...affectedCampaignIds]));
            for (const row of [...members, ...owners]) recipients.add(row.userId);
          }
          // Match ordinary campaign deletion: other players keep their characters,
          // purchased mechanics and inventory after the library disappears.
          for (const campaign of ownedCampaigns) {
            const survivors = await tx
              .select({ id: characters.id, ownerId: characters.ownerId })
              .from(characters)
              .where(eq(characters.campaignId, campaign.id));
            for (const character of survivors) {
              if (character.ownerId === target.id) continue;
              recipients.add(character.ownerId);
              await detachLibraryReferencesForTransfer(
                tx,
                character.id,
                { campaignId: null },
                campaign.id,
              );
            }
          }
          // Delete explicit RESTRICT references before the user. Remaining
          // credentials, memberships, invitations, logs and character children cascade.
          await tx.delete(encounterEffects).where(eq(encounterEffects.createdById, target.id));
          for (const encounterId of new Set(authoredEffects.map((effect) => effect.encounterId))) {
            await tx
              .update(encounters)
              .set({ updatedAt: now })
              .where(eq(encounters.id, encounterId));
          }
          await tx.delete(characters).where(eq(characters.ownerId, target.id));
          for (const campaign of ownedCampaigns) {
            await tx.delete(campaigns).where(eq(campaigns.id, campaign.id));
          }
          await tx.delete(users).where(eq(users.id, target.id));
          for (const campaignId of affectedCampaignIds) {
            if (!ownedCampaignIds.has(campaignId))
              await advanceCampaignProjectionRevision(tx, campaignId);
          }
          for (const userId of recipients) {
            if (userId === target.id) continue;
            publish(userId, { kind: 'sync_invalidate', emittedAt: now.toISOString() });
            publish(userId, { kind: 'encounter_invalidate', emittedAt: now.toISOString() });
          }
          return true;
        });
        if (deleted) purged++;
      } catch {
        console.error('user purge failed; queued for next night', { userId: candidate.id });
      }
    }
    if (purged) console.info('user purge completed', { users: purged });
    return purged;
  });
}

/** Fixed UTC wall-clock schedule, independent of server startup or local DST. */
export function nextNightlyPurgeAt(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function startUserPurgeMaintenance(environment: string): void {
  if (timer || environment === 'test') return;
  const schedule = () => {
    const now = new Date();
    timer = setTimeout(async () => {
      try {
        await sweepUserPurges();
      } catch {
        console.error('user purge sweep failed; will retry next night');
      } finally {
        schedule();
      }
    }, nextNightlyPurgeAt(now).getTime() - now.getTime());
    timer.unref();
  };
  schedule();
}
