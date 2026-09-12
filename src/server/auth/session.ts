/**
 * Session resolution: given a Bearer token (JWT or API key), look up the
 * authenticated user.  Used by the Hono auth middleware to attach
 * `c.get('user')` to every protected request.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.ts';
import { apiKeys, refreshTokens, users } from '../db/schema.ts';
import { hashApiKey, looksLikeApiKey } from './apiKey.ts';
import { signRefreshToken, verifyAccessToken, verifyRefreshToken } from './jwt.ts';

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly suspendedAt: Date | null;
  readonly authMethod: 'jwt' | 'api_key' | 'oauth';
  readonly authVersion: number;
  /** Unix seconds for the last primary credential ceremony; refresh does not advance it. */
  readonly authenticatedAt: number | null;
  readonly apiKeyId?: string;
}

const LAST_USED_THROTTLE_MS = 60_000; // bump lastUsedAt at most once per 60s

export class AuthError extends Error {
  constructor(
    readonly code: 'invalid_token' | 'expired_token' | 'unknown_user',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function resolveAuthHeader(
  authorization: string | undefined,
): Promise<AuthenticatedUser | null> {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match || !match[1]) return null;
  const token = match[1].trim();
  if (token.length === 0) return null;

  if (looksLikeApiKey(token)) {
    return resolveApiKeyToken(token);
  }
  return resolveJwtToken(token);
}

async function resolveJwtToken(token: string): Promise<AuthenticatedUser> {
  let payload: { sub: string; authVersion: number; authTime: number };
  try {
    payload = await verifyAccessToken(token);
  } catch (err) {
    throw new AuthError('invalid_token', `invalid access token: ${(err as Error).message}`);
  }
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, payload.sub));
  const user = rows[0];
  if (!user) throw new AuthError('unknown_user', 'user not found');
  if (payload.authVersion !== user.authVersion) {
    throw new AuthError('invalid_token', 'access token has been revoked');
  }
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    suspendedAt: user.suspendedAt,
    authMethod: 'jwt',
    authVersion: user.authVersion,
    authenticatedAt: payload.authTime,
  };
}

async function resolveApiKeyToken(token: string): Promise<AuthenticatedUser> {
  const keyHash = hashApiKey(token);
  const db = getDb();
  const rows = await db
    .select({
      apiKey: apiKeys,
      user: users,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)));
  const row = rows[0];
  if (!row) throw new AuthError('invalid_token', 'API key not recognized');

  // Throttled lastUsedAt update — fire-and-forget.
  const now = new Date();
  const last = row.apiKey.lastUsedAt;
  if (!last || now.getTime() - last.getTime() > LAST_USED_THROTTLE_MS) {
    db.update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, row.apiKey.id))
      .catch((e) => console.error('lastUsedAt update failed', e));
  }

  return {
    id: row.user.id,
    email: row.user.email,
    displayName: row.user.displayName,
    suspendedAt: row.user.suspendedAt,
    authMethod: 'api_key',
    authVersion: row.user.authVersion,
    authenticatedAt: null,
    apiKeyId: row.apiKey.id,
  };
}

const ROTATION_RETRY_WINDOW_MS = 30_000;

export interface RefreshRotation {
  user: AuthenticatedUser;
  refreshToken: string;
  refreshExpiresAt: Date;
}

type RotationTransactionResult =
  | {
      kind: 'ok';
      user: typeof users.$inferSelect;
      replacementJti: string;
      replacementIssuedAt: number;
      replacementExpiresAt: Date;
    }
  | { kind: 'invalid'; code: 'invalid_token' | 'expired_token' | 'unknown_user' }
  | { kind: 'replay' };

/**
 * Atomically consume a refresh token and insert its one live descendant.
 * A repeated request id may recover that same descendant for 30 seconds;
 * every other reuse revokes the token family as a theft/replay precaution.
 */
