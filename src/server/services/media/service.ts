import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import {
  MEDIA_OUTPUT_BYTES,
  type MediaTarget,
  mediaField,
  type mediaInitialize,
  mediaManifest,
} from '../../../shared/schemas/media.ts';
import {
  assertWrite,
  loadCampaignOr403,
  loadCharacterOr403,
  requireCampaignOwner,
} from '../../auth/permissions.ts';
import { type AuditTx, withAudit } from '../../db/auditContext.ts';
import { getDb } from '../../db/client.ts';
import { campaigns, characters, mediaAssets, users } from '../../db/schema.ts';
import { mediaConfig } from './config.ts';
import { processImage } from './process.ts';
import { mediaStorage } from './storage.ts';

type Asset = typeof mediaAssets.$inferSelect;
export const mediaDigest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
function fail(status: 403 | 404 | 409 | 422 | 429 | 503, message: string): never {
  throw new HTTPException(status, { message });
}

export async function consumeMediaBudget(
  key: string,
  amount: number,
  maximum: number,
  seconds: number,
) {
  const result = await getDb().execute<{ amount: string }>(sql`
    INSERT INTO media_counters(key,amount,expires_at) VALUES (${key},${amount},now()+${seconds}*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET
      amount = CASE WHEN media_counters.expires_at <= now() THEN ${amount} ELSE media_counters.amount + ${amount} END,
      expires_at = CASE WHEN media_counters.expires_at <= now() THEN now()+${seconds}*interval '1 second' ELSE media_counters.expires_at END
    RETURNING amount`);
  if (Number(result.rows[0]?.amount) > maximum)
    fail(429, 'Image request budget exceeded; retry later');
}

export async function authorizeMediaTarget(
  userId: string,
  target: MediaTarget,
  targetId: string,
  write: boolean,
) {
  if (target === 'character') {
    const access = await loadCharacterOr403(targetId, userId);
    if (write) assertWrite(access);
  } else if (write) await requireCampaignOwner(targetId, userId);
  else await loadCampaignOr403(targetId, userId);
}

export async function assertUploadsEnabled(userId: string) {
  if (!mediaConfig().enabled) fail(503, 'Image uploads are disabled on this server');
  const [user] = await getDb()
    .select({ disabled: users.mediaUploadsDisabled, suspended: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || user.disabled || user.suspended)
    fail(403, 'Image uploads are disabled for this account');
}

export function assetManifest(asset: Asset) {
  return mediaManifest.parse({
    id: asset.id,
    state: asset.state,
    thumbUrl: asset.state === 'ready' ? `/media/${asset.token}/thumb.webp` : null,
    displayUrl: asset.state === 'ready' ? `/media/${asset.token}/display.webp` : null,
    width: asset.width,
    height: asset.height,
    reason: asset.reason,
  });
}

export async function readMediaAsset(userId: string, id: string, write = false): Promise<Asset> {
  const [asset] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, id));
  if (!asset) return fail(404, 'Image upload not found');
  await authorizeMediaTarget(userId, asset.targetType, asset.targetId, write);
  if (write && asset.uploaderId !== userId) fail(403, 'This upload belongs to another account');
  return asset;
}

