import { randomUUID } from 'node:crypto';
import { createRoute } from '@hono/zod-openapi';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  changePasswordRequest,
  loginRequest,
  logoutRequest,
  refreshRequest,
  registerRequest,
  tokenPair,
  userOut,
} from '../../shared/schemas/auth.ts';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/jwt.ts';
import { requireUser } from '../auth/middleware.ts';
import { getDummyPasswordHash, hashPassword, verifyPassword } from '../auth/password.ts';
import { AuthError, resolveAuthHeader, verifyAndConsumeRefreshToken } from '../auth/session.ts';
import { getDb } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { refreshTokens, users } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';

const router = createOpenApiApp();

async function issueTokenPair(userId: string) {
  const access = await signAccessToken(userId);
  const jti = randomUUID();
  const refresh = await signRefreshToken(userId, jti);
  await getDb().insert(refreshTokens).values({
    userId,
    jti,
    expiresAt: refresh.expiresAt,
  });
  return {
    accessToken: access.token,
    accessTokenExpiresIn: access.expiresInSeconds,
    refreshToken: refresh.token,
  };
}

function userToOut(user: {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
  suspendedAt: Date | null;
  isSuperuser?: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
    suspendedAt: user.suspendedAt ? user.suspendedAt.toISOString() : null,
    // The `users` table column has a NOT NULL default of false, so any
    // direct DB read carries the flag.  When called from older paths
    // that don't pass it (registration response uses the user just
    // inserted), default to false.
    isSuperuser: user.isSuperuser ?? false,
  };
}

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/register',
    tags: ['auth'],
    summary: 'Create a new user account',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: registerRequest } },
      },
    },
    responses: {
      201: {
        description: 'New user created',
        content: { 'application/json': { schema: tokenPair } },
      },
      409: errorResponse('Email already in use'),
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const db = getDb();
    // Fast-path pre-check so we don't burn argon2id work on a duplicate
    // email.  The unique index on users.email is the authoritative
    // arbiter — two concurrent registers can both pass this check, so
    // we also catch the unique-violation on insert below.
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email));
    if (existing[0]) throw new HTTPException(409, { message: 'email already in use' });
    const passwordHash = await hashPassword(body.password);
    let created: { id: string } | undefined;
    try {
      const inserted = await db
        .insert(users)
        .values({
          email: body.email,
          passwordHash,
          displayName: body.displayName,
        })
        .returning({ id: users.id });
      created = inserted[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HTTPException(409, { message: 'email already in use' });
      }
      throw err;
    }
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    const tokens = await issueTokenPair(created.id);
    return c.json(tokens, 201);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/login',
    tags: ['auth'],
    summary: 'Exchange credentials for a token pair',
    request: {
      body: { required: true, content: { 'application/json': { schema: loginRequest } } },
    },
    responses: {
      200: {
        description: 'Token pair issued',
        content: { 'application/json': { schema: tokenPair } },
      },
      401: errorResponse('Invalid credentials'),
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.email, body.email));
    const user = rows[0];

    const hash = user?.passwordHash ?? (await getDummyPasswordHash());
    const ok = await verifyPassword(body.password, hash);
    if (!user || !ok) {
      throw new HTTPException(401, { message: 'invalid credentials' });
    }
    const tokens = await issueTokenPair(user.id);
    return c.json(tokens, 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/refresh',
    tags: ['auth'],
    summary: 'Rotate a refresh token for a fresh access + refresh pair',
    request: {
      body: { required: true, content: { 'application/json': { schema: refreshRequest } } },
    },
    responses: {
      200: {
        description: 'Token pair issued',
        content: { 'application/json': { schema: tokenPair } },
      },
      401: errorResponse('Invalid or expired refresh token'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    try {
      const { user } = await verifyAndConsumeRefreshToken(body.refreshToken);
      const tokens = await issueTokenPair(user.id);
      return c.json(tokens, 200);
    } catch (err) {
      if (err instanceof AuthError) {
        throw new HTTPException(401, { message: err.code });
      }
      throw err;
    }
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/logout',
    tags: ['auth'],
    summary: 'Revoke a refresh token (idempotent)',
    request: {
      body: { required: true, content: { 'application/json': { schema: logoutRequest } } },
    },
    responses: {
      204: { description: 'Refresh token revoked (or already invalid)' },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    try {
      const { jti } = await verifyRefreshToken(body.refreshToken);
      await getDb()
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.jti, jti));
    } catch {
      // ignore — logout is idempotent.
    }
    return c.body(null, 204);
  },
);

router.use('/auth/password', requireUser);
router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/password',
    tags: ['auth'],
    summary: 'Change the authenticated user password',
    security: [{ bearerAuth: [] }],
    request: {
      body: { required: true, content: { 'application/json': { schema: changePasswordRequest } } },
    },
    responses: {
      204: { description: 'Password changed' },
      401: errorResponse('Unauthorized'),
      403: errorResponse('Current password is incorrect'),
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const principal = c.get('user');
    const rows = await getDb().select().from(users).where(eq(users.id, principal.id));
    const user = rows[0];
    if (!user) throw new HTTPException(401, { message: 'unknown_user' });

    const ok = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!ok) throw new HTTPException(403, { message: 'current password is incorrect' });

    const db = getDb();
    const now = new Date();
    const passwordHash = await hashPassword(body.newPassword);

    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, user.id));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(refreshTokens.userId, user.id),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, now),
          ),
        );
    });
    return c.body(null, 204);
  },
);

router.use('/auth/me', requireUser);
router.openapi(
  createRoute({
    method: 'get',
    path: '/auth/me',
    tags: ['auth'],
    summary: 'Return the authenticated user profile',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Current user', content: { 'application/json': { schema: userOut } } },
      401: errorResponse('Unauthorized'),
    },
  }),
  async (c) => {
    const auth = c.req.header('authorization');
    const principal = await resolveAuthHeader(auth);
    if (!principal) throw new HTTPException(401, { message: 'unauthorized' });
    const rows = await getDb().select().from(users).where(eq(users.id, principal.id));
    const user = rows[0];
    if (!user) throw new HTTPException(401, { message: 'unknown_user' });
    return c.json(userToOut(user), 200);
  },
);

export const authRouter = router;