export async function rotateRefreshToken(
  rawToken: string,
  requestId: string,
  replacementJti: string = randomUUID(),
): Promise<RefreshRotation> {
  let payload: { sub: string; jti: string; authVersion: number; authTime: number };
  try {
    payload = await verifyRefreshToken(rawToken);
  } catch (err) {
    throw new AuthError('invalid_token', `invalid refresh token: ${(err as Error).message}`);
  }
  const db = getDb();
  const replacementIssuedAt = Math.floor(Date.now() / 1000);
  const signedReplacement = await signRefreshToken(
    payload.sub,
    replacementJti,
    payload.authVersion,
    payload.authTime,
    replacementIssuedAt,
  );

  const result: RotationTransactionResult = await db.transaction(async (tx) => {
    const [tokenRow] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.jti, payload.jti))
      .for('update');
    if (!tokenRow || tokenRow.userId !== payload.sub) {
      return { kind: 'invalid', code: 'invalid_token' };
    }

    const [user] = await tx.select().from(users).where(eq(users.id, payload.sub)).for('update');
    if (!user) return { kind: 'invalid', code: 'unknown_user' };
    if (payload.authVersion !== user.authVersion || user.suspendedAt) {
      return { kind: 'invalid', code: 'invalid_token' };
    }

    const now = new Date();
    if (tokenRow.revokedAt) {
      const withinRetryWindow =
        tokenRow.rotationRequestId === requestId &&
        tokenRow.rotatedAt !== null &&
        now.getTime() - tokenRow.rotatedAt.getTime() <= ROTATION_RETRY_WINDOW_MS;
      if (withinRetryWindow && tokenRow.replacementJti) {
        const [replacement] = await tx
          .select()
          .from(refreshTokens)
          .where(
            and(
              eq(refreshTokens.jti, tokenRow.replacementJti),
              eq(refreshTokens.familyId, tokenRow.familyId),
              isNull(refreshTokens.revokedAt),
              gt(refreshTokens.expiresAt, now),
            ),
          );
        if (replacement) {
          return {
            kind: 'ok',
            user,
            replacementJti: replacement.jti,
            replacementIssuedAt: Math.floor(replacement.createdAt.getTime() / 1000),
            replacementExpiresAt: replacement.expiresAt,
          };
        }
      }

      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.familyId, tokenRow.familyId), isNull(refreshTokens.revokedAt)));
      return { kind: 'replay' };
    }
    if (tokenRow.expiresAt <= now) {
      return { kind: 'invalid', code: 'expired_token' };
    }

    const replacementCreatedAt = new Date(replacementIssuedAt * 1000);
    await tx.insert(refreshTokens).values({
      userId: user.id,
      jti: replacementJti,
      familyId: tokenRow.familyId,
      expiresAt: signedReplacement.expiresAt,
      createdAt: replacementCreatedAt,
    });
    await tx
      .update(refreshTokens)
      .set({
        revokedAt: now,
        rotationRequestId: requestId,
        replacementJti,
        rotatedAt: now,
      })
      .where(eq(refreshTokens.id, tokenRow.id));
    return {
      kind: 'ok',
      user,
      replacementJti,
      replacementIssuedAt,
      replacementExpiresAt: signedReplacement.expiresAt,
    };
  });

  if (result.kind === 'replay') {
    throw new AuthError('invalid_token', 'refresh token replayed; session family revoked');
  }
  if (result.kind === 'invalid') {
    throw new AuthError(result.code, 'refresh token revoked or expired');
  }

  const refresh =
    result.replacementJti === replacementJti &&
    result.replacementIssuedAt === replacementIssuedAt &&
    result.replacementExpiresAt.getTime() === signedReplacement.expiresAt.getTime()
      ? signedReplacement
      : await signRefreshToken(
          result.user.id,
          result.replacementJti,
          result.user.authVersion,
          payload.authTime,
          result.replacementIssuedAt,
          result.replacementExpiresAt,
        );
  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.displayName,
      suspendedAt: result.user.suspendedAt,
      authMethod: 'jwt',
      authVersion: result.user.authVersion,
      authenticatedAt: payload.authTime,
    },
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

export const RECENT_AUTH_MAX_AGE_SECONDS = 10 * 60;

export function hasRecentAuthentication(
  user: AuthenticatedUser,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return (
    user.authMethod === 'jwt' &&
    user.authenticatedAt !== null &&
    nowSeconds - user.authenticatedAt <= RECENT_AUTH_MAX_AGE_SECONDS
  );
}
