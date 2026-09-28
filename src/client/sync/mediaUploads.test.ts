import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_LOCAL_BYTES, type MediaManifest } from '../../shared/schemas/media.ts';
import { type LocalMediaUpload, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { api } from '../lib/api.ts';
import { writeActiveUser } from './activeUser.ts';
import { drainOneImage, enqueueImage, removeImage, retryImage } from './mediaUploads.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import { enqueueFieldPatch, readDrainableOps } from './outbox.ts';

vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...actual, api: vi.fn() };
});

const USER_ID = '0193b3c0-f1f0-7000-8000-00000000a001';
const CHARACTER_ID = '0193b3c0-f1f0-7000-8000-00000000a002';
const ASSET_ID = '0193b3c0-f1f0-7000-8000-00000000a003';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function manifest(state: MediaManifest['state'] = 'ready'): MediaManifest {
  return {
    id: ASSET_ID,
    state,
    thumbUrl: state === 'ready' ? `/media/${ASSET_ID}/thumb.webp` : null,
    displayUrl: state === 'ready' ? `/media/${ASSET_ID}/display.webp` : null,
    width: state === 'ready' ? 256 : null,
    height: state === 'ready' ? 256 : null,
    reason: null,
  };
}

function image(label: string): Blob {
  return new NodeBlob([label], { type: 'image/png' });
}

async function seedCharacter(revision = 1) {
  await getLocalDb().characters.put({
    id: CHARACTER_ID,
    ownerId: USER_ID,
    campaignId: null,
    name: 'Local hero',
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
    st: 10,
    dx: 10,
    iq: 10,
    ht: 10,
    hpMod: 0,
    willMod: 0,
    perMod: 0,
    fpMod: 0,
    speedQuarterMod: 0,
    moveMod: 0,
    dismissedWarnings: [],
    activeConditionGroups: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision,
  });
}

async function login() {
  writeActiveUser(USER_ID);
}

afterEach(async () => {
  vi.mocked(api).mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSyncOrchestratorForTests();
  writeActiveUser('');
  window.localStorage.removeItem('gpc.activeUser');
  await resetLocalDb();
});

