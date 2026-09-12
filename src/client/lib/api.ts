/**
 * Minimal typed fetch wrapper with auto refresh-on-401.
 * Replace with an OpenAPI-generated client in a follow-up.
 */

import { type TokenSnapshot, tokenStore } from './tokenStore.ts';

const API_ROOT = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Single in-flight refresh promise.  Concurrent 401s from parallel API
 * calls all await the same refresh — without this, the second caller
 * would re-send the now-consumed refresh token (the server's atomic
 * one-time-use rotation rejects it) and blow away the freshly-issued
 * tokens, logging the user out.
 */
const refreshInFlight = new Map<string, Promise<RefreshResult>>();
const REFRESH_LOCK = 'gpc-auth-refresh';

/**
 * Why a refresh didn't produce a fresh token.
 *
 * `rejected` — the server judged the refresh token and said no; the
 * session is over.
 * `unavailable` — the server never got to judge it (5xx, proxy/tunnel
 * error, transport failure). The session stands, and the caller needs
 * the underlying failure rather than the 401 that started this: the
 * whole point of the diagnostics in this change is that "HTTP 530"
 * and "HTTP 401" send the user looking in completely different places.
 */
type RefreshResult =
  | { ok: true }
  | { ok: false; kind: 'rejected' }
  | {
      ok: false;
      kind: 'unavailable';
      /**
       * The refresh response captured as plain, re-usable data.  Every
       * caller that piled onto the same `refreshInFlight` promise gets
       * this same result object, so handing them all one `Response`
       * would let the first `parse()` consume the body and leave the
       * rest throwing "body already read" — replacing the HTTP 530
       * diagnostic with a misleading local TypeError. Each caller
       * reconstructs its own Response from these instead.
       */
      failure?: { status: number; bodyText: string; contentType: string | null };
      cause?: unknown;
    };

