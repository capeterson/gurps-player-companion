import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import {
  adventureLogEntries,
  campaignMemberships,
  campaigns,
  characters,
  encounterEffects,
  encounters,
  refreshTokens,
  users,
} from '../db/schema.ts';
import { isDraining } from '../lifecycle.ts';
import { resolveLogAwards } from './adventureLogAwards.ts';
import { advanceCampaignProjectionRevision } from './libraryInvalidation.ts';
import { detachLibraryReferencesForTransfer } from './ownedLibraryMechanics.ts';
import { publish } from './wsBus.ts';

/** Keep unexpired revoked ancestors for rotation retries and replay detection. */
export async function sweepExpiredRefreshTokens(now = new Date()): Promise<number> {
  const result = await getDb().delete(refreshTokens).where(lte(refreshTokens.expiresAt, now));
  return result.rowCount ?? 0;
}

/** Nightly expiry cleanup plus atomic account deletion; failed accounts stay queued. */
export async function sweepUserPurges(now = new Date()): Promise<number> {
  const db = getDb();
  // Keep the sweep lock on its own connection. Each account commits separately
  // so a large nightly queue does not hold the sync revision fence all night.
  return db.transaction(async (lockTx) => {
    const lock = await lockTx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('gpc:user-purge')) as acquired`,
    );
    if (!lock.rows[0]?.acquired) return 0;
    // Expiry cleanup runs even when no accounts are scheduled for deletion.
    await sweepExpiredRefreshTokens(now);
    const due = await db
      .select({ id: users.id })
      .from(users)
      .where(and(isNotNull(users.suspendedAt), lte(users.purgeScheduledAt, now)))
      .orderBy(asc(users.purgeScheduledAt), asc(users.id));
    let purged = 0;
    for (const candidate of due) {
      if (isDraining()) break;
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
          const authoredLogs = await tx
            .select({ campaignId: adventureLogEntries.campaignId })
            .from(adventureLogEntries)
            .where(eq(adventureLogEntries.authorId, target.id));
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
            ...authoredLogs.map((entry) => entry.campaignId),
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
          // Match log deletion in surviving campaigns, including reversal of
          // earned-point awards. System maintenance uses owner-level authority;
          // its audit actor remains null. Owned campaign deletion, like REST,
          // retains earned points on surviving characters.
          for (const campaignId of [
            ...new Set(authoredLogs.map((entry) => entry.campaignId)),
          ].sort()) {
            if (ownedCampaignIds.has(campaignId)) continue;
            const [campaign] = await tx
              .select()
              .from(campaigns)
              .where(eq(campaigns.id, campaignId))
              .for('update');
            if (!campaign) continue;
            const entries = await tx
              .select()
              .from(adventureLogEntries)
              .where(
                and(
                  eq(adventureLogEntries.campaignId, campaignId),
                  eq(adventureLogEntries.authorId, target.id),
                ),
              )
              .orderBy(asc(adventureLogEntries.id))
              .for('update');
            for (const entry of entries) {
              await resolveLogAwards(
                tx,
                campaignId,
                campaign.ownerId,
                campaign.ownerId,
                { pointsGained: null },
                entry.xpAwards,
                entry.pointsGained,
              );
              await tx.delete(adventureLogEntries).where(eq(adventureLogEntries.id, entry.id));
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
let activeSweep: Promise<void> | undefined;
let stopping = false;
export function startUserPurgeMaintenance(environment: string): void {
  if (timer || activeSweep || environment === 'test' || isDraining()) return;
  stopping = false;
  const schedule = () => {
    const now = new Date();
    timer = setTimeout(() => {
      timer = undefined;
      activeSweep = sweepUserPurges()
        .then(() => undefined)
        .catch(() => console.error('user purge sweep failed; will retry next night'))
        .finally(() => {
          activeSweep = undefined;
          if (!stopping && !isDraining()) schedule();
        });
    }, nextNightlyPurgeAt(now).getTime() - now.getTime());
    timer.unref();
  };
  schedule();
}

/** Stop scheduling and let the current account transaction finish before DB shutdown. */
export async function stopUserPurgeMaintenance(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = undefined;
  await activeSweep;
}
