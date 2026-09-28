import {
  MEDIA_INPUT_BYTES,
  MEDIA_LOCAL_BYTES,
  type MediaTarget,
  mediaField,
  mediaManifest,
} from '../../shared/schemas/media.ts';
import {
  ALL_STORE_NAMES,
  type LocalMediaUpload,
  type OutboxEntry,
  getLocalDb,
} from '../db/dexie.ts';
import { readSyncEntity, updateSyncEntity } from '../db/syncEntityStore.ts';
import { ApiError, api } from '../lib/api.ts';
import { readActiveUser } from './activeUser.ts';
import { backoffMs, enqueueFieldPatch, newClientId } from './outbox.ts';

export async function enqueueImage(
  targetType: MediaTarget,
  targetId: string,
  blob: Blob,
  replacesUploadId?: string,
): Promise<void> {
  if (!blob.size || blob.size > MEDIA_INPUT_BYTES)
    throw new Error('Choose an image no larger than 10 MiB');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type))
    throw new Error('Choose a JPEG, PNG, or WebP image');
  if (!globalThis.crypto?.subtle) throw new Error('Image uploads require HTTPS or localhost');
  const userId = readActiveUser();
  if (!userId) throw new Error('Sign in before selecting an image');
  const bytes = await blob.arrayBuffer();
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  if (readActiveUser() !== userId) throw new Error('The signed-in account changed');
  const db = getLocalDb();
  const id = newClientId();
  await db.transaction('rw', ALL_STORE_NAMES, async () => {
    if (readActiveUser() !== userId) throw new Error('The signed-in account changed');
    const existing = await db.mediaUploads.toArray();
    if (
      replacesUploadId &&
      !existing.some(
        (u) =>
          u.id === replacesUploadId &&
          u.userId === userId &&
          u.targetType === targetType &&
          u.targetId === targetId,
      )
    )
      throw new Error('The image to retry is no longer available');
    if (
      existing.filter((u) => u.id !== replacesUploadId).reduce((n, u) => n + u.byteLength, 0) +
        blob.size >
      MEDIA_LOCAL_BYTES
    )
      throw new Error('Pending images exceed 50 MiB; sync or discard an earlier upload first');
    if (replacesUploadId) await db.mediaUploads.delete(replacesUploadId);
    const parent = await readSyncEntity(targetType, targetId);
    if (!parent) throw new Error('Character or campaign is no longer available');
    await db.mediaUploads.add({
      id,
      userId,
      targetType,
      targetId,
      blob,
      byteLength: blob.size,
      sha256,
      state: 'queued',
      attempts: 0,
      createdAt: new Date().toISOString(),
    });
    await enqueueFieldPatch({
      entityClass: targetType,
      entityId: targetId,
      fieldPath: mediaField(targetType),
      attemptedValue: id,
      localMediaUploadId: id,
      humanName: targetType === 'character' ? 'Portrait' : 'Campaign cover',
    });
    // Superseded, unsent jobs have no remaining operation. Keep uncertain
    // predecessors and failed sources until explicitly discarded.
    const ops = await db.outbox.toArray();
    for (const upload of existing)
      if (
        upload.targetId === targetId &&
        upload.state !== 'failed' &&
        !ops.some((op) => op.localMediaUploadId === upload.id)
      )
        await db.mediaUploads.delete(upload.id);
  });
  void navigator.storage?.persist?.().catch(() => false);
}

export async function removeImage(targetType: MediaTarget, targetId: string) {
  const db = getLocalDb();
  await db.transaction('rw', ALL_STORE_NAMES, async () => {
    await enqueueFieldPatch({
      entityClass: targetType,
      entityId: targetId,
      fieldPath: mediaField(targetType),
      attemptedValue: null,
      humanName: targetType === 'character' ? 'Portrait' : 'Campaign cover',
    });
    const ops = await db.outbox.toArray();
    const uploads = await db.mediaUploads.where('targetId').equals(targetId).toArray();
    for (const upload of uploads)
      if (!ops.some((op) => op.localMediaUploadId === upload.id))
        await db.mediaUploads.delete(upload.id);
  });
}

export async function retryImage(upload: LocalMediaUpload) {
  // Digest happens first; replacement of the recovery source is transactional.
  await enqueueImage(upload.targetType, upload.targetId, upload.blob, upload.id);
}

