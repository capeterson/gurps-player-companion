/**
 * Guest preview sessions are read-only on the client too: every authenticated
 * write is refused before the network, the outbox and image helpers refuse to
 * run, and an expired guest token is replaced instead of refreshed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { enqueueImage, removeImage } from '../sync/mediaUploads.ts';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueDeletes,
  enqueueEntityPatch,
  enqueueFieldPatch,
} from '../sync/outbox.ts';
import { ApiError, api, setPwaConnectionControl } from './api.ts';
import { connectionStore } from './connectionState.ts';
import {
  GUEST_READ_ONLY_MESSAGE,
  GuestPreviewUnavailableError,
  GuestReadOnlyError,
  guestCampaignId,
  isGuestSession,
  startGuestSession,
} from './guestSession.ts';
import { tokenStore } from './tokenStore.ts';

const CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-00000000ca01';
const NEXT_CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-00000000ca02';
const CHARACTER_ID = '0193b3c0-f1f0-7000-8000-00000000c001';

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function guestTokenResponse(accessToken: string, campaignId = CAMPAIGN_ID) {
  return jsonResponse(200, { accessToken, accessTokenExpiresIn: 7200, campaignId });
}

beforeEach(() => {
  connectionStore.reset();
  setPwaConnectionControl(true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  connectionStore.reset();
  setPwaConnectionControl(false);
  tokenStore.clear();
  await resetLocalDb();
});

async function startPreview(fetchMock = vi.fn()) {
  fetchMock.mockResolvedValueOnce(guestTokenResponse('guest-1'));
  vi.stubGlobal('fetch', fetchMock);
  await startGuestSession();
  return fetchMock;
}

describe('guest session', () => {
  it('stores a guest session for the preview campaign without a refresh token', async () => {
    const fetchMock = await startPreview();

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/guest', { method: 'POST' });
    expect(isGuestSession()).toBe(true);
    expect(guestCampaignId()).toBe(CAMPAIGN_ID);
    expect(tokenStore.read()).toMatchObject({ accessToken: 'guest-1', refreshToken: '' });
  });

  it('names why the preview could not start', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429)));
    await expect(startGuestSession()).rejects.toThrow(
      'Too many previews started from this connection. Try again in a few minutes.',
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404)));
    await expect(startGuestSession()).rejects.toBeInstanceOf(GuestPreviewUnavailableError);
    expect(tokenStore.read()).toBeNull();
  });

  it('refuses authenticated writes before they reach the network', async () => {
    const fetchMock = await startPreview();
    fetchMock.mockClear();

    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const attempt = api(`/characters/${CHARACTER_ID}`, { method, body: {} });
      await expect(attempt).rejects.toMatchObject({
        status: 403,
        message: GUEST_READ_ONLY_MESSAGE,
      });
      await expect(attempt).rejects.toBeInstanceOf(ApiError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still reads and pulls the sync cursor', async () => {
    const fetchMock = await startPreview();
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true }));

    await expect(api('/campaigns')).resolves.toEqual({ ok: true });
    await expect(api('/sync/cursor', { method: 'POST', body: { cursors: [] } })).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/v1/auth/guest', 'POST'],
      ['/api/v1/campaigns', 'GET'],
      ['/api/v1/sync/cursor', 'POST'],
    ]);
  });

  it('replaces an expired guest token and retries the read', async () => {
    const fetchMock = await startPreview();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_token' }))
      .mockResolvedValueOnce(guestTokenResponse('guest-2', NEXT_CAMPAIGN_ID))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await expect(api('/campaigns')).resolves.toEqual({ ok: true });

    const [, renewal, retry] = fetchMock.mock.calls.slice(1);
    expect(renewal?.[0]).toBe('/api/v1/auth/guest');
    expect(renewal?.[1].headers).toBeUndefined();
    expect(retry?.[1].headers.authorization).toBe('Bearer guest-2');
    expect(isGuestSession()).toBe(true);
    expect(guestCampaignId()).toBe(NEXT_CAMPAIGN_ID);
  });

  it('ends the guest session when the preview is turned off', async () => {
    const fetchMock = await startPreview();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_token' }))
      .mockResolvedValueOnce(jsonResponse(404, { error: 'preview_unavailable' }));

    await expect(api('/campaigns')).rejects.toMatchObject({ status: 401 });
    expect(tokenStore.read()).toBeNull();
  });

  it('refuses local edits, creates, deletes and images without touching Dexie', async () => {
    await startPreview();
    const db = getLocalDb();
    const attempts = [
      () =>
        enqueueFieldPatch({
          entityClass: 'character',
          entityId: CHARACTER_ID,
          fieldPath: 'name',
          attemptedValue: 'Renamed',
          prevValue: 'Rowan',
        }),
      () =>
        enqueueEntityPatch({
          entityClass: 'campaign_library_trait',
          entityId: CHARACTER_ID,
          campaignId: CAMPAIGN_ID,
          attemptedValue: { name: 'Renamed' },
          prevValue: {},
        }),
      () =>
        enqueueCreate({
          entityClass: 'character',
          entityId: CHARACTER_ID,
          attemptedValue: { name: 'New' },
        }),
      () => enqueueDelete({ entityClass: 'character', entityId: CHARACTER_ID }),
      () => enqueueDeletes([{ entityClass: 'character', entityId: CHARACTER_ID }]),
      () => enqueueImage('character', CHARACTER_ID, new Blob(['x'], { type: 'image/png' })),
      () => removeImage('character', CHARACTER_ID),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(GuestReadOnlyError);
    }
    expect(await db.outbox.count()).toBe(0);
    expect(await db.characters.count()).toBe(0);
  });
});
