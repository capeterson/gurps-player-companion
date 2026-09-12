/**
 * Refresh-failure handling.
 *
 * The rule under test: only a server that actually *judged* the refresh
 * token may end the session. A 5xx or a reverse-proxy/tunnel error
 * (Cloudflare 530 during an origin outage) means the server never got
 * to judge it — clearing the tokens there signs the user out silently
 * and permanently, because the local-first UI keeps rendering Dexie
 * data while every orchestrator cycle bails at its `!tokenStore.read()`
 * guard, freezing the sync badge with no toast to explain it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.ts';
import { tokenStore } from './tokenStore.ts';

function seedTokens() {
  tokenStore.write({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    accessTokenExpiresIn: 3600,
  });
}

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tokenStore.clear();
});

describe('api refresh-on-401', () => {
  it('keeps the session and reports the outage when refresh returns HTTP 530', async () => {
    seedTokens();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh'))
        return new Response('origin down', { status: 530 });
      return jsonResponse(401, { error: 'token expired' });
    });
    vi.stubGlobal('fetch', fetchMock);

    // The failure that actually blocked us is the 530, not the 401 that
    // triggered the refresh -- surfacing 401 would send the user to
    // look at their account during a total origin outage.
    await expect(api('/characters')).rejects.toMatchObject({ status: 530 });

    // And the user is still signed in, so the next attempt can succeed.
    expect(tokenStore.read()).toMatchObject({ refreshToken: 'refresh-1' });
  });

  it('gives every concurrent caller the real status, not a drained body', async () => {
    // All parallel 401s await the same refresh promise. Sharing one
    // Response would let the first parse() consume the body and leave
    // the rest throwing "body already read" -- replacing the outage
    // diagnostic with a misleading local TypeError.
    seedTokens();
    let refreshCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        refreshCalls += 1;
        return new Response(JSON.stringify({ error: 'origin unreachable' }), {
          status: 530,
          headers: { 'content-type': 'application/json' },
        });
      }
      return jsonResponse(401, { error: 'token expired' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.allSettled([
      api('/characters'),
      api('/campaigns'),
      api('/auth/me'),
    ]);

    expect(refreshCalls).toBe(1);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      const reason = (result as PromiseRejectedResult).reason;
      expect(reason).toMatchObject({ status: 530, message: 'origin unreachable' });
    }
    expect(tokenStore.read()).toMatchObject({ refreshToken: 'refresh-1' });
  });

  it('keeps the session and propagates the transport error', async () => {
    seedTokens();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) throw new TypeError('network down');
      return jsonResponse(401, { error: 'token expired' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/characters')).rejects.toThrow('network down');
    expect(tokenStore.read()).toMatchObject({ refreshToken: 'refresh-1' });
  });

  it('clears the session when the refresh token is actually rejected', async () => {
    seedTokens();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/refresh')) return jsonResponse(401, { error: 'invalid' });
      return jsonResponse(401, { error: 'token expired' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/characters')).rejects.toMatchObject({ status: 401 });
    expect(tokenStore.read()).toBeNull();
  });

  it('retries the original request with the refreshed token', async () => {
    seedTokens();
    let refreshed = false;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/refresh')) {
        refreshed = true;
        return jsonResponse(200, {
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          accessTokenExpiresIn: 3600,
        });
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (auth === 'Bearer access-2') return jsonResponse(200, { ok: true });
      return jsonResponse(401, { error: 'token expired' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/characters')).resolves.toEqual({ ok: true });
    expect(refreshed).toBe(true);
    expect(tokenStore.read()).toMatchObject({ accessToken: 'access-2' });
  });

  it('does not restore an old session when its refresh completes after account switching', async () => {
    seedTokens();
    let releaseRefresh!: (response: Response) => void;
    const heldRefresh = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/auth/refresh')) return heldRefresh;
        return jsonResponse(401, { error: 'token expired' });
      }),
    );

    const oldRequest = api('/characters');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    tokenStore.clear();
    tokenStore.write({
      accessToken: 'new-account-access',
      refreshToken: 'new-account-refresh',
      accessTokenExpiresIn: 3600,
    });
    releaseRefresh(
      jsonResponse(200, {
        accessToken: 'late-old-access',
        refreshToken: 'late-old-refresh',
        accessTokenExpiresIn: 3600,
      }),
    );

    await expect(oldRequest).rejects.toMatchObject({ status: 401 });
    expect(tokenStore.read()).toMatchObject({
      accessToken: 'new-account-access',
      refreshToken: 'new-account-refresh',
    });
  });

  it('rejects a successful response that arrives after the originating session changed', async () => {
    seedTokens();
    let release!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => held),
    );

    const oldRequest = api('/campaigns');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    tokenStore.clear();
    tokenStore.write({
      accessToken: 'new-account-access',
      refreshToken: 'new-account-refresh',
      accessTokenExpiresIn: 3600,
    });
    release(jsonResponse(200, [{ id: 'private-old-account', name: 'Must not escape' }]));

    await expect(oldRequest).rejects.toMatchObject({
      status: 401,
      message: 'session changed while request was in flight',
    });
  });

  it('coordinates rotation across isolated module contexts and reuses the winning pair', async () => {
    seedTokens();
    let lockTail = Promise.resolve();
    const locks = {
      request: vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback();
        } finally {
          release();
        }
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, locks });

    let refreshCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
        if (auth === 'Bearer access-2') return jsonResponse(200, { ok: true });
        if (!auth) {
          refreshCalls += 1;
          return jsonResponse(200, {
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            accessTokenExpiresIn: 3600,
          });
        }
        return jsonResponse(401, { error: 'token expired' });
      }),
    );

    vi.resetModules();
    const firstTab = await import('./api.ts');
    vi.resetModules();
    const secondTab = await import('./api.ts');

    await expect(
      Promise.all([firstTab.api('/characters'), secondTab.api('/campaigns')]),
    ).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
    expect(locks.request).toHaveBeenCalledTimes(2);
    expect(tokenStore.read()).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      version: 1,
    });
  });
});
