import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRoute } from '@hono/zod-openapi';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  changePasswordRequest,
  forgotPasswordRequest,
  loginRequest,
  logoutRequest,
  passkeyInfo,
  passkeyLoginOptions,
  passkeyLoginOptionsRequest,
  passkeyLoginRequest,
  passkeyRegistrationOptions,
  passkeyRegistrationRequest,
  refreshRequest,
  registerRequest,
  resetPasswordRequest,
  tokenPair,
  userOut,
} from '../../shared/schemas/auth.ts';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/jwt.ts';
import { requireJwt, requireUser } from '../auth/middleware.ts';
import { getDummyPasswordHash, hashPassword, verifyPassword } from '../auth/password.ts';
import { AuthError, resolveAuthHeader, verifyAndConsumeRefreshToken } from '../auth/session.ts';
import {
  consumeChallenge,
  createChallenge,
  extractAttestation,
  parseClientData,
  verifyAssertion,
  webauthnRp,
} from '../auth/webauthn.ts';
import { loadConfig } from '../config.ts';
import { getDb } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { passkeyCredentials, passwordResetTokens, refreshTokens, users } from '../db/schema.ts';
import { getResend, sendPasswordResetEmail } from '../email.ts';
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

// requireJwt (not requireUser) prevents API keys from enrolling/managing passkeys.
// The :id constraint (UUID pattern) prevents the /:id middleware from matching the
// public /auth/passkeys/login route.
router.use('/auth/passkeys', requireJwt);
router.use('/auth/passkeys/register/*', requireJwt);
router.use('/auth/passkeys/:id{[0-9a-fA-F-]{36}}', requireJwt);
router.openapi(
  createRoute({
    method: 'get',
    path: '/auth/passkeys',
    tags: ['auth'],
    summary: 'List passkeys for the authenticated user',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Passkeys',
        content: { 'application/json': { schema: passkeyInfo.array() } },
      },
      401: errorResponse('Unauthorized'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const rows = await getDb()
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, user.id));
    return c.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      })),
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/passkeys/register/options',
    tags: ['auth'],
    summary: 'Create passkey registration options',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Registration options',
        content: { 'application/json': { schema: passkeyRegistrationOptions } },
      },
      401: errorResponse('Unauthorized'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { rpName, rpId } = webauthnRp();
    const challenge = await createChallenge(user.id, 'registration');
    const existing = await getDb()
      .select({ credentialId: passkeyCredentials.credentialId })
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, user.id));
    return c.json(
      {
        challenge,
        rp: { name: rpName, id: rpId },
        user: { id: user.id, name: user.email, displayName: user.displayName },
        pubKeyCredParams: [
          { type: 'public-key' as const, alg: -7 },
          { type: 'public-key' as const, alg: -257 },
        ],
        timeout: 300000,
        attestation: 'none' as const,
        authenticatorSelection: {
          residentKey: 'required' as const,
          userVerification: 'required' as const,
        },
        excludeCredentials: existing.map((row) => ({
          type: 'public-key' as const,
          id: row.credentialId,
        })),
      },
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/passkeys/register',
    tags: ['auth'],
    summary: 'Register a passkey for the authenticated user',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: passkeyRegistrationRequest } },
      },
    },
    responses: {
      201: {
        description: 'Passkey registered',
        content: { 'application/json': { schema: passkeyInfo } },
      },
      401: errorResponse('Unauthorized'),
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user');
    const clientData = JSON.parse(
      Buffer.from(body.response.clientDataJSON, 'base64url').toString('utf8'),
    ) as { challenge?: string };
    if (!clientData.challenge)
      throw new HTTPException(401, { message: 'invalid passkey response' });
    const challenge = await consumeChallenge(clientData.challenge, 'registration');
    if (challenge.userId !== user.id)
      throw new HTTPException(401, { message: 'invalid passkey challenge' });
    parseClientData(body.response.clientDataJSON, clientData.challenge, 'webauthn.create');
    const attestation = extractAttestation(body.response.attestationObject);
    const inserted = await getDb()
      .insert(passkeyCredentials)
      .values({
        userId: user.id,
        credentialId: attestation.credentialId,
        publicKey: attestation.publicKey,
        signCount: attestation.signCount,
        name: body.name?.trim() || 'Passkey',
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new HTTPException(500, { message: 'insert failed' });
    return c.json(
      { id: row.id, name: row.name, createdAt: row.createdAt.toISOString(), lastUsedAt: null },
      201,
    );
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/auth/passkeys/{id}',
    tags: ['auth'],
    summary: 'Delete a passkey',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 204: { description: 'Deleted' }, 401: errorResponse('Unauthorized') },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await getDb()
      .delete(passkeyCredentials)
      .where(and(eq(passkeyCredentials.id, id), eq(passkeyCredentials.userId, user.id)));
    return c.body(null, 204);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/passkeys/login/options',
    tags: ['auth'],
    summary: 'Create passkey login options',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: passkeyLoginOptionsRequest } },
      },
    },
    responses: {
      200: {
        description: 'Login options',
        content: { 'application/json': { schema: passkeyLoginOptions } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const { rpId } = webauthnRp();
    const challenge = await createChallenge(null, 'authentication');
    const rows = body.email
      ? await getDb()
          .select({ credentialId: passkeyCredentials.credentialId })
          .from(passkeyCredentials)
          .innerJoin(users, eq(passkeyCredentials.userId, users.id))
          .where(eq(users.email, body.email))
      : [];
    return c.json(
      {
        challenge,
        timeout: 300000,
        rpId,
        userVerification: 'required' as const,
        allowCredentials: rows.map((row) => ({
          type: 'public-key' as const,
          id: row.credentialId,
        })),
      },
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/passkeys/login',
    tags: ['auth'],
    summary: 'Exchange a passkey assertion for a token pair',
    request: {
      body: { required: true, content: { 'application/json': { schema: passkeyLoginRequest } } },
    },
    responses: {
      200: {
        description: 'Token pair issued',
        content: { 'application/json': { schema: tokenPair } },
      },
      401: errorResponse('Invalid passkey'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const clientData = JSON.parse(
      Buffer.from(body.response.clientDataJSON, 'base64url').toString('utf8'),
    ) as { challenge?: string };
    if (!clientData.challenge)
      throw new HTTPException(401, { message: 'invalid passkey response' });
    await consumeChallenge(clientData.challenge, 'authentication');
    const rows = await getDb()
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.credentialId, body.rawId));
    const credential = rows[0];
    if (!credential) throw new HTTPException(401, { message: 'unknown passkey' });
    const verified = await verifyAssertion({
      credentialPublicKey: credential.publicKey,
      authenticatorData: body.response.authenticatorData,
      clientDataJSON: body.response.clientDataJSON,
      signature: body.response.signature,
      challenge: clientData.challenge,
    });
    // Reject cloned credentials: a non-zero stored counter must strictly advance.
    if (credential.signCount > 0 && verified.signCount <= credential.signCount) {
      throw new HTTPException(401, { message: 'invalid passkey' });
    }
    // Advance counter conditionally so a concurrent assertion with the same counter
    // (e.g. a cloned key) fails the UPDATE rather than silently winning the race.
    const updated = await getDb()
      .update(passkeyCredentials)
      .set({
        signCount: verified.signCount,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(passkeyCredentials.id, credential.id),
          eq(passkeyCredentials.signCount, credential.signCount),
        ),
      )
      .returning({ id: passkeyCredentials.id });
    if (!updated[0]) throw new HTTPException(401, { message: 'invalid passkey' });
    const tokens = await issueTokenPair(credential.userId);
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
      await tx
        .delete(passwordResetTokens)
        .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
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

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/forgot-password',
    tags: ['auth'],
    summary: 'Request a password-reset email (always 200 to prevent enumeration)',
    request: {
      body: { required: true, content: { 'application/json': { schema: forgotPasswordRequest } } },
    },
    responses: {
      200: { description: 'Request received' },
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const config = loadConfig();
    const resend = getResend(config);

    // Only attempt to send if we have everything needed to produce a usable link.
    if (resend && config.resendFromEmail && config.appBaseUrl) {
      const db = getDb();
      const rows = await db.select().from(users).where(eq(users.email, body.email));
      const user = rows[0];
      if (user) {
        const rawToken = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        // Delete then insert atomically so no window exists where two concurrent
        // requests for the same user both succeed and produce two live tokens.
        await db.transaction(async (tx) => {
          await tx
            .delete(passwordResetTokens)
            .where(
              and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)),
            );
          await tx.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt });
        });

        const baseUrl = config.appBaseUrl.replace(/\/+$/, '');
        const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

        sendPasswordResetEmail(resend, config.resendFromEmail, {
          to: user.email,
          displayName: user.displayName,
          resetUrl,
        }).catch(() => {});
      }
    }

    return c.json({ message: 'If that email is registered, a reset link has been sent.' }, 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/reset-password',
    tags: ['auth'],
    summary: 'Reset password using a token from a reset email',
    request: {
      body: { required: true, content: { 'application/json': { schema: resetPasswordRequest } } },
    },
    responses: {
      204: { description: 'Password reset successfully' },
      400: errorResponse('Invalid or expired token'),
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const tokenHash = createHash('sha256').update(body.token).digest('hex');
    const db = getDb();
    const now = new Date();

    // Fast pre-check (no lock) to reject obviously bogus tokens before burning
    // argon2id cycles. The authoritative check is the FOR UPDATE inside the tx.
    const preCheck = await db
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      );
    if (!preCheck[0]) {
      throw new HTTPException(400, { message: 'invalid or expired reset token' });
    }

    const passwordHash = await hashPassword(body.newPassword);

    // SELECT FOR UPDATE acquires a row-level write lock so concurrent requests
    // with the same token block here rather than both passing the used_at check.
    const userId = await db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now),
          ),
        )
        .for('update');
      const token = locked[0];
      if (!token) return null;

      await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(passwordResetTokens.id, token.id));
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, token.userId));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(refreshTokens.userId, token.userId),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, now),
          ),
        );
      return token.userId;
    });

    if (!userId) {
      throw new HTTPException(400, { message: 'invalid or expired reset token' });
    }

    return c.body(null, 204);
  },
);

export const authRouter = router;
