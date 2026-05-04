/**
 * API key generation and verification.
 *
 * Storage strategy:
 * - The plaintext key has the form `gpc_<base64url>` and is shown to the
 *   user exactly once at creation time.
 * - The DB stores HMAC-SHA256(plaintext, pepper) where pepper is the
 *   configured API_KEY_PEPPER (or JWT_SECRET if unset).  We never store
 *   the plaintext.
 * - On request, the bearer prefix `gpc_` identifies an API key (vs a JWT)
 *   and we look up by the same hash.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { loadConfig } from '../config.ts';

export const API_KEY_PREFIX = 'gpc_';

export function generatePlaintextKey(): string {
  // 32 bytes → 43 base64url chars; combined with prefix that's 47 chars.
  return API_KEY_PREFIX + randomBytes(32).toString('base64url');
}

export function hashApiKey(plaintext: string): string {
  const { apiKeyPepper } = loadConfig();
  return createHmac('sha256', apiKeyPepper).update(plaintext).digest('hex');
}

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}
