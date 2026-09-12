import { z } from 'zod';

export const oauthScope = z.enum(['gpc:read', 'gpc:write', 'gpc:manage']);
export type OAuthScope = z.infer<typeof oauthScope>;

export const oauthClientConfig = z.object({
  clientId: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  redirectUris: z.array(z.string().url()).min(1).max(20),
  scopes: z.array(oauthScope).min(1).max(3),
});
export type OAuthClientConfig = z.infer<typeof oauthClientConfig>;

export const oauthClientConfigList = z.array(oauthClientConfig).max(100);

export const oauthAuthorizationQuery = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1).max(200),
  redirect_uri: z.string().url().max(2048),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal('S256'),
  scope: z.string().min(1).max(200),
  state: z.string().min(1).max(1024),
  resource: z.string().url().max(2048),
});
export type OAuthAuthorizationQuery = z.infer<typeof oauthAuthorizationQuery>;

export const oauthAuthorizationDetails = z.object({
  clientName: z.string(),
  scopes: z.array(oauthScope),
  scopeDescriptions: z.record(oauthScope, z.string()),
  csrfToken: z.string(),
  state: z.string(),
});

export const oauthAuthorizationDecision = oauthAuthorizationQuery.extend({
  csrf_token: z.string().min(32).max(512),
  decision: z.enum(['approve', 'deny']),
});

export const oauthTokenResponse = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  refresh_token: z.string(),
  scope: z.string(),
});

export const oauthGrantOut = z.object({
  id: z.string().uuid(),
  clientId: z.string(),
  clientName: z.string(),
  scopes: z.array(oauthScope),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
});
export type OAuthGrantOut = z.infer<typeof oauthGrantOut>;

export const oauthError = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

export const oauthProtectedResourceMetadata = z.object({
  resource: z.string().url(),
  authorization_servers: z.array(z.string().url()),
  scopes_supported: z.array(oauthScope),
  bearer_methods_supported: z.array(z.literal('header')),
});

export const oauthAuthorizationServerMetadata = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  revocation_endpoint: z.string().url(),
  response_types_supported: z.array(z.literal('code')),
  grant_types_supported: z.array(z.enum(['authorization_code', 'refresh_token'])),
  code_challenge_methods_supported: z.array(z.literal('S256')),
  scopes_supported: z.array(oauthScope),
  token_endpoint_auth_methods_supported: z.array(z.literal('none')),
});

export const SCOPE_DESCRIPTIONS: Record<OAuthScope, string> = {
  'gpc:read': 'Read your characters, campaigns, shared content, encounters, and history.',
  'gpc:write': 'Create and update ordinary player and campaign content.',
  'gpc:manage': 'Delete content and manage invitations, memberships, and ownership.',
};

export function parseOAuthScopes(value: string): OAuthScope[] {
  const values = [...new Set(value.split(/\s+/).filter(Boolean))];
  return z.array(oauthScope).min(1).parse(values);
}
