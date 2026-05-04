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

async function refreshTokens(): Promise<boolean> {
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
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Default true.  Set false for /auth/login etc. */
  authenticated?: boolean;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
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
        const retry = await fetch(`${API_ROOT}${path}`, retryInit);
        return parse<T>(retry);
      }
    }
  }
  return parse<T>(res);
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
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}
