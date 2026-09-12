import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, lt, notExists, notInArray } from 'drizzle-orm';
import {
  type OAuthAuthorizationQuery,
  type OAuthDynamicClientRegistration,
  type OAuthScope,
  oauthScope,
  parseOAuthScopes,
} from '../../shared/schemas/oauth.ts';
import type { AuthenticatedUser } from '../auth/session.ts';
import type { AppConfig } from '../config.ts';
import { getDb } from '../db/client.ts';
import {
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthAuthorizationRequests,
  oauthClients,
  oauthGrants,
  oauthRefreshTokens,
  users,
} from '../db/schema.ts';
import {
  ClientRegistrationError,
  fetchClientMetadataDocument,
  isSafeOAuthRedirectUri,
  oauthRedirectUriMatches,
} from './clientRegistration.ts';

const ACCESS_TTL_MS = 15 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
const CSRF_TTL_MS = 10 * 60_000;
const ROTATION_RETRY_MS = 30_000;
const UNUSED_DYNAMIC_CLIENT_TTL_MS = 24 * 60 * 60_000;
const ALL_SCOPES: OAuthScope[] = ['gpc:read', 'gpc:write', 'gpc:manage'];
let lastCleanupAt = 0;

export class OAuthError extends Error {
  constructor(
    readonly code:
      | 'invalid_request'
      | 'invalid_client'
      | 'invalid_grant'
      | 'invalid_scope'
      | 'unsupported_grant_type'
      | 'access_denied'
      | 'invalid_token',
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function opaque(prefix: string): string {
  return `${prefix}${base64url(randomBytes(32))}`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableAuthorizationRequest(query: OAuthAuthorizationQuery): string {
  return hash(
    JSON.stringify([
      query.response_type,
      query.client_id,
      query.redirect_uri,
      query.code_challenge,
      query.code_challenge_method,
      query.scope,
      query.state,
      query.resource,
    ]),
  );
}

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function publicOrigin(config: AppConfig): string {
  const value = config.appBaseUrl ?? `http://localhost:${config.port}`;
  return value.replace(/\/$/, '');
}

export function mcpResource(config: AppConfig): string {
  return `${publicOrigin(config)}/mcp`;
}

export async function syncConfiguredOAuthClients(config: AppConfig): Promise<void> {
  const db = getDb();
  const now = Date.now();
  if (now - lastCleanupAt >= 60_000) {
    lastCleanupAt = now;
    const cutoff = new Date(now);
    await db
      .delete(oauthAuthorizationRequests)
      .where(lt(oauthAuthorizationRequests.expiresAt, cutoff));
    await db.delete(oauthAuthorizationCodes).where(lt(oauthAuthorizationCodes.expiresAt, cutoff));
    await db.delete(oauthAccessTokens).where(lt(oauthAccessTokens.expiresAt, cutoff));
    await db.delete(oauthRefreshTokens).where(lt(oauthRefreshTokens.expiresAt, cutoff));
    await db
      .delete(oauthClients)
      .where(
        and(
          eq(oauthClients.registrationMethod, 'dynamic'),
          lt(oauthClients.createdAt, new Date(now - UNUSED_DYNAMIC_CLIENT_TTL_MS)),
          notExists(
            db
              .select({ id: oauthGrants.id })
              .from(oauthGrants)
              .where(eq(oauthGrants.clientId, oauthClients.id)),
          ),
        ),
      );
  }
  const configuredIds = config.oauthClients.map((client) => client.clientId);
  if (configuredIds.length === 0) {
    await db
      .update(oauthClients)
      .set({ disabledAt: new Date() })
      .where(
        and(eq(oauthClients.registrationMethod, 'configured'), isNull(oauthClients.disabledAt)),
      );
  } else {
    await db
      .update(oauthClients)
      .set({ disabledAt: new Date() })
      .where(
        and(
          eq(oauthClients.registrationMethod, 'configured'),
          isNull(oauthClients.disabledAt),
          notInArray(oauthClients.clientId, configuredIds),
        ),
      );
  }
  for (const client of config.oauthClients) {
    await db
      .insert(oauthClients)
      .values({
        clientId: client.clientId,
        name: client.name,
        redirectUris: client.redirectUris,
        allowedScopes: client.scopes,
        registrationMethod: 'configured',
        metadataExpiresAt: null,
      })
      .onConflictDoUpdate({
        target: oauthClients.clientId,
        set: {
          name: client.name,
          redirectUris: client.redirectUris,
          allowedScopes: client.scopes,
          registrationMethod: 'configured',
          metadataExpiresAt: null,
          disabledAt: null,
          updatedAt: new Date(),
        },
      });
  }
}

export async function registerDynamicOAuthClient(input: OAuthDynamicClientRegistration) {
  if (input.redirect_uris.some((redirect) => !isSafeOAuthRedirectUri(redirect))) {
    throw new ClientRegistrationError(
      'invalid_redirect_uri',
      'redirect_uris must use HTTPS or loopback HTTP and cannot contain credentials or fragments',
    );
  }
  const grantTypes = input.grant_types ?? ['authorization_code', 'refresh_token'];
  if (!grantTypes.includes('authorization_code')) {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'grant_types must include authorization_code',
    );
  }
  let scopes: OAuthScope[];
  try {
    scopes = input.scope ? parseOAuthScopes(input.scope) : ALL_SCOPES;
  } catch {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'scope must contain only supported OAuth scopes',
    );
  }
  const clientId = opaque('gpcdcr_');
  const now = new Date();
  await getDb()
    .insert(oauthClients)
    .values({
      clientId,
      name: input.client_name ?? 'MCP client',
      redirectUris: [...new Set(input.redirect_uris)],
      allowedScopes: scopes,
      registrationMethod: 'dynamic',
    });
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: input.client_name ?? 'MCP client',
    redirect_uris: [...new Set(input.redirect_uris)],
    token_endpoint_auth_method: 'none' as const,
    grant_types: grantTypes,
    response_types: input.response_types ?? ['code'],
    scope: scopes.join(' '),
  };
}

