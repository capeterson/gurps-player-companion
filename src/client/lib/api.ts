/**
 * Minimal typed fetch wrapper with auto refresh-on-401.
 * Replace with an OpenAPI-generated client in a follow-up.
 */

import { tokenStore } from './tokenStore.ts';

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
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const promise = (async () => {
    try {
      const tokens = tokenStore.read();
      if (!tokens) return false;
      const res = await fetch(`${API_ROOT}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!res.ok) {
        tokenStore.clear();
        return false;
      }
      const fresh = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
        accessTokenExpiresIn: number;
      };
      tokenStore.write(fresh);
      return true;
    } finally {
      refreshInFlight = null;
    }
  })();
  refreshInFlight = promise;
  return promise;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Default true.  Set false for /auth/login etc. */
  authenticated?: boolean;
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
 * them (e.g. show a download error vs. a parse error).
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
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const res = await fetch(`${API_ROOT}${path}`, init);
  if (res.status === 401 && options.authenticated !== false) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      const next = tokenStore.read();
      if (next) {
        const retryInit: RequestInit = {
          method,
          headers: { ...headers, authorization: `Bearer ${next.accessToken}` },
        };
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
