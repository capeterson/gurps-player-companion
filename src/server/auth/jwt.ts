import { SignJWT, jwtVerify } from 'jose';
import { loadConfig } from '../config.ts';

export interface AccessTokenPayload {
  readonly sub: string;
  readonly type: 'access';
}

export interface RefreshTokenPayload {
  readonly sub: string;
  readonly type: 'refresh';
  readonly jti: string;
}

const ALGORITHM = 'HS256';

function secretKey(): Uint8Array {
  const { jwtSecret } = loadConfig();
  return new TextEncoder().encode(jwtSecret);
}

export async function signAccessToken(
  userId: string,
): Promise<{ token: string; expiresInSeconds: number }> {
  const { jwtAccessTtlMinutes } = loadConfig();
  const expiresInSeconds = jwtAccessTtlMinutes * 60;
  const token = await new SignJWT({ type: 'access' })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${jwtAccessTtlMinutes}m`)
    .sign(secretKey());
  return { token, expiresInSeconds };
}

export async function signRefreshToken(
  userId: string,
  jti: string,
): Promise<{ token: string; expiresAt: Date }> {
  const { jwtRefreshTtlDays } = loadConfig();
  const expiresAt = new Date(Date.now() + jwtRefreshTtlDays * 24 * 60 * 60 * 1000);
  const token = await new SignJWT({ type: 'refresh', jti })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${jwtRefreshTtlDays}d`)
    .sign(secretKey());
  return { token, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALGORITHM] });
  if (payload.type !== 'access' || typeof payload.sub !== 'string') {
    throw new Error('not an access token');
  }
  return { sub: payload.sub, type: 'access' };
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALGORITHM] });
  if (
    payload.type !== 'refresh' ||
    typeof payload.sub !== 'string' ||
    typeof payload.jti !== 'string'
  ) {
    throw new Error('not a refresh token');
  }
  return { sub: payload.sub, type: 'refresh', jti: payload.jti };
}
