import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { canWriteCharacter, lookupCampaignRole } from '../auth/permissions.ts';
import { type AuditTx, withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { campaignMemberships, campaigns, characters } from '../db/schema.ts';
import { isDraining } from '../lifecycle.ts';
/**
 * Recycle bin: deleting a character or campaign marks it (`deleted_at`) and
 * hides it from every read path; it is restorable for 30 days, after which the
 * nightly sweep hard-deletes it. This module is the single implementation used
 * by REST, `/sync/operations`, MCP (through REST) and the sweep.
 *
 * Retention guarantee: the sweep compares against the database clock in SQL
 * (`deleted_at <= now() - 30 days`), so an item is never purged early. It may
 * outlive the cutoff by up to one sweep interval.
 */
import { logTelemetryEvent } from '../telemetry.ts';
import { detachLibraryReferencesForTransfer } from './ownedLibraryMechanics.ts';

export const RECYCLE_BIN_RETENTION_DAYS = 30;
const RETENTION_MS = RECYCLE_BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** SQL predicate for "binned for at least the full retention period". */
const expired = (column: typeof characters.deletedAt | typeof campaigns.deletedAt) =>
  sql`${column} <= now() - make_interval(days => ${RECYCLE_BIN_RETENTION_DAYS})`;

export interface RecycledCharacter {
  readonly id: string;
  readonly name: string;
  readonly deletedAt: Date;
  readonly purgeAfter: Date;
}
export interface RecycledCampaign extends RecycledCharacter {
  readonly characterCount: number;
}

export const purgeAfter = (deletedAt: Date): Date => new Date(deletedAt.getTime() + RETENTION_MS);

// ---------- bin ----------

/** Idempotent: returns false when the character is missing or already binned. */
export async function binCharacter(tx: AuditTx, id: string, actorId: string): Promise<boolean> {
  const rows = await tx
    .update(characters)
    .set({ deletedAt: sql`now()`, deletedBy: actorId })
    .where(and(eq(characters.id, id), isNull(characters.deletedAt)))
    .returning({ id: characters.id });
  return rows.length > 0;
}

/**
 * Bin a campaign. Its characters leave it immediately, exactly as a hard delete
 * did (mechanics become owned copies, earned points stay); the originating
 * campaign is remembered so a restore can re-attach them.
 */
export async function binCampaign(tx: AuditTx, id: string, actorId: string): Promise<boolean> {
  // Block new FK assignments before enumerating characters to detach.
  const [locked] = await tx
    .select({ id: campaigns.id, deletedAt: campaigns.deletedAt })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .for('update');
  if (!locked || locked.deletedAt) return false;
  await detachCampaignCharacters(tx, id, true);
  await tx
    .update(campaigns)
    .set({ deletedAt: sql`now()`, deletedBy: actorId })
    .where(eq(campaigns.id, id));
  return true;
}

async function detachCampaignCharacters(tx: AuditTx, campaignId: string, remember: boolean) {
  const attached = await tx
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.campaignId, campaignId))
    .orderBy(asc(characters.id));
  for (const character of attached) {
    await detachLibraryReferencesForTransfer(tx, character.id, { campaignId: null }, campaignId);
    await tx
      .update(characters)
      .set({ campaignId: null, ...(remember ? { recycledFromCampaignId: campaignId } : {}) })
      .where(and(eq(characters.id, character.id), eq(characters.campaignId, campaignId)));
  }
}

// ---------- restore ----------

export async function restoreCharacter(tx: AuditTx, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ deletedAt: characters.deletedAt })
    .from(characters)
    .where(eq(characters.id, id))
    .for('update');
  if (!row?.deletedAt) return false;
  await tx
    .update(characters)
    .set({ deletedAt: null, deletedBy: null })
    .where(eq(characters.id, id));
  return true;
}

/**
 * Restore a campaign and re-attach the characters it released, provided they
 * are still campaign-less and their owner can still belong to the campaign.
 */
