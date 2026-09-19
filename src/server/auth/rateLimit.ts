import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppConfig } from '../config.ts';
import { getDb } from '../db/client.ts';

export type AuthRateLimitScope = 'login' | 'register' | 'reset' | 'challenge' | 'oauth';

const limitFor = (config: AppConfig, scope: AuthRateLimitScope) => {
  switch (scope) {
    case 'login':
      return config.authRateLimitLoginMax;
    case 'register':
      return config.authRateLimitRegisterMax;
    case 'reset':
      return config.authRateLimitResetMax;
    case 'challenge':
      return config.authRateLimitChallengeMax;
    case 'oauth':
      return config.authRateLimitChallengeMax;
  }
};

export function normalizeRateLimitAccount(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase('en-US');
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function requestSource(c: Context, config: AppConfig): string {
  // Only honor forwarding headers when the deployment's proxy is explicitly trusted.
  // Otherwise a client could cycle X-Forwarded-For values to evade the source bucket.
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  // Bun passes its server as the fetch binding; Vite supplies the original
  // IncomingMessage. Neither value is controlled by HTTP request headers.
  const env = c.env as
    | {
        requestIP?: (request: Request) => { address: string } | null;
        server?: { requestIP: (request: Request) => { address: string } | null };
        incoming?: { socket?: { remoteAddress?: string } };
      }
    | undefined;
  const server = env?.server ?? env;
  return (
    server?.requestIP?.(c.req.raw)?.address ?? env?.incoming?.socket?.remoteAddress ?? 'unknown'
  );
}

async function consume(scope: AuthRateLimitScope, key: string, config: AppConfig): Promise<number> {
  const max = limitFor(config, scope);
  const seconds = config.authRateLimitWindowSeconds;
  const db = getDb();
  await db.execute(sql`delete from auth_rate_limits where expires_at <= now()`);
  const result = await db.execute<{ attempts: number; expires_at: string | Date }>(sql`
    insert into auth_rate_limits (scope, key, window_started_at, attempts, expires_at)
    values (${scope}, ${key}, now(), 1, now() + (${seconds} * interval '1 second'))
    on conflict (scope, key) do update set
      window_started_at = case
        when auth_rate_limits.expires_at <= now() then now()
        else auth_rate_limits.window_started_at end,
      attempts = case when auth_rate_limits.expires_at <= now() then 1 else auth_rate_limits.attempts + 1 end,
      expires_at = case
        when auth_rate_limits.expires_at <= now() then now() + (${seconds} * interval '1 second')
        else auth_rate_limits.expires_at end
    returning attempts, expires_at
  `);
  const row = result.rows[0];
  if (!row) throw new Error('rate limit counter did not return a row');
  if (row.attempts <= max) return 0;
  return Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000));
}

/**
 * Consume both source and account dimensions before an expensive public-auth
 * operation. Keys are hashed so the limiter never stores raw emails or IPs.
 */
export async function enforceAuthRateLimit(
  c: Context,
  config: AppConfig,
  scope: AuthRateLimitScope,
  account?: string,
): Promise<void> {
  const source = requestSource(c, config);
  const sourceRetryAfter = await consume(scope, `source:${digest(source)}`, config);
  // A blocked source must not allocate arbitrary new account rows or exhaust
  // another account's budget. Only admitted sources consume that dimension.
  if (sourceRetryAfter > 0) reject(c, sourceRetryAfter);
  const accountRetryAfter = account
    ? await consume(scope, `account:${digest(normalizeRateLimitAccount(account))}`, config)
    : 0;
  if (accountRetryAfter > 0) reject(c, accountRetryAfter);
}

function reject(c: Context, retryAfter: number): never {
  c.header('Retry-After', String(retryAfter));
  throw new HTTPException(429, {
    message: 'too many requests; please try again later',
  });
}