describe('media upload outbox', () => {
  it('persists the selected blob and queues its attachment patch atomically', async () => {
    await login();
    await seedCharacter();

    await enqueueImage('character', CHARACTER_ID, image('portrait bytes'));

    const db = getLocalDb();
    const upload = await db.mediaUploads.toCollection().first();
    const [op] = await db.outbox.toArray();
    expect(upload).toMatchObject({
      userId: USER_ID,
      targetType: 'character',
      targetId: CHARACTER_ID,
      byteLength: 14,
      state: 'queued',
    });
    expect(upload?.blob).toBeInstanceOf(NodeBlob);
    expect(await upload?.blob.text()).toBe('portrait bytes');
    expect(upload?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(op).toMatchObject({
      entityClass: 'character',
      entityId: CHARACTER_ID,
      fieldPath: 'portraitAssetId',
      attemptedValue: upload?.id,
      localMediaUploadId: upload?.id,
      localMediaReady: false,
    });
    expect((await db.characters.get(CHARACTER_ID))?.portraitAssetId).toBe(upload?.id);
  });

  it('holds only the attachment patch until its media dependency is ready', async () => {
    await login();
    await seedCharacter(-1);
    await enqueueImage('character', CHARACTER_ID, image('portrait'));
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHARACTER_ID,
      fieldPath: 'st',
      attemptedValue: 11,
    });

    const db = getLocalDb();
    const upload = await db.mediaUploads.toCollection().first();
    if (!upload) throw new Error('Expected one queued portrait upload');
    const controller = new AbortController();
    await drainOneImage(USER_ID, controller.signal, vi.fn());

    expect(api).not.toHaveBeenCalled();
    expect((await readDrainableOps(10)).map((op) => op.fieldPath)).toEqual(['st']);
    expect((await db.mediaUploads.get(upload.id))?.state).toBe('queued');
  });

  it('keeps a replacement and a different-field edit when an earlier upload settles late', async () => {
    await login();
    await seedCharacter();
    const started = deferred<MediaManifest>();
    vi.mocked(api).mockReturnValueOnce(started.promise as never);

    await enqueueImage('character', CHARACTER_ID, image('first portrait'));
    const first = await getLocalDb().mediaUploads.toCollection().first();
    if (!first) throw new Error('Expected the first portrait upload');
    const controller = new AbortController();
    const draining = drainOneImage(USER_ID, controller.signal, vi.fn());
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const [requestPath, requestOptions] = vi.mocked(api).mock.calls[0] ?? [];
    expect(requestPath).toMatch(/^\/media\/uploads\/bytes\?/);
    expect(requestOptions).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(requestOptions?.rawBody).toBeInstanceOf(NodeBlob);
    if (!(requestOptions?.rawBody instanceof NodeBlob))
      throw new Error('Expected the raw upload request to contain a Blob');
    expect(await requestOptions.rawBody.text()).toBe('first portrait');
    const requestUrl = new URL(requestPath ?? '', 'https://example.test');
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      clientUploadId: first.id,
      targetType: 'character',
      targetId: CHARACTER_ID,
      byteLength: String(first.byteLength),
      sha256: first.sha256,
    });

    await enqueueImage('character', CHARACTER_ID, image('new portrait'));
    const replacement = await getLocalDb().mediaUploads.toCollection().first();
    if (!replacement) throw new Error('Expected the replacement portrait upload');
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: CHARACTER_ID,
      fieldPath: 'st',
      attemptedValue: 12,
    });
    started.resolve(manifest());
    await draining;

    const db = getLocalDb();
    expect(replacement.id).not.toBe(first.id);
    expect(await db.mediaUploads.get(first.id)).toBeUndefined();
    expect((await db.characters.get(CHARACTER_ID))?.portraitAssetId).toBe(replacement.id);
    expect((await db.characters.get(CHARACTER_ID))?.st).toBe(12);
    expect(
      (await db.outbox.toArray()).find((op) => op.fieldPath === 'portraitAssetId')?.attemptedValue,
    ).toBe(replacement.id);
    expect((await readDrainableOps(10)).map((op) => op.fieldPath)).toContain('st');
  });

  it('retries a lost upload reply with the identical idempotency key and bytes', async () => {
    await login();
    await seedCharacter();
    await enqueueImage('character', CHARACTER_ID, image('possibly stored already'));
    const original = await getLocalDb().mediaUploads.toCollection().first();
    if (!original) throw new Error('Expected the original portrait upload');

    vi.mocked(api)
      .mockRejectedValueOnce(new Error('response connection lost'))
      .mockResolvedValueOnce(manifest() as never);
    const controller = new AbortController();
    await drainOneImage(USER_ID, controller.signal, vi.fn());

    const afterLostReply = await getLocalDb().mediaUploads.get(original.id);
    expect(afterLostReply).toMatchObject({ state: 'queued', attempts: 1 });
    if (!afterLostReply) throw new Error('Expected the upload to remain queued after a lost reply');

    // fake-indexeddb loses Node's Blob prototype when a row is updated, unlike
    // browser IndexedDB. Reinsert the original body while clearing backoff.
    await getLocalDb().mediaUploads.put({ ...afterLostReply, blob: original.blob, retryAt: 0 });
    await drainOneImage(USER_ID, controller.signal, vi.fn());

    const calls = vi.mocked(api).mock.calls;
    expect(calls).toHaveLength(2);
    const [firstPath, firstOptions] = calls[0] ?? [];
    const [retryPath, retryOptions] = calls[1] ?? [];
    expect(retryPath).toBe(firstPath);
    expect(retryOptions).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
    });
    if (
      !(firstOptions?.rawBody instanceof NodeBlob) ||
      !(retryOptions?.rawBody instanceof NodeBlob)
    )
      throw new Error('Expected both upload attempts to contain raw Blob bodies');
    expect(retryOptions.rawBody.type).toBe(firstOptions.rawBody.type);
    expect(retryOptions.rawBody.size).toBe(firstOptions.rawBody.size);
    expect(await retryOptions.rawBody.arrayBuffer()).toEqual(
      await firstOptions.rawBody.arrayBuffer(),
    );

    const local = await getLocalDb().characters.get(CHARACTER_ID);
    expect(local?.portraitAssetId).toBe(ASSET_ID);
    expect(await getLocalDb().mediaUploads.get(original.id)).toMatchObject({
      state: 'ready',
      assetId: ASSET_ID,
    });
    expect(
      (await getLocalDb().outbox.toArray()).find((op) => op.localMediaUploadId === original.id),
    ).toMatchObject({ attemptedValue: ASSET_ID, localMediaReady: true });
  });

  it('preserves a pending local portrait when a newer cursor row arrives', async () => {
    await login();
    await seedCharacter();
    await enqueueImage('character', CHARACTER_ID, image('portrait'));

    const orchestrator = getSyncOrchestrator() as unknown as {
      applyServerRow(
        entityClass: 'character',
        row: Record<string, unknown>,
        opts: object,
      ): Promise<void>;
    };
    await orchestrator.applyServerRow(
      'character',
      {
        id: CHARACTER_ID,
        ownerId: USER_ID,
        campaignId: null,
        name: 'Server name',
        portraitAssetId: ASSET_ID,
        revision: 2,
      },
      {},
    );

    const local = await getLocalDb().characters.get(CHARACTER_ID);
    expect(local?.name).toBe('Server name');
    expect(local?.portraitAssetId).not.toBe(ASSET_ID);
    expect(local?.portraitAssetId).toBe(
      (await getLocalDb().mediaUploads.toCollection().first())?.id,
    );
  });

  it('retains rejected source bytes and delegates attachment rollback with the reason', async () => {
    await login();
    await seedCharacter();
    await enqueueImage('character', CHARACTER_ID, image('retry me'));
    const upload = await getLocalDb().mediaUploads.toCollection().first();
    if (!upload) throw new Error('Expected the rejected upload to remain recoverable');
    const rejected = manifest('rejected');
    rejected.reason = 'Image was rejected';
    vi.mocked(api).mockResolvedValueOnce(rejected as never);
    const reject = vi.fn().mockResolvedValue(undefined);

    await drainOneImage(USER_ID, new AbortController().signal, reject);

    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject).toHaveBeenCalledWith(
      expect.objectContaining({ localMediaUploadId: upload.id }),
      'Image was rejected',
    );
    expect(await getLocalDb().mediaUploads.get(upload.id)).toMatchObject({
      state: 'failed',
      reason: 'Image was rejected',
      attempts: 1,
      blob: upload.blob,
    });
  });

  it('replaces a failed source atomically when pending uploads already fill the local quota', async () => {
    await login();
    await seedCharacter();
    const source = image('failed bytes');
    const failed: LocalMediaUpload = {
      id: '0193b3c0-f1f0-7000-8000-00000000a004',
      userId: USER_ID,
      targetType: 'character',
      targetId: CHARACTER_ID,
      blob: source,
      byteLength: source.size,
      sha256: 'a'.repeat(64),
      state: 'failed',
      reason: 'Temporary storage issue',
      attempts: 1,
      createdAt: new Date().toISOString(),
    };
    const other: LocalMediaUpload = {
      ...failed,
      id: '0193b3c0-f1f0-7000-8000-00000000a005',
      targetType: 'campaign',
      targetId: '0193b3c0-f1f0-7000-8000-00000000a006',
      blob: image('other'),
      byteLength: MEDIA_LOCAL_BYTES - source.size,
      state: 'queued',
      reason: 'Waiting for upload',
    };
    // The accounting value represents a separate large upload. Its payload
    // is not read by this retry test; the failed source itself remains exact.
    await getLocalDb().mediaUploads.bulkAdd([failed, other]);

    await retryImage(failed);

    const db = getLocalDb();
    const uploads = await db.mediaUploads.toArray();
    const retried = uploads.find((upload) => upload.targetId === CHARACTER_ID);
    expect(uploads.find((upload) => upload.id === failed.id)).toBeUndefined();
    expect(retried).toMatchObject({
      userId: USER_ID,
      targetType: 'character',
      targetId: CHARACTER_ID,
      state: 'queued',
      attempts: 0,
      byteLength: source.size,
    });
    expect(retried?.id).not.toBe(failed.id);
    expect(await retried?.blob.text()).toBe('failed bytes');
    expect(uploads.reduce((sum, upload) => sum + upload.byteLength, 0)).toBe(MEDIA_LOCAL_BYTES);
    expect(
      (await db.outbox.toArray()).find((op) => op.fieldPath === 'portraitAssetId'),
    ).toMatchObject({
      attemptedValue: retried?.id,
      localMediaUploadId: retried?.id,
    });
  });

  it('lets removal supersede an unsent upload and clears its local bytes', async () => {
    await login();
    await seedCharacter();
    await enqueueImage('character', CHARACTER_ID, image('discard me'));
    const upload = await getLocalDb().mediaUploads.toCollection().first();
    if (!upload) throw new Error('Expected the selected upload before removal');

    await removeImage('character', CHARACTER_ID);

    const db = getLocalDb();
    expect(await db.mediaUploads.get(upload.id)).toBeUndefined();
    expect((await db.characters.get(CHARACTER_ID))?.portraitAssetId).toBeNull();
    const [op] = await db.outbox.toArray();
    expect(op).toMatchObject({ fieldPath: 'portraitAssetId', attemptedValue: null });
    expect(op?.localMediaUploadId).toBeUndefined();
  });

  it('stops a session-fenced upload after cancellation during the byte request', async () => {
    await login();
    await seedCharacter();
    await enqueueImage('character', CHARACTER_ID, image('abort me'));
    const started = deferred<MediaManifest>();
    vi.mocked(api).mockReturnValueOnce(started.promise as never);
    const controller = new AbortController();
    const draining = drainOneImage(USER_ID, controller.signal, vi.fn());
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));

    controller.abort();
    started.resolve({ ...manifest('pending'), id: ASSET_ID });
    await draining;

    expect(api).toHaveBeenCalledTimes(1);
    expect(await getLocalDb().mediaUploads.count()).toBe(1);
  });
});