export async function initializeMedia(
  userId: string,
  source: string,
  body: z.infer<typeof mediaInitialize>,
) {
  await assertUploadsEnabled(userId);
  await authorizeMediaTarget(userId, body.targetType, body.targetId, true);
  const c = mediaConfig();
  await consumeMediaBudget(`init-ip:${mediaDigest(source)}`, 1, c.MEDIA_UPLOADS_PER_IP_HOUR, 3600);
  // Retried initialization returns the same asset without consuming another
  // account allocation. The source request budget still bounds abusive retries.
  return withAudit(userId, body.clientUploadId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(748201)`);
    const [existing] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.uploaderId, userId),
          eq(mediaAssets.clientUploadId, body.clientUploadId),
        ),
      );
    if (existing) {
      if (
        existing.sha256 !== body.sha256 ||
        existing.inputBytes !== body.byteLength ||
        existing.targetType !== body.targetType ||
        existing.targetId !== body.targetId
      )
        fail(409, 'Upload key already used for a different image');
      return assetManifest(existing);
    }
    const sums = await tx.execute<{
      total: string;
      own: string;
    }>(sql`
      SELECT coalesce(sum(case when thumb_bytes+display_bytes=0 then ${MEDIA_OUTPUT_BYTES} else thumb_bytes+display_bytes end),0) AS total,
       coalesce(sum(case when thumb_bytes+display_bytes=0 then ${MEDIA_OUTPUT_BYTES} else thumb_bytes+display_bytes end) FILTER(WHERE uploader_id=${userId}),0) AS own FROM media_assets`);
    const n = sums.rows[0];
    if (
      !n ||
      Number(n.total) + MEDIA_OUTPUT_BYTES > c.MEDIA_TOTAL_BYTES ||
      Number(n.own) + MEDIA_OUTPUT_BYTES > c.MEDIA_USER_BYTES
    )
      fail(429, 'Image storage quota reached');
    await consumeMediaBudget(`init-hour:${userId}`, 1, c.MEDIA_UPLOADS_PER_HOUR, 3600);
    await consumeMediaBudget(`init-day:${userId}`, 1, c.MEDIA_UPLOADS_PER_DAY, 86400);
    await consumeMediaBudget('init-global', 1, c.MEDIA_UPLOADS_PER_HOUR_TOTAL, 3600);
    const [asset] = await tx
      .insert(mediaAssets)
      .values({
        uploaderId: userId,
        clientUploadId: body.clientUploadId,
        targetType: body.targetType,
        targetId: body.targetId,
        inputBytes: body.byteLength,
        sha256: body.sha256,
        token: randomBytes(32).toString('hex'),
      })
      .returning();
    if (!asset) throw new Error('Image allocation failed');
    return assetManifest(asset);
  });
}

export async function uploadMedia(userId: string, id: string, bytes: Uint8Array) {
  await assertUploadsEnabled(userId);
  const asset = await readMediaAsset(userId, id, true);
  if (asset.inputBytes !== bytes.length || mediaDigest(bytes) !== asset.sha256)
    fail(422, 'Image bytes do not match the upload declaration');
  if (asset.state === 'ready') return assetManifest(asset);
  if (asset.state === 'cancelled' || asset.state === 'deleting' || asset.state === 'rejected')
    fail(422, asset.reason ?? 'Upload is no longer available; choose the image again');
  await consumeMediaBudget(`content:${userId}`, 1, 100, 3600);
  const prefix = `images/${asset.id}/${randomBytes(16).toString('hex')}`;
  await withAudit(userId, asset.clientUploadId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(748201)`);
    const [current] = await tx
      .select({ state: mediaAssets.state, leased: sql<boolean>`${mediaAssets.leaseUntil} > now()` })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .for('update');
    if (!current || !['pending', 'processing'].includes(current.state))
      fail(409, 'Upload changed; reload its status');
    if (current.leased) fail(503, 'Image is already being processed');
    const count = await tx.execute<{ n: string }>(
      sql`select count(*) as n from media_assets where state='processing' and lease_until>now()`,
    );
    if (Number(count.rows[0]?.n) >= mediaConfig().MEDIA_PROCESSING_CONCURRENCY)
      fail(503, 'Image processor is busy; retry shortly');
    await tx
      .update(mediaAssets)
      .set({
        state: 'processing',
        objectPrefix: prefix,
        leaseUntil: sql`now() + interval '2 minutes'`,
        reason: null,
      })
      .where(eq(mediaAssets.id, id));
  });
  try {
    const storage = mediaStorage();
    // A failed/crashed attempt may have written only one variant. Remove its
    // generation before allocating more storage; fail closed if cleanup fails.
    let cursor: string | undefined;
    do {
      const page = await storage.list(`images/${asset.id}/`, cursor);
      for (const key of page.keys) await storage.remove(key);
      cursor = page.cursor;
    } while (cursor);
    const result = await processImage(bytes, asset.targetType);
    await storage.put(`${prefix}/thumb.webp`, result.thumb);
    await storage.put(`${prefix}/display.webp`, result.display);
    // Recheck permissions after potentially slow decoding/network work.
    await assertUploadsEnabled(userId);
    await authorizeMediaTarget(userId, asset.targetType, asset.targetId, true);
    return await withAudit(userId, asset.clientUploadId, async (tx) => {
      const [ready] = await tx
        .update(mediaAssets)
        .set({
          state: 'ready',
          thumbBytes: result.thumb.length,
          displayBytes: result.display.length,
          width: result.width,
          height: result.height,
          leaseUntil: null,
        })
        .where(
          and(
            eq(mediaAssets.id, id),
            eq(mediaAssets.objectPrefix, prefix),
            eq(mediaAssets.state, 'processing'),
          ),
        )
        .returning();
      if (!ready) fail(409, 'Upload was cancelled or superseded');
      return assetManifest(ready);
    });
  } catch (error) {
    const permanent = error instanceof HTTPException && [403, 404, 422].includes(error.status);
    await withAudit(userId, asset.clientUploadId, (tx) =>
      tx
        .update(mediaAssets)
        .set({
          state: permanent ? 'rejected' : 'pending',
          leaseUntil: null,
          reason: permanent ? (error as Error).message.slice(0, 500) : null,
        })
        .where(
          and(
            eq(mediaAssets.id, id),
            eq(mediaAssets.objectPrefix, prefix),
            eq(mediaAssets.state, 'processing'),
          ),
        ),
    );
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(503, {
      message: 'Image storage is unavailable; the upload can be retried',
    });
  }
}