async function resolveOAuthClient(config: AppConfig, clientId: string) {
  await syncConfiguredOAuthClients(config);
  const [existing] = await getDb()
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId));
  if (
    existing &&
    !existing.disabledAt &&
    (existing.registrationMethod !== 'cimd' ||
      (existing.metadataExpiresAt && existing.metadataExpiresAt > new Date()))
  ) {
    return existing;
  }
  if (!clientId.startsWith('https://')) {
    throw new OAuthError('invalid_client', 'client is not registered');
  }
  let resolved: Awaited<ReturnType<typeof fetchClientMetadataDocument>>;
  try {
    resolved = await fetchClientMetadataDocument(clientId);
  } catch (error) {
    if (error instanceof ClientRegistrationError) {
      throw new OAuthError('invalid_client', error.message);
    }
    throw error;
  }
  const [client] = await getDb()
    .insert(oauthClients)
    .values({
      clientId,
      name: resolved.metadata.client_name ?? new URL(clientId).hostname,
      redirectUris: resolved.metadata.redirect_uris,
      allowedScopes: ALL_SCOPES,
      registrationMethod: 'cimd',
      metadataExpiresAt: resolved.expiresAt,
    })
    .onConflictDoUpdate({
      target: oauthClients.clientId,
      set: {
        name: resolved.metadata.client_name ?? new URL(clientId).hostname,
        redirectUris: resolved.metadata.redirect_uris,
        allowedScopes: ALL_SCOPES,
        registrationMethod: 'cimd',
        metadataExpiresAt: resolved.expiresAt,
        disabledAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!client) throw new OAuthError('invalid_client', 'client registration failed');
  return client;
}

async function validatedClientAndScopes(config: AppConfig, query: OAuthAuthorizationQuery) {
  if (query.resource !== mcpResource(config)) {
    throw new OAuthError('invalid_request', 'resource must be the canonical MCP resource');
  }
  const client = await resolveOAuthClient(config, query.client_id);
  if (client.disabledAt) throw new OAuthError('invalid_client', 'client is not registered');
  if (
    !client.redirectUris.some((redirect) => oauthRedirectUriMatches(redirect, query.redirect_uri))
  ) {
    throw new OAuthError('invalid_request', 'redirect_uri is not registered');
  }
  let scopes: OAuthScope[];
  try {
    scopes = parseOAuthScopes(query.scope);
  } catch {
    throw new OAuthError('invalid_scope', 'scope must contain supported OAuth scopes');
  }
  if (scopes.some((scope) => !client.allowedScopes.includes(scope))) {
    throw new OAuthError('invalid_scope', 'client is not allowed to request one or more scopes');
  }
  return { client, scopes };
}

export async function beginAuthorization(
  config: AppConfig,
  user: AuthenticatedUser,
  query: OAuthAuthorizationQuery,
) {
  const { client, scopes } = await validatedClientAndScopes(config, query);
  const csrfToken = opaque('gpccsrf_');
  await getDb()
    .insert(oauthAuthorizationRequests)
    .values({
      userId: user.id,
      clientId: client.id,
      csrfHash: hash(csrfToken),
      requestHash: stableAuthorizationRequest(query),
      expiresAt: new Date(Date.now() + CSRF_TTL_MS),
    });
  return { client, scopes, csrfToken };
}

export async function finishAuthorization(
  config: AppConfig,
  user: AuthenticatedUser,
  query: OAuthAuthorizationQuery,
  csrfToken: string,
  approved: boolean,
): Promise<string> {
  const { client, scopes } = await validatedClientAndScopes(config, query);
  const db = getDb();
  const now = new Date();
  const csrfHash = hash(csrfToken);
  const redirect = new URL(query.redirect_uri);
  redirect.searchParams.set('state', query.state);

  const result = await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(oauthAuthorizationRequests)
      .where(eq(oauthAuthorizationRequests.csrfHash, csrfHash))
      .for('update');
    if (
      !request ||
      request.userId !== user.id ||
      request.clientId !== client.id ||
      request.usedAt ||
      request.expiresAt <= now ||
      !equalText(request.requestHash, stableAuthorizationRequest(query))
    ) {
      throw new OAuthError('invalid_request', 'authorization request expired or already used');
    }
    await tx
      .update(oauthAuthorizationRequests)
      .set({ usedAt: now })
      .where(eq(oauthAuthorizationRequests.id, request.id));
    if (!approved) return null;

    const [grant] = await tx
      .insert(oauthGrants)
      .values({
        userId: user.id,
        clientId: client.id,
        scopes,
        resource: query.resource,
        authVersion: user.authVersion,
      })
      .returning({ id: oauthGrants.id });
    if (!grant) throw new OAuthError('invalid_request', 'grant creation failed');
    const grantId = grant.id;
    const code = opaque('gpcc_');
    await tx.insert(oauthAuthorizationCodes).values({
      grantId,
      codeHash: hash(code),
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
      scopes,
      resource: query.resource,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    return code;
  });

  if (!result) redirect.searchParams.set('error', 'access_denied');
  else redirect.searchParams.set('code', result);
  return redirect.toString();
}

function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

interface IssuedPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function persistPair(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  grantId: string,
  scopes: string[],
  accessToken: string,
  refreshToken: string,
  familyId?: string,
): Promise<IssuedPair> {
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await tx.insert(oauthAccessTokens).values({
    grantId,
    tokenHash: hash(accessToken),
    scopes,
    expiresAt: accessExpiresAt,
  });
  await tx.insert(oauthRefreshTokens).values({
    grantId,
    tokenHash: hash(refreshToken),
    expiresAt: refreshExpiresAt,
    ...(familyId ? { familyId } : {}),
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  };
}

export async function exchangeAuthorizationCode(
  config: AppConfig,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource: string;
  },
): Promise<IssuedPair> {
  await syncConfiguredOAuthClients(config);
  const db = getDb();
  const now = new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        code: oauthAuthorizationCodes,
        grant: oauthGrants,
        client: oauthClients,
        user: users,
      })
      .from(oauthAuthorizationCodes)
      .innerJoin(oauthGrants, eq(oauthAuthorizationCodes.grantId, oauthGrants.id))
      .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
      .innerJoin(users, eq(oauthGrants.userId, users.id))
      .where(eq(oauthAuthorizationCodes.codeHash, hash(input.code)))
      .for('update');
    if (
      !row ||
      row.code.usedAt ||
      row.code.expiresAt <= now ||
      row.grant.revokedAt ||
      row.client.disabledAt ||
      row.user.suspendedAt ||
      row.user.authVersion !== row.grant.authVersion ||
      row.client.clientId !== input.clientId ||
      row.code.scopes.some((scope) => !row.client.allowedScopes.includes(scope)) ||
      row.code.redirectUri !== input.redirectUri ||
      row.code.resource !== input.resource ||
      !equalText(row.code.codeChallenge, pkceChallenge(input.codeVerifier))
    ) {
      throw new OAuthError('invalid_grant', 'authorization code is invalid');
    }
    await tx
      .update(oauthAuthorizationCodes)
      .set({ usedAt: now })
      .where(eq(oauthAuthorizationCodes.id, row.code.id));
    return persistPair(tx, row.grant.id, row.code.scopes, opaque('gpco_'), opaque('gpcr_'));
  });
}