export async function restoreCampaign(tx: AuditTx, id: string): Promise<boolean> {
  const [campaign] = await tx
    .select({ ownerId: campaigns.ownerId, deletedAt: campaigns.deletedAt })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .for('update');
  if (!campaign?.deletedAt) return false;
  await tx.update(campaigns).set({ deletedAt: null, deletedBy: null }).where(eq(campaigns.id, id));
  await tx
    .update(characters)
    .set({ campaignId: id })
    .where(
      and(
        eq(characters.recycledFromCampaignId, id),
        isNull(characters.campaignId),
        or(
          eq(characters.ownerId, campaign.ownerId),
          sql`exists (select 1 from ${campaignMemberships} m where m.campaign_id = ${id} and m.user_id = ${characters.ownerId})`,
        ),
      ),
    );
  await tx
    .update(characters)
    .set({ recycledFromCampaignId: null })
    .where(eq(characters.recycledFromCampaignId, id));
  return true;
}

// ---------- purge (hard delete) ----------

/** Hard-delete a binned character; a live one is never touched. */
export async function purgeCharacter(tx: AuditTx, id: string): Promise<boolean> {
  const rows = await tx
    .delete(characters)
    .where(and(eq(characters.id, id), isNotNull(characters.deletedAt)))
    .returning({ id: characters.id });
  return rows.length > 0;
}

/** Hard-delete a binned campaign; stragglers are released first, as a delete always did. */
export async function purgeCampaign(tx: AuditTx, id: string): Promise<boolean> {
  const [locked] = await tx
    .select({ deletedAt: campaigns.deletedAt })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .for('update');
  if (!locked?.deletedAt) return false;
  await detachCampaignCharacters(tx, id, false);
  await tx.delete(campaigns).where(eq(campaigns.id, id));
  return true;
}

// ---------- authorization + listing ----------

/** Owner always; otherwise a user who still has write access through the live campaign. */
async function canManageBinnedCharacter(
  row: { ownerId: string; campaignId: string | null; deletedBy: string | null },
  userId: string,
): Promise<boolean> {
  if (row.ownerId === userId) return true;
  if (!row.campaignId || row.deletedBy !== userId) return false;
  const access = await lookupCampaignRole(row.campaignId, userId);
  return Boolean(access?.role && canWriteCharacter(row, userId, access.campaign, access.role));
}

/** 404 unless the character is binned; 403 unless the caller may restore or purge it. */
export async function loadBinnedCharacterOr403(id: string, userId: string) {
  const [row] = await getDb()
    .select({
      id: characters.id,
      ownerId: characters.ownerId,
      campaignId: characters.campaignId,
      deletedBy: characters.deletedBy,
      deletedAt: characters.deletedAt,
    })
    .from(characters)
    .where(eq(characters.id, id));
  if (!row?.deletedAt) throw new HTTPException(404, { message: 'character not found' });
  if (!(await canManageBinnedCharacter(row, userId)))
    throw new HTTPException(403, { message: 'forbidden' });
  return row;
}

/** 404 unless the campaign is binned; only its owner may restore or purge it. */
export async function loadBinnedCampaignOr403(id: string, userId: string) {
  const [row] = await getDb()
    .select({ id: campaigns.id, ownerId: campaigns.ownerId, deletedAt: campaigns.deletedAt })
    .from(campaigns)
    .where(eq(campaigns.id, id));
  if (!row?.deletedAt) throw new HTTPException(404, { message: 'campaign not found' });
  if (row.ownerId !== userId) throw new HTTPException(403, { message: 'owner required' });
  return row;
}