/** Called inside the parent write transaction after its authorization/row lock. */
export async function prepareMediaAttachment(
  tx: AuditTx,
  target: MediaTarget,
  targetId: string,
  updates: Record<string, unknown>,
) {
  const value = updates[mediaField(target)];
  if (value === undefined || value === null) return;
  const [asset] = await tx
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.id, String(value)))
    .for('update');
  if (
    !asset ||
    asset.state !== 'ready' ||
    asset.targetType !== target ||
    asset.targetId !== targetId
  )
    fail(422, 'Choose a completed image upload for this character or campaign');
  await tx
    .update(mediaAssets)
    .set({ publishedAt: asset.publishedAt ?? new Date(), detachedAt: null })
    .where(eq(mediaAssets.id, asset.id));
}

export async function cancelMedia(userId: string, id: string) {
  const asset = await readMediaAsset(userId, id, true);
  return withAudit(userId, asset.clientUploadId, async (tx) => {
    const [locked] = await tx
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .for('update');
    if (!locked || locked.publishedAt)
      fail(409, 'Remove the image from its character or campaign instead');
    const [row] = await tx
      .update(mediaAssets)
      .set({ state: 'cancelled', leaseUntil: null, reason: 'Upload cancelled' })
      .where(eq(mediaAssets.id, id))
      .returning();
    if (!row) fail(404, 'Image upload not found');
    return assetManifest(row);
  });
}

let activePublicReads = 0;
export async function publicMedia(token: string, variant: 'thumb' | 'display', source: string) {
  const c = mediaConfig();
  await consumeMediaBudget(`read:${mediaDigest(source)}`, 1, c.MEDIA_READS_PER_IP_HOUR, 3600);
  const [asset] = await getDb()
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.token, token), eq(mediaAssets.state, 'ready')));
  if (!asset?.publishedAt || !asset.objectPrefix) return fail(404, 'Image not found');
  const size = variant === 'thumb' ? asset.thumbBytes : asset.displayBytes;
  await consumeMediaBudget('read-bytes', size, c.MEDIA_READ_BYTES_PER_HOUR, 3600);
  if (activePublicReads >= 16) fail(503, 'Image delivery is busy; retry shortly');
  activePublicReads++;
  try {
    return await mediaStorage().get(`${asset.objectPrefix}/${variant}.webp`);
  } catch {
    return fail(503, 'Image storage is temporarily unavailable');
  } finally {
    activePublicReads--;
  }
}

export async function takeDownMedia(actorId: string, id: string) {
  const [asset] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, id));
  if (!asset) fail(404, 'Image upload not found');
  await withAudit(actorId, undefined, async (tx) => {
    // Lock the target even if this asset has not been attached yet; otherwise
    // an attachment racing takedown could publish between the two updates.
    if (asset.targetType === 'character')
      await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, asset.targetId))
        .for('update');
    else
      await tx
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.id, asset.targetId))
        .for('update');
    // Parent-before-asset lock order matches ordinary attachment writes.
    await tx
      .update(characters)
      .set({ portraitAssetId: null, updatedAt: new Date() })
      .where(eq(characters.portraitAssetId, id));
    await tx
      .update(campaigns)
      .set({ coverAssetId: null, updatedAt: new Date() })
      .where(eq(campaigns.coverAssetId, id));
    await tx
      .update(mediaAssets)
      .set({ state: 'cancelled', reason: 'Removed by the server operator', detachedAt: new Date() })
      .where(eq(mediaAssets.id, id));
  });
}