function deterministicToken(config: AppConfig, prefix: string, value: string): string {
  return `${prefix}${createHmac('sha256', config.apiKeyPepper).update(value).digest('base64url')}`;
}

export async function rotateOAuthRefreshToken(
  config: AppConfig,
  rawToken: string,
  clientId: string,
  resource: string,
  requestId: string,
): Promise<IssuedPair> {
  await syncConfiguredOAuthClients(config);
  const db = getDb();
  const now = new Date();
  const rawHash = hash(rawToken);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        refresh: oauthRefreshTokens,
        grant: oauthGrants,
        client: oauthClients,
        user: users,
      })
      .from(oauthRefreshTokens)
      .innerJoin(oauthGrants, eq(oauthRefreshTokens.grantId, oauthGrants.id))
      .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
      .innerJoin(users, eq(oauthGrants.userId, users.id))
      .where(eq(oauthRefreshTokens.tokenHash, rawHash))
      .for('update');
    if (
      !row ||
      row.refresh.revokedAt ||
      row.refresh.expiresAt <= now ||
      row.grant.revokedAt ||
      row.client.disabledAt ||
      row.user.suspendedAt ||
      row.user.authVersion !== row.grant.authVersion ||
      row.client.clientId !== clientId ||
      row.grant.scopes.some((scope) => !row.client.allowedScopes.includes(scope)) ||
      row.grant.resource !== resource
    ) {
      throw new OAuthError('invalid_grant', 'refresh token is invalid');
    }
    const accessToken = deterministicToken(config, 'gpco_', `${rawHash}:${requestId}:access`);
    const refreshToken = deterministicToken(config, 'gpcr_', `${rawHash}:${requestId}:refresh`);
    if (row.refresh.consumedAt) {
      const retry =
        row.refresh.rotationRequestId === requestId &&
        now.getTime() - row.refresh.consumedAt.getTime() <= ROTATION_RETRY_MS &&
        row.refresh.replacementTokenHash === hash(refreshToken);
      if (retry) {
        const [replacement] = await tx
          .select()
          .from(oauthRefreshTokens)
          .where(
            and(
              eq(oauthRefreshTokens.tokenHash, hash(refreshToken)),
              isNull(oauthRefreshTokens.revokedAt),
              isNull(oauthRefreshTokens.consumedAt),
              gt(oauthRefreshTokens.expiresAt, now),
            ),
          );
        const [replacementAccess] = await tx
          .select()
          .from(oauthAccessTokens)
          .where(
            and(
              eq(oauthAccessTokens.tokenHash, hash(accessToken)),
              isNull(oauthAccessTokens.revokedAt),
              gt(oauthAccessTokens.expiresAt, now),
            ),
          );
        if (replacement && replacementAccess) {
          return {
            kind: 'ok' as const,
            pair: {
              access_token: accessToken,
              token_type: 'Bearer' as const,
              expires_in: Math.max(
                0,
                Math.floor((replacementAccess.expiresAt.getTime() - now.getTime()) / 1000),
              ),
              refresh_token: refreshToken,
              scope: row.grant.scopes.join(' '),
            },
          };
        }
      }
      await tx
        .update(oauthRefreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(oauthRefreshTokens.familyId, row.refresh.familyId),
            isNull(oauthRefreshTokens.revokedAt),
          ),
        );
      await tx
        .update(oauthAccessTokens)
        .set({ revokedAt: now })
        .where(eq(oauthAccessTokens.grantId, row.grant.id));
      return { kind: 'replay' as const };
    }
    await tx
      .update(oauthRefreshTokens)
      .set({
        consumedAt: now,
        rotationRequestId: requestId,
        replacementTokenHash: hash(refreshToken),
      })
      .where(eq(oauthRefreshTokens.id, row.refresh.id));
    return {
      kind: 'ok' as const,
      pair: await persistPair(
        tx,
        row.grant.id,
        row.grant.scopes,
        accessToken,
        refreshToken,
        row.refresh.familyId,
      ),
    };
  });
  if (result.kind === 'replay')
    throw new OAuthError('invalid_grant', 'refresh token replay revoked the token family');
  return result.pair;
}