export type RejectMedia = (op: OutboxEntry, reason: string) => Promise<void>;
/** Runs under a separate cross-tab media lock, never the ordinary drain lock. */
export async function drainOneImage(userId: string, signal: AbortSignal, reject: RejectMedia) {
  const db = getLocalDb();
  const uploads = await db.mediaUploads.where('userId').equals(userId).toArray();
  for (const upload of uploads) {
    if (signal.aborted) return;
    const op = await db.outbox.filter((row) => row.localMediaUploadId === upload.id).first();
    if (
      !op ||
      op.localMediaReady ||
      upload.state === 'failed' ||
      (upload.retryAt ?? 0) > Date.now()
    )
      continue;
    const parent = await readSyncEntity(upload.targetType, upload.targetId);
    if (parent?.revision === -1) continue;
    try {
      if (!parent || parent.accessRevoked)
        throw new ApiError(403, 'The character or campaign is no longer accessible');
      await db.mediaUploads.update(upload.id, { state: 'uploading' });
      const metadata = new URLSearchParams({
        clientUploadId: upload.id,
        targetType: upload.targetType,
        targetId: upload.targetId,
        byteLength: String(upload.byteLength),
        sha256: upload.sha256,
      });
      // Repeat this same upload on every retry, including after a lost reply.
      // The server binds clientUploadId to the target and content declaration.
      const manifest = mediaManifest.parse(
        await api(`/media/uploads/bytes?${metadata}`, {
          method: 'POST',
          rawBody: upload.blob,
          headers: { 'content-type': 'application/octet-stream' },
          signal,
        }),
      );
      if (signal.aborted) return;
      if (manifest.state !== 'ready')
        throw new ApiError(422, manifest.reason ?? 'Upload is no longer available');
      await db.transaction('rw', ALL_STORE_NAMES, async () => {
        if (signal.aborted) return;
        const current = await db.outbox.get(op.clientOpId);
        if (!current || !(await db.mediaUploads.get(upload.id))) return;
        await db.mediaManifests.put(manifest);
        await db.mediaUploads.update(upload.id, { state: 'ready', assetId: manifest.id });
        await db.outbox.update(op.clientOpId, {
          attemptedValue: manifest.id,
          localMediaReady: true,
        });
        const local = await readSyncEntity(upload.targetType, upload.targetId);
        const field = mediaField(upload.targetType);
        if (local?.[field] === upload.id)
          await updateSyncEntity(upload.targetType, upload.targetId, { [field]: manifest.id });
        // A successor may have captured the temporary ID as its rollback base.
        await db.outbox
          .where('entityId')
          .equals(upload.targetId)
          .filter((row) => row.fieldPath === field && row.prevValue === upload.id)
          .modify({ prevValue: manifest.id });
      });
    } catch (error) {
      if (signal.aborted) return;
      const reason = error instanceof Error ? error.message : 'Image upload failed';
      const permanent =
        error instanceof ApiError && [400, 403, 404, 413, 422].includes(error.status);
      await db.mediaUploads.update(upload.id, {
        state: permanent ? 'failed' : 'queued',
        reason,
        attempts: upload.attempts + 1,
        retryAt: Date.now() + backoffMs(upload.attempts + 1),
      });
      if (permanent) {
        const current = await db.outbox.get(op.clientOpId);
        if (current) await reject(current, reason);
      }
    }
    return true;
  }
  return false;
}

const warmedThumbnails = new Set<string>();

/** URL metadata is account-scoped. Image response bodies use native caches. */
export async function warmMediaManifests(signal: AbortSignal) {
  const db = getLocalDb();
  const characters = await db.characters.toArray();
  const campaigns = await db.campaigns.toArray();
  const ids = [
    ...new Set(
      [
        ...characters.filter((c) => !c.accessRevoked).map((c) => c.portraitAssetId),
        ...campaigns.map((c) => c.coverAssetId),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  let count = 0;
  for (const id of ids) {
    if (signal.aborted || count >= 10) return;
    const saved = await db.mediaManifests.get(id);
    if (saved?.thumbUrl && !warmedThumbnails.has(saved.thumbUrl) && !signal.aborted) {
      const url = saved.thumbUrl;
      warmedThumbnails.add(url);
      void fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then((r) => {
          if (!r.ok) warmedThumbnails.delete(url);
        })
        .catch(() => warmedThumbnails.delete(url));
    }
    if (saved || (await db.mediaUploads.get(id))) continue;
    count++;
    try {
      const manifest = mediaManifest.parse(await api(`/media/uploads/${id}`, { signal }));
      await db.transaction('rw', db.mediaManifests, async () => {
        if (!signal.aborted) await db.mediaManifests.put(manifest);
      });
      if (manifest.thumbUrl && !signal.aborted)
        void fetch(manifest.thumbUrl, {
          signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        }).catch(() => undefined);
    } catch {
      /* A missing image must never block the character-data cursor. */
    }
  }
}