async function refreshTokens(origin: TokenSnapshot): Promise<RefreshResult> {
  const existing = refreshInFlight.get(origin.sessionId);
  if (existing) return existing;
  const promise = (async (): Promise<RefreshResult> => {
    try {
      return await runWithRefreshLock(async () => {
        // Re-read only after taking the cross-tab lock. Another tab may
        // already have rotated this session while we were waiting.
        const current = tokenStore.read();
        if (!current || current.sessionId !== origin.sessionId) {
          return { ok: false, kind: 'rejected' };
        }
        if (current.version > origin.version) return { ok: true };
        if (current.version !== origin.version || current.refreshToken !== origin.refreshToken) {
          return { ok: false, kind: 'rejected' };
        }

        let res: Response;
        try {
          res = await fetch(`${API_ROOT}/auth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken: current.refreshToken }),
          });
        } catch (cause) {
          // Transport failure (offline, DNS, dropped connection).  The
          // refresh token is almost certainly still valid -- keep it and
          // let the caller retry.  See the comment below for why clearing
          // here is so damaging.
          return { ok: false, kind: 'unavailable', cause };
        }
        if (!res.ok) {
          // ONLY a definitive rejection invalidates the session.  A 5xx,
          // or a reverse-proxy/tunnel error (502/503/504, Cloudflare
          // 52x/530), means the server never got to judge the token --
          // clearing on those silently signs the user out for the rest of
          // the session.  Nothing prompts a re-login, because the app is
          // local-first and keeps rendering Dexie data; meanwhile every
          // orchestrator cycle bails at its `!tokenStore.read()` guard, so
          // the sync badge freezes on whatever it last showed (typically
          // 'error', from the request that triggered this refresh) with no
          // toast and no way for the user to find out why.
          if (res.status === 401 || res.status === 403) {
            tokenStore.clearIfCurrent(current);
            return { ok: false, kind: 'rejected' };
          }
          // Drain the body here, once, into plain data. Every caller
          // awaiting this same promise reconstructs its own Response
          // below rather than sharing a single consumable one.
          const bodyText = await res.text().catch(() => '');
          return {
            ok: false,
            kind: 'unavailable',
            failure: {
              status: res.status,
              bodyText,
              contentType: res.headers.get('content-type'),
            },
          };
        }
        const fresh = (await res.json()) as {
          accessToken: string;
          refreshToken: string;
          accessTokenExpiresIn: number;
        };
        return tokenStore.replaceIfCurrent(current, fresh)
          ? { ok: true }
          : { ok: false, kind: 'rejected' };
      });
    } finally {
      refreshInFlight.delete(origin.sessionId);
    }
  })();
  refreshInFlight.set(origin.sessionId, promise);
  return promise;
}

async function runWithRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks?.request) {
    return await navigator.locks.request(REFRESH_LOCK, fn);
  }
  // The per-session promise map above still coordinates callers in this
  // document. Browsers with Web Locks extend the same serialization across tabs.
  return await fn();
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Default true.  Set false for /auth/login etc. */
  authenticated?: boolean;
  /** Allows session teardown to cancel requests before they can mutate local state. */
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const res = await apiFetch(path, options);
  return parse<T>(res);
}

/**
 * Like `api()` but returns the raw `Response` instead of parsing JSON.
 * Use for non-JSON downloads (file exports, blobs) so they still get
 * the shared refresh-on-401 retry; a direct `fetch()` would 401 once
 * the access token expires.
 *
 * Non-2xx responses are NOT thrown — the caller decides how to handle
 * them (e.g. show a download error vs. a parse error).  The one
 * exception is a refresh that couldn't reach the server at all: that
 * transport error propagates, because there is no Response to hand
 * back and the original 401 would misdescribe what happened.
 */
export async function apiFetch(path: string, options: ApiOptions = {}): Promise<Response> {
  const method = options.method ?? 'GET';
  const tokens = tokenStore.read();
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.authenticated !== false && tokens) {
    headers.authorization = `Bearer ${tokens.accessToken}`;
  }
  if (options.body !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json';
  }
  const init: RequestInit = { method, headers };
  if (options.signal) init.signal = options.signal;
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const res = await fetch(`${API_ROOT}${path}`, init);
  if (res.status === 401 && options.authenticated !== false) {
    // The request may have crossed a logout/login boundary while it was in
    // flight. Never refresh or retry an old account's request as the new one.
    if (!tokens || !tokenStore.isCurrent(tokens)) return res;
    const refreshed = await refreshTokens(tokens);
    if (!refreshed.ok && refreshed.kind === 'unavailable') {
      // Report the failure that actually blocked us. Returning the
      // original 401 would have the caller record "HTTP 401 — token
      // expired" during a total origin outage, sending the user to look
      // at their account instead of at the server.
      // A fresh Response per caller: concurrent 401s all await the one
      // refresh promise, so sharing a single Response would let the
      // first parse() drain the body and leave the rest throwing
      // "body already read" instead of the real status.
      if (refreshed.failure) {
        const { status, bodyText, contentType } = refreshed.failure;
        return new Response(bodyText, {
          status,
          headers: contentType ? { 'content-type': contentType } : {},
        });
      }
      throw refreshed.cause instanceof Error
        ? refreshed.cause
        : new Error('Token refresh could not reach the server');
    }
    if (refreshed.ok) {
      const next = tokenStore.read();
      if (next?.sessionId === tokens.sessionId) {
        const retryInit: RequestInit = {
          method,
          headers: { ...headers, authorization: `Bearer ${next.accessToken}` },
        };
        if (options.signal) retryInit.signal = options.signal;
        if (options.body !== undefined) retryInit.body = JSON.stringify(options.body);
        return await fetch(`${API_ROOT}${path}`, retryInit);
      }
    }
  }
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    // Suspended-account responses redirect the SPA to a dedicated dead-end
    // page so the user sees a friendly message instead of every query in
    // the app silently throwing 403s. Skipping when already there avoids a
    // redirect loop.
    if (res.status === 403 && message === 'suspended' && typeof window !== 'undefined') {
      if (!window.location.pathname.startsWith('/suspended')) {
        window.location.assign('/suspended?reason=disabled');
      }
    }
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}
