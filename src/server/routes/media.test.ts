import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { createApp } from '../app.ts';
import { getDb } from '../db/client.ts';
import { mediaAssets, mediaCounters, users } from '../db/schema.ts';
import { sweepMedia } from '../services/media/maintenance.ts';
import type { MediaStorage } from '../services/media/storage.ts';
import { setMediaStorageForTests } from '../services/media/storage.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const savedEnvironment = new Map<string, string | undefined>();
const mediaEnvironment = {
  MEDIA_S3_BUCKET: 'media-test-bucket',
  MEDIA_S3_ACCESS_KEY: 'media-test-access',
  MEDIA_S3_SECRET_KEY: 'media-test-secret',
  MEDIA_UPLOADS_ENABLED: 'true',
  MEDIA_USER_BYTES: String(100 * 1024 * 1024),
  MEDIA_TOTAL_BYTES: String(10 * 1024 * 1024 * 1024),
  MEDIA_UPLOADS_PER_HOUR: '100',
  MEDIA_UPLOADS_PER_DAY: '100',
  MEDIA_UPLOADS_PER_IP_HOUR: '1000',
  MEDIA_UPLOADS_PER_HOUR_TOTAL: '1000',
  MEDIA_PROCESSING_CONCURRENCY: '1',
  MEDIA_READS_PER_IP_HOUR: '10000',
  MEDIA_READ_BYTES_PER_HOUR: String(100 * 1024 * 1024),
};
for (const [key, value] of Object.entries(mediaEnvironment)) {
  savedEnvironment.set(key, process.env[key]);
  process.env[key] = value;
}

const app = createApp(integrationTestConfig);
const objects = new Map<string, Uint8Array>();
let failRemovePrefix: string | undefined;
let failedRemovals = 0;
let putGate: { started: () => void; release: Promise<void> } | undefined;
const storage: MediaStorage = {
  async put(key, bytes) {
    const gate = putGate;
    if (gate) {
      putGate = undefined;
      gate.started();
      await gate.release;
    }
    objects.set(key, Uint8Array.from(bytes));
  },
  async get(key) {
    const bytes = objects.get(key);
    if (!bytes) throw new Error('missing object');
    return bytes;
  },
  async head(key) {
    return objects.get(key)?.length ?? 0;
  },
  async remove(key) {
    if (failRemovePrefix && key.startsWith(failRemovePrefix) && failedRemovals === 0) {
      failedRemovals++;
      throw new Error('injected object deletion failure');
    }
    objects.delete(key);
  },
  async list(prefix) {
    return { keys: [...objects.keys()].filter((key) => key.startsWith(prefix)) };
  },
};

beforeEach(() => {
  objects.clear();
  failRemovePrefix = undefined;
  failedRemovals = 0;
  putGate = undefined;
  setMediaStorageForTests(storage);
});

afterEach(() => setMediaStorageForTests(undefined));
afterAll(() => {
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function jsonHeaders(token: string) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function register(label: string) {
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `media-${label}-${randomUUID()}@example.com`,
      password: 'MediaTestPassword1!',
      displayName: `Media ${label}`,
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { accessToken: string };
}

async function createCharacter(token: string) {
  const response = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ name: `Media character ${randomUUID()}` }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; portraitAssetId: string | null };
}

async function createCampaign(token: string) {
  const response = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ name: `Media campaign ${randomUUID()}` }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; coverAssetId: string | null };
}

async function png(background = { r: 80, g: 120, b: 160 }) {
  return sharp({
    create: { width: 32, height: 24, channels: 3, background },
  })
    .png()
    .toBuffer();
}

async function initialize(
  token: string,
  targetType: 'character' | 'campaign',
  targetId: string,
  bytes: Uint8Array,
  clientUploadId = randomUUID(),
) {
  const response = await app.request('/api/v1/media/uploads', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({
      clientUploadId,
      targetType,
      targetId,
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      base64: Buffer.from(bytes).toString('base64'),
    }),
  });
  return { response, clientUploadId };
}