export async function listRecycleBin(
  userId: string,
): Promise<{ characters: RecycledCharacter[]; campaigns: RecycledCampaign[] }> {
  const db = getDb();
  const characterRows = await db
    .select({
      id: characters.id,
      name: characters.name,
      ownerId: characters.ownerId,
      campaignId: characters.campaignId,
      deletedBy: characters.deletedBy,
      deletedAt: characters.deletedAt,
    })
    .from(characters)
    .where(
      and(
        isNotNull(characters.deletedAt),
        or(eq(characters.ownerId, userId), eq(characters.deletedBy, userId)),
      ),
    )
    .orderBy(sql`${characters.deletedAt} desc`, asc(characters.id));
  const visible: RecycledCharacter[] = [];
  for (const row of characterRows) {
    if (!row.deletedAt || !(await canManageBinnedCharacter(row, userId))) continue;
    visible.push({
      id: row.id,
      name: row.name,
      deletedAt: row.deletedAt,
      purgeAfter: purgeAfter(row.deletedAt),
    });
  }
  const campaignRows = await db
    .select({ id: campaigns.id, name: campaigns.name, deletedAt: campaigns.deletedAt })
    .from(campaigns)
    .where(and(isNotNull(campaigns.deletedAt), eq(campaigns.ownerId, userId)))
    .orderBy(sql`${campaigns.deletedAt} desc`, asc(campaigns.id));
  const counts = campaignRows.length
    ? await db
        .select({
          campaignId: characters.recycledFromCampaignId,
          count: sql<number>`count(*)::int`,
        })
        .from(characters)
        .where(
          inArray(
            characters.recycledFromCampaignId,
            campaignRows.map((row) => row.id),
          ),
        )
        .groupBy(characters.recycledFromCampaignId)
    : [];
  const countById = new Map(counts.map((row) => [row.campaignId, row.count]));
  const campaignsOut: RecycledCampaign[] = [];
  for (const row of campaignRows) {
    if (!row.deletedAt) continue;
    campaignsOut.push({
      id: row.id,
      name: row.name,
      deletedAt: row.deletedAt,
      purgeAfter: purgeAfter(row.deletedAt),
      characterCount: countById.get(row.id) ?? 0,
    });
  }
  return { characters: visible, campaigns: campaignsOut };
}

// ---------- nightly sweep ----------

/**
 * Hard-delete everything binned for the full retention period. Safe to run in
 * every replica: an advisory lock admits one sweeper, each item commits in its
 * own audited transaction, and a concurrent restore wins via the row re-check.
 * Campaigns go first so their released characters are judged on their own clock.
 */
export async function sweepRecycleBin(
  processed: (count?: number) => void = () => {},
): Promise<number> {
  const db = getDb();
  return db.transaction(async (lockTx) => {
    const lock = await lockTx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('gpc:recycle-bin')) as acquired`,
    );
    if (!lock.rows[0]?.acquired) return 0;
    let purged = 0;
    const dueCampaigns = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(isNotNull(campaigns.deletedAt), expired(campaigns.deletedAt)))
      .orderBy(asc(campaigns.deletedAt), asc(campaigns.id));
    for (const candidate of dueCampaigns) {
      if (isDraining()) return purged;
      try {
        // Empty actor denotes system maintenance (no inbox notifications).
        const removed = await withAudit('', undefined, async (tx) => {
          const [target] = await tx
            .select({ id: campaigns.id })
            .from(campaigns)
            .where(
              and(
                eq(campaigns.id, candidate.id),
                isNotNull(campaigns.deletedAt),
                expired(campaigns.deletedAt),
              ),
            )
            .for('update', { skipLocked: true });
          return target ? purgeCampaign(tx, target.id) : false;
        });
        if (removed) {
          purged++;
          processed();
        }
      } catch {
        logTelemetryEvent('worker.recycle_bin.item_failed', { kind: 'campaign' }, 'ERROR');
      }
    }
    const dueCharacters = await db
      .select({ id: characters.id })
      .from(characters)
      .where(and(isNotNull(characters.deletedAt), expired(characters.deletedAt)))
      .orderBy(asc(characters.deletedAt), asc(characters.id));
    for (const candidate of dueCharacters) {
      if (isDraining()) return purged;
      try {
        const removed = await withAudit('', undefined, async (tx) => {
          const [target] = await tx
            .select({ id: characters.id })
            .from(characters)
            .where(
              and(
                eq(characters.id, candidate.id),
                isNotNull(characters.deletedAt),
                expired(characters.deletedAt),
              ),
            )
            .for('update', { skipLocked: true });
          return target ? purgeCharacter(tx, target.id) : false;
        });
        if (removed) {
          purged++;
          processed();
        }
      } catch {
        logTelemetryEvent('worker.recycle_bin.item_failed', { kind: 'character' }, 'ERROR');
      }
    }
    return purged;
  });
}
