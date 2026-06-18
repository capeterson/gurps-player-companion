/**
 * Hono middleware that resolves a Bearer token to a user record.
 * On success, sets `c.var.user`.  On failure, returns 401.  Routes that
 * are public (e.g. /healthz, /auth/login) skip the middleware.
 */

import type { MiddlewareHandler } from 'hono';
import { AuthError, type AuthenticatedUser, resolveAuthHeader } from './session.ts';

export type AuthVariables = { user: AuthenticatedUser };

export const requireUser: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const auth = c.req.header('authorization');
  try {
    const user = await resolveAuthHeader(auth);
    if (!user) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('user', user);
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.code }, 401);
    }
    throw err;
  }
  await next();
};

/** Same as requireUser but rejects API-key authentication (JWT only). */
export const requireJwt: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const auth = c.req.header('authorization');
  try {
    const user = await resolveAuthHeader(auth);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    if (user.authMethod !== 'jwt') return c.json({ error: 'unauthorized' }, 401);
    c.set('user', user);
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.code }, 401);
    }
    throw err;
  }
  await next();
};

/** JWT-only and additionally requires the user not be suspended. */
export const requireActiveJwt: MiddlewareHandler<{ Variables: AuthVariables }> = async (
  c,
  next,
) => {
  const auth = c.req.header('authorization');
  try {
    const user = await resolveAuthHeader(auth);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    if (user.authMethod !== 'jwt') return c.json({ error: 'unauthorized' }, 401);
    if (user.suspendedAt) return c.json({ error: 'suspended' }, 403);
    c.set('user', user);
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.code }, 401);
    }
    throw err;
  }
  await next();
};

/** Same as requireUser but additionally requires the user not be suspended. */
export const requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }> = async (
  c,
  next,
) => {
  const auth = c.req.header('authorization');
  try {
    const user = await resolveAuthHeader(auth);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    if (user.suspendedAt) return c.json({ error: 'suspended' }, 403);
    c.set('user', user);
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.code }, 401);
    }
    throw err;
  }
  await next();
};
