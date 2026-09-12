import { SignJWT, jwtVerify } from 'jose';
import { loadConfig } from '../config.ts';

export interface AccessTokenPayload {
  readonly sub: string;
  readonly type: 'access';
  readonly authVersion: number;
  readonly authTime: number;
}

export interface RefreshTokenPayload {
  readonly sub: string;
  readonly type: 'refresh';
  readonly jti: string;
  readonly authVersion: number;
  readonly authTime: number;
}

const ALGORITHM = 'HS256';

function secretKey(): Uint8Array {
  const { jwtSecret } = loadConfig();
  return new TextEncoder().encode(jwtSecret);
}

export async function signAccessToken(
  userId: string,
  authVersion = 0,
  authTime = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresInSeconds: number }> {
  const { jwtAccessTtlMinutes } = loadConfig();
  const expiresInSeconds = jwtAccessTtlMinutes * 60;
  const token = await new SignJWT({ type: 'access', av: authVersion, auth_time: authTime })
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
  authVersion = 0,
  authTime = Math.floor(Date.now() / 1000),
  issuedAt = Math.floor(Date.now() / 1000),
  fixedExpiresAt?: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const { jwtRefreshTtlDays } = loadConfig();
  const expiresAt =
    fixedExpiresAt ?? new Date(issuedAt * 1000 + jwtRefreshTtlDays * 24 * 60 * 60 * 1000);
  const token = await new SignJWT({ type: 'refresh', jti, av: authVersion, auth_time: authTime })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());
  return { token, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALGORITHM] });
  if (payload.type !== 'access' || typeof payload.sub !== 'string') {
    throw new Error('not an access token');
  }
  const authVersion = Number.isInteger(payload.av) ? Number(payload.av) : 0;
  const authTime = Number.isInteger(payload.auth_time)
    ? Number(payload.auth_time)
    : Number(payload.iat);
  if (!Number.isInteger(authTime)) throw new Error('access token missing authentication time');
  return { sub: payload.sub, type: 'access', authVersion, authTime };
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
  const authVersion = Number.isInteger(payload.av) ? Number(payload.av) : 0;
  const authTime = Number.isInteger(payload.auth_time)
    ? Number(payload.auth_time)
    : Number(payload.iat);
  if (!Number.isInteger(authTime)) throw new Error('refresh token missing authentication time');
  return { sub: payload.sub, type: 'refresh', jti: payload.jti, authVersion, authTime };
}