export interface OAuthPrincipal {
  user: AuthenticatedUser;
  grantId: string;
  clientDbId: string;
  clientId: string;
  scopes: OAuthScope[];
  expiresAt: Date;
  resource: string;
}

export async function resolveOAuthAccessToken(
  config: AppConfig,
  rawToken: string,
  expectedResource: string,
): Promise<OAuthPrincipal> {
  if (!rawToken.startsWith('gpco_'))
    throw new OAuthError('invalid_token', 'not an OAuth access token');
  await syncConfiguredOAuthClients(config);
  const now = new Date();
  const [row] = await getDb()
    .select({ access: oauthAccessTokens, grant: oauthGrants, client: oauthClients, user: users })
    .from(oauthAccessTokens)
    .innerJoin(oauthGrants, eq(oauthAccessTokens.grantId, oauthGrants.id))
    .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
    .innerJoin(users, eq(oauthGrants.userId, users.id))
    .where(
      and(
        eq(oauthAccessTokens.tokenHash, hash(rawToken)),
        isNull(oauthAccessTokens.revokedAt),
        gt(oauthAccessTokens.expiresAt, now),
      ),
    );
  if (
    !row ||
    row.grant.revokedAt ||
    row.client.disabledAt ||
    row.user.suspendedAt ||
    row.user.authVersion !== row.grant.authVersion ||
    row.access.scopes.some((scope) => !row.client.allowedScopes.includes(scope)) ||
    row.grant.resource !== expectedResource
  ) {
    throw new OAuthError('invalid_token', 'access token is expired or revoked');
  }
  const scopes = row.access.scopes.map((scope) => oauthScope.parse(scope));
  const used = new Date();
  await getDb()
    .update(oauthGrants)
    .set({ lastUsedAt: used })
    .where(eq(oauthGrants.id, row.grant.id));
  return {
    user: {
      id: row.user.id,
      email: row.user.email,
      displayName: row.user.displayName,
      suspendedAt: row.user.suspendedAt,
      authMethod: 'oauth',
      authVersion: row.user.authVersion,
      authenticatedAt: null,
    },
    grantId: row.grant.id,
    clientDbId: row.client.id,
    clientId: row.client.clientId,
    scopes,
    expiresAt: row.access.expiresAt,
    resource: row.grant.resource,
  };
}

export async function revokeOAuthToken(rawToken: string, clientId: string): Promise<void> {
  const db = getDb();
  const tokenHash = hash(rawToken);
  const accessRows = await db
    .select({ grantId: oauthAccessTokens.grantId, clientId: oauthClients.clientId })
    .from(oauthAccessTokens)
    .innerJoin(oauthGrants, eq(oauthAccessTokens.grantId, oauthGrants.id))
    .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
    .where(eq(oauthAccessTokens.tokenHash, tokenHash));
  const refreshRows = await db
    .select({ grantId: oauthRefreshTokens.grantId, clientId: oauthClients.clientId })
    .from(oauthRefreshTokens)
    .innerJoin(oauthGrants, eq(oauthRefreshTokens.grantId, oauthGrants.id))
    .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
    .where(eq(oauthRefreshTokens.tokenHash, tokenHash));
  const grantIds = [...accessRows, ...refreshRows]
    .filter((row) => row.clientId === clientId)
    .map((row) => row.grantId);
  if (grantIds.length > 0) {
    await db
      .update(oauthGrants)
      .set({ revokedAt: new Date() })
      .where(inArray(oauthGrants.id, grantIds));
  }
}
