import { z } from 'zod';
import { isoTimestamp, uuid } from './common.ts';

export const apiKeyName = z.string().min(1).max(80).trim();

export const apiKeyOut = z.object({
  id: uuid,
  name: apiKeyName,
  prefix: z.string().max(16),
  createdAt: isoTimestamp,
  lastUsedAt: isoTimestamp.nullable(),
});

export const apiKeyCreateRequest = z.object({
  name: apiKeyName,
});

export const apiKeyCreatedResponse = z.object({
  apiKey: apiKeyOut,
  /** Plaintext token, returned exactly once at creation time. Prefix `gpc_`. */
  plaintextKey: z.string().regex(/^gpc_[A-Za-z0-9_-]+$/),
});

export type ApiKeyOut = z.infer<typeof apiKeyOut>;
export type ApiKeyCreateRequest = z.infer<typeof apiKeyCreateRequest>;
export type ApiKeyCreatedResponse = z.infer<typeof apiKeyCreatedResponse>;