async function upload(
  token: string,
  targetType: 'character' | 'campaign',
  targetId: string,
  bytes: Uint8Array,
) {
  const { response, clientUploadId } = await initialize(token, targetType, targetId, bytes);
  expect(response.status).toBe(200);
  const ready = (await response.json()) as {
    id: string;
    state: string;
    thumbUrl: string | null;
    displayUrl: string | null;
  };
  expect(ready.state).toBe('ready');
  expect(ready.thumbUrl).not.toBeNull();
  expect(ready.displayUrl).not.toBeNull();
  return { ...ready, clientUploadId };
}

describe('media upload and public image routes', () => {
  it('denies image upload reservations after an administrator disables an account', async () => {
    const owner = await register('disabled-uploader');
    const character = await createCharacter(owner.accessToken);
    const auth = await app.request('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    const account = (await auth.json()) as { id: string };
    await getDb().update(users).set({ mediaUploadsDisabled: true }).where(eq(users.id, account.id));

    const denied = await initialize(owner.accessToken, 'character', character.id, await png());
    expect(denied.response.status).toBe(403);
    expect(await denied.response.json()).toMatchObject({
      error: 'Image uploads are disabled for this account',
    });
  });

  it('enforces target access, publishes only attached assets, and serves immutable bytes without login', async () => {
    const owner = await register('public-owner');
    const outsider = await register('public-outsider');
    const character = await createCharacter(owner.accessToken);
    const bytes = await png();

    const denied = await initialize(outsider.accessToken, 'character', character.id, bytes);
    expect(denied.response.status).toBe(403);

    const asset = await upload(owner.accessToken, 'character', character.id, bytes);
    const unpublished = await app.request(asset.thumbUrl as string);
    expect(unpublished.status).toBe(404);
    expect(unpublished.headers.get('cache-control')).toBe('no-store');

    const attached = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ portraitAssetId: asset.id }),
    });
    expect(attached.status).toBe(200);
    expect(((await attached.json()) as { portraitAssetId: string }).portraitAssetId).toBe(asset.id);

    const image = await app.request(asset.thumbUrl as string);
    expect(image.status).toBe(200);
    expect(image.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(image.headers.get('content-type')).toBe('image/webp');
    expect(image.headers.get('content-length')).toBe(String(objects.values().next().value?.length));
    expect(image.headers.get('etag')).toBe(`"${asset.thumbUrl?.split('/')[2]}-thumb.webp"`);
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(image.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('rejects cross-target references and keeps campaign cover writes owner-only', async () => {
    const owner = await register('campaign-owner');
    const member = await register('campaign-member');
    const campaign = await createCampaign(owner.accessToken);
    const invitation = await app.request(`/api/v1/campaigns/${campaign.id}/members`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ email: 'media-campaign-member-not-created@example.com' }),
    });
    expect(invitation.status).toBe(404);
    const memberMe = await app.request('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${member.accessToken}` },
    });
    const memberInfo = (await memberMe.json()) as { email: string };
    const added = await app.request(`/api/v1/campaigns/${campaign.id}/members`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ email: memberInfo.email }),
    });
    expect(added.status).toBe(200);

    const first = await createCharacter(owner.accessToken);
    const second = await createCharacter(owner.accessToken);
    const asset = await upload(owner.accessToken, 'character', first.id, await png());
    const crossTarget = await app.request(`/api/v1/characters/${second.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ portraitAssetId: asset.id }),
    });
    expect(crossTarget.status).toBe(422);
    const unchanged = await app.request(`/api/v1/characters/${second.id}`, {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(
      ((await unchanged.json()) as { portraitAssetId: string | null }).portraitAssetId,
    ).toBeNull();
    // The unused asset is intentionally still unpublished after the failed attach.
    expect((await app.request(asset.thumbUrl as string)).status).toBe(404);

    const cover = await upload(owner.accessToken, 'campaign', campaign.id, await png());
    const memberStatus = await app.request(`/api/v1/media/uploads/${cover.id}`, {
      headers: { authorization: `Bearer ${member.accessToken}` },
    });
    expect(memberStatus.status).toBe(200);
    const memberClientUploadLookup = await app.request(
      `/api/v1/media/uploads/${cover.clientUploadId}?lookup=clientUploadId`,
      { headers: { authorization: `Bearer ${member.accessToken}` } },
    );
    expect(memberClientUploadLookup.status).toBe(404);
    const memberPatch = await app.request(`/api/v1/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(member.accessToken),
      body: JSON.stringify({ coverAssetId: cover.id }),
    });
    expect(memberPatch.status).toBe(403);
    const ownerPatch = await app.request(`/api/v1/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ coverAssetId: cover.id }),
    });
    expect(ownerPatch.status).toBe(200);
    expect((await app.request(cover.thumbUrl as string)).status).toBe(200);
  });

  it('returns the same reservation for an idempotent retry and conflicts on changed declarations', async () => {
    const owner = await register('idempotent');
    const character = await createCharacter(owner.accessToken);
    const bytes = await png();
    const firstClientUploadId = randomUUID();
    const first = await initialize(
      owner.accessToken,
      'character',
      character.id,
      bytes,
      firstClientUploadId,
    );
    const firstBody = (await first.response.json()) as { id: string; state: string };
    expect(first.response.status).toBe(200);
    expect(firstBody.state).toBe('ready');

    const retry = await initialize(
      owner.accessToken,
      'character',
      character.id,
      bytes,
      first.clientUploadId,
    );
    expect(retry.response.status).toBe(200);
    expect((await retry.response.json()) as { id: string; state: string }).toMatchObject({
      id: firstBody.id,
      state: 'ready',
    });

    const changedBytes = await png({ r: 12, g: 34, b: 56 });
    const conflict = await initialize(
      owner.accessToken,
      'character',
      character.id,
      changedBytes,
      first.clientUploadId,
    );
    expect(conflict.response.status).toBe(409);
  });

  it('applies transactional per-account quotas across upload reservations', async () => {
    const previous = process.env.MEDIA_USER_BYTES;
    process.env.MEDIA_USER_BYTES = String(2 * 1024 * 1024);
    try {
      const owner = await register('quota');
      const character = await createCharacter(owner.accessToken);
      const bytes = await png();
      expect(
        (await initialize(owner.accessToken, 'character', character.id, bytes)).response.status,
      ).toBe(200);
      const second = await initialize(owner.accessToken, 'character', character.id, bytes);
      expect(second.response.status).toBe(429);
    } finally {
      if (previous === undefined) {
        // biome-ignore lint/performance/noDelete: restore the original absent environment key.
        delete process.env.MEDIA_USER_BYTES;
      } else process.env.MEDIA_USER_BYTES = previous;
    }
  });

  it('cancels by clientUploadId while storage is blocked and cleanup honors the live writer lease', async () => {
    const owner = await register('cancel-client-id');
    const character = await createCharacter(owner.accessToken);
    const bytes = await png();
    const clientUploadId = randomUUID();
    let started!: () => void;
    let release!: () => void;
    const putStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const putRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    putGate = { started, release: putRelease };

    const uploadRequest = initialize(
      owner.accessToken,
      'character',
      character.id,
      bytes,
      clientUploadId,
    );
    await putStarted;

    const cancelled = await app.request(
      `/api/v1/media/uploads/${clientUploadId}?lookup=clientUploadId`,
      { method: 'DELETE', headers: { authorization: `Bearer ${owner.accessToken}` } },
    );
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { state: string }).state).toBe('cancelled');

    await getDb().delete(mediaCounters).where(eq(mediaCounters.key, 'maintenance'));
    await sweepMedia();
    const [stillLeased] = await getDb()
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.clientUploadId, clientUploadId));
    expect(stillLeased?.state).toBe('cancelled');
    expect(stillLeased?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());

    const blockedClientUploadId = randomUUID();
    const blockedByRetainedLease = await initialize(
      owner.accessToken,
      'character',
      character.id,
      bytes,
      blockedClientUploadId,
    );
    expect(blockedByRetainedLease.response.status).toBe(503);
    await app.request(`/api/v1/media/uploads/${blockedClientUploadId}?lookup=clientUploadId`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });

    release();
    expect((await uploadRequest).response.status).toBe(409);
    await getDb().delete(mediaCounters).where(eq(mediaCounters.key, 'maintenance'));
    await sweepMedia();
    expect(
      await getDb()
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.clientUploadId, clientUploadId)),
    ).toHaveLength(1);

    await getDb()
      .update(mediaAssets)
      .set({ leaseUntil: new Date(Date.now() - 10 * 60_000) })
      .where(eq(mediaAssets.clientUploadId, clientUploadId));
    await getDb().delete(mediaCounters).where(eq(mediaCounters.key, 'maintenance'));
    await sweepMedia();
    expect(
      await getDb()
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.clientUploadId, clientUploadId)),
    ).toHaveLength(0);
    expect([...objects.keys()].some((key) => key.startsWith(`images/${stillLeased?.id}/`))).toBe(
      false,
    );
  });

  it('takes down a published asset, clears its reference, and prevents further origin reads', async () => {
    const admin = await register('takedown-admin');
    const character = await createCharacter(admin.accessToken);
    const asset = await upload(admin.accessToken, 'character', character.id, await png());
    const attach = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(admin.accessToken),
      body: JSON.stringify({ portraitAssetId: asset.id }),
    });
    expect(attach.status).toBe(200);

    const { accessToken } = admin;
    const auth = await app.request('/api/v1/auth/me', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const account = (await auth.json()) as { id: string };
    await getDb().update(users).set({ isSuperuser: true }).where(eq(users.id, account.id));
    const removed = await app.request(`/api/v1/admin/media/${asset.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(removed.status).toBe(204);
    const characterResponse = await app.request(`/api/v1/characters/${character.id}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(
      ((await characterResponse.json()) as { portraitAssetId: string | null }).portraitAssetId,
    ).toBeNull();
    expect((await app.request(asset.thumbUrl as string)).status).toBe(404);
  });

  it('cleans expired unattached objects, retains references, and retries failed deletion', async () => {
    const owner = await register('cleanup');
    const character = await createCharacter(owner.accessToken);
    const bytes = await png();
    const referenced = await upload(owner.accessToken, 'character', character.id, bytes);
    const attach = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ portraitAssetId: referenced.id }),
    });
    expect(attach.status).toBe(200);

    const expired = await upload(owner.accessToken, 'character', character.id, bytes);
    const retryable = await upload(owner.accessToken, 'character', character.id, bytes);
    const expiredPrefix = `images/${expired.id}/`;
    const retryablePrefix = `images/${retryable.id}/`;
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await getDb().update(mediaAssets).set({ createdAt: old }).where(eq(mediaAssets.id, expired.id));
    await getDb()
      .update(mediaAssets)
      .set({ state: 'deleting', createdAt: new Date() })
      .where(eq(mediaAssets.id, retryable.id));
    await getDb()
      .update(mediaAssets)
      .set({ createdAt: old })
      .where(eq(mediaAssets.id, referenced.id));
    failRemovePrefix = retryablePrefix;
    await getDb().delete(mediaCounters).where(eq(mediaCounters.key, 'maintenance'));

    await expect(sweepMedia()).rejects.toThrow('injected object deletion failure');
    expect(
      await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, expired.id)),
    ).toHaveLength(0);
    expect(
      await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, retryable.id)),
    ).toHaveLength(1);
    expect([...objects.keys()].some((key) => key.startsWith(expiredPrefix))).toBe(false);
    expect([...objects.keys()].some((key) => key.startsWith(retryablePrefix))).toBe(true);
    expect([...objects.keys()].some((key) => key.startsWith(`images/${referenced.id}/`))).toBe(
      true,
    );

    await getDb().delete(mediaCounters).where(eq(mediaCounters.key, 'maintenance'));
    await sweepMedia();
    expect(
      await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, retryable.id)),
    ).toHaveLength(0);
    expect([...objects.keys()].some((key) => key.startsWith(retryablePrefix))).toBe(false);
    expect(
      await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, referenced.id)),
    ).toHaveLength(1);
    expect([...objects.keys()].some((key) => key.startsWith(`images/${referenced.id}/`))).toBe(
      true,
    );
    await getDb().delete(mediaCounters).where(eq(mediaCounters.key, 'maintenance'));
  });
});
