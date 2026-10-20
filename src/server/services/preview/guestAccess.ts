/**
 * Guest preview access is an allow-list. Any request presenting a guest token
 * (as a bearer header or the WebSocket `token` query parameter) reaches only
 * the exact read operations below; every other route, including routes added
 * later, answers 403 `guest_read_only` before its own middleware runs.
 *
 * Adding an entry is a security decision: it must be a read that cannot change
 * server state. `guestAccess.test.ts` sends a guest token to every OpenAPI
 * operation and fails when an entry is stale or a non-read slips in.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { MiddlewareHandler } from 'hono';
import { claimsGuestToken } from '../../auth/jwt.ts';

export interface GuestOperation {
  readonly method: 'GET' | 'POST';
  readonly path: string;
}

/** OpenAPI path templates. `POST /sync/cursor` is a read that sends its cursors as a body. */
export const GUEST_ALLOWED_OPERATIONS: readonly GuestOperation[] = [
  { method: 'GET', path: '/api/v1/healthz' },
  { method: 'GET', path: '/api/v1/readyz' },
  { method: 'GET', path: '/api/v1/auth/me' },
  { method: 'GET', path: '/api/v1/auth/guest' },
  { method: 'GET', path: '/api/v1/campaigns' },
  { method: 'GET', path: '/api/v1/campaigns/{id}' },
  { method: 'GET', path: '/api/v1/campaigns/{id}/history' },
  { method: 'GET', path: '/api/v1/campaigns/{id}/log' },
  { method: 'GET', path: '/api/v1/campaigns/{id}/library' },
  { method: 'GET', path: '/api/v1/campaigns/{id}/library/export' },
  { method: 'GET', path: '/api/v1/campaigns/{id}/library/skills/{skillId}' },
  { method: 'GET', path: '/api/v1/campaigns/{id}/encounters' },
  { method: 'GET', path: '/api/v1/campaigns/{id}/encounters/{encounterId}' },
  { method: 'GET', path: '/api/v1/characters' },
  { method: 'GET', path: '/api/v1/characters/{id}' },
  { method: 'GET', path: '/api/v1/characters/{id}/history' },
  { method: 'GET', path: '/api/v1/characters/{id}/inventory/{itemId}' },
  { method: 'GET', path: '/api/v1/characters/{id}/loadouts' },
  { method: 'GET', path: '/api/v1/invitations' },
  { method: 'GET', path: '/api/v1/notifications' },
  { method: 'GET', path: '/api/v1/media/capabilities' },
  { method: 'POST', path: '/api/v1/sync/cursor' },
];

const matchers = GUEST_ALLOWED_OPERATIONS.map((operation) => ({
  method: operation.method,
  pattern: new RegExp(
    `^${operation.path
      .split(/\{[^}]+\}/)
      .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
      .join('[^/]+')}/?$`,
  ),
}));

export function isGuestOperationAllowed(method: string, path: string): boolean {
  return matchers.some((entry) => entry.method === method && entry.pattern.test(path));
}

const guestRequests = new AsyncLocalStorage<true>();

/** True while handling a request that presented a guest token. */
export function isGuestRequest(): boolean {
  return guestRequests.getStore() === true;
}

export class GuestWriteForbiddenError extends Error {
  constructor() {
    super('guest_read_only');
    this.name = 'GuestWriteForbiddenError';
  }
}

function presentedTokens(authorization: string | undefined, url: string): string[] {
  const tokens: string[] = [];
  const bearer = authorization && /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (bearer) tokens.push(bearer);
  const queryToken = new URL(url).searchParams.get('token');
  if (queryToken) tokens.push(queryToken);
  return tokens;
}

/** Mounted first on every path so no router, middleware, or transport sees a guest write. */
export const guestGate: MiddlewareHandler = async (c, next) => {
  const guest = presentedTokens(c.req.header('authorization'), c.req.url).some(claimsGuestToken);
  if (!guest) {
    await next();
    return;
  }
  if (!isGuestOperationAllowed(c.req.method, c.req.path)) {
    return c.json({ error: 'guest_read_only' }, 403);
  }
  await guestRequests.run(true, () => next());
};
