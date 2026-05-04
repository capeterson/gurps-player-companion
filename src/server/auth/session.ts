/**
 * Session resolution: given a Bearer token (JWT or API key), look up the
 * authenticated user.  Used by the Hono auth middleware to attach
 * `c.get('user')` to every protected request.
 */

import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '../db/client.ts';
import { apiKeys, refreshTokens, users } from '../db/schema.ts';
import { hashApiKey, looksLikeApiKey } from './apiKey.ts';
import { verifyAccessToken, verifyRefreshToken } from './jwt.ts';

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly suspendedAt: Date | null;
  readonly authMethod: 'jwt' | 'api_key';
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
  let payload: { sub: string };
  try {
    payload = await verifyAccessToken(token);
  } catch (err) {
    throw new AuthError('invalid_token', `invalid access token: ${(err as Error).message}`);
  }
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, payload.sub));
  const user = rows[0];
  if (!user) throw new AuthError('unknown_user', 'user not found');
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    suspendedAt: user.suspendedAt,
    authMethod: 'jwt',
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
    apiKeyId: row.apiKey.id,
  };
}

/**
 * Look up an active refresh token by JTI.  Returns the token row or null
 * if missing / revoked / expired.
 */
export async function findActiveRefreshToken(jti: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.jti, jti),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    );
  return rows[0] ?? null;
}

export async function verifyAndConsumeRefreshToken(rawToken: string): Promise<{
  user: AuthenticatedUser;
  tokenRowId: string;
  jti: string;
}> {
  let payload: { sub: string; jti: string };
  try {
    payload = await verifyRefreshToken(rawToken);
  } catch (err) {
    throw new AuthError('invalid_token', `invalid refresh token: ${(err as Error).message}`);
  }
  const tokenRow = await findActiveRefreshToken(payload.jti);
  if (!tokenRow) throw new AuthError('expired_token', 'refresh token revoked or expired');
  const db = getDb();
  const userRows = await db.select().from(users).where(eq(users.id, payload.sub));
  const user = userRows[0];
  if (!user) throw new AuthError('unknown_user', 'user not found');

  // One-time use: revoke now so a replayed refresh fails.
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, tokenRow.id));

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      suspendedAt: user.suspendedAt,
      authMethod: 'jwt',
    },
    tokenRowId: tokenRow.id,
    jti: payload.jti,
  };
}
