import { randomUUID } from 'node:crypto';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  SCOPE_DESCRIPTIONS,
  oauthAuthorizationDecision,
  oauthAuthorizationDetails,
  oauthAuthorizationQuery,
  oauthAuthorizationServerMetadata,
  oauthError,
  oauthGrantOut,
  oauthProtectedResourceMetadata,
  oauthScope,
  oauthTokenResponse,
} from '../../shared/schemas/oauth.ts';
import { requireActiveJwt } from '../auth/middleware.ts';
import { enforceAuthRateLimit } from '../auth/rateLimit.ts';
import { hasRecentAuthentication } from '../auth/session.ts';
import type { AppConfig } from '../config.ts';
import { getDb } from '../db/client.ts';
import { oauthClients, oauthGrants } from '../db/schema.ts';
import { type AppEnv, createOpenApiApp, errorResponse } from '../openapi/app.ts';
import {
  OAuthError,
  beginAuthorization,
  exchangeAuthorizationCode,
  finishAuthorization,
  mcpResource,
  publicOrigin,
  revokeOAuthToken,
  rotateOAuthRefreshToken,
  syncConfiguredOAuthClients,
} from './service.ts';

const noStore = { 'cache-control': 'no-store', pragma: 'no-cache' };
const MAX_OAUTH_BODY_BYTES = 64 * 1024;

async function bodyWithinLimit(request: Request): Promise<boolean> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_OAUTH_BODY_BYTES) return false;
  const reader = request.clone().body?.getReader();
  if (!reader) return true;
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) return true;
      total += part.value.byteLength;
      if (total > MAX_OAUTH_BODY_BYTES) {
        // This is one side of Request.clone()'s tee. Awaiting cancellation can
        // wait forever for the unconsumed original branch.
        void reader.cancel();
        return false;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function oauthFailure(error: unknown): { error: string; error_description: string } {
  if (error instanceof OAuthError) {
    return { error: error.code, error_description: error.message };
  }
  return { error: 'invalid_request', error_description: 'request could not be completed' };
}

export function createOAuthRouter(config: AppConfig) {
  const router = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        c.header('cache-control', 'no-store');
        return c.json(
          {
            error: 'invalid_request',
            error_description: result.error.issues.map((issue) => issue.message).join('; '),
          },
          400,
        );
      }
    },
  });
  const protectOAuthPost: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.header('cache-control', 'no-store');
    c.header('pragma', 'no-cache');
    if (c.req.method === 'POST') {
      if (!(await bodyWithinLimit(c.req.raw))) {
        return c.json(
          { error: 'invalid_request', error_description: 'request body is too large' },
          413,
        );
      }
      try {
        await enforceAuthRateLimit(c, config, 'oauth');
      } catch (error) {
        if (error instanceof HTTPException && error.status === 429) {
          return c.json(
            { error: 'temporarily_unavailable', error_description: 'too many requests' },
            429,
          );
        }
        throw error;
      }
    }
    await next();
  };
  // This router is mounted at the application root so its discovery routes
  // keep their standard paths. Never install wildcard middleware here: doing
  // so would charge unrelated API and MCP POSTs against the OAuth quota and
  // apply the OAuth body limit to them.
  router.use('/oauth/token', protectOAuthPost);
  router.use('/oauth/revoke', protectOAuthPost);
  const origin = publicOrigin(config);
  const resource = mcpResource(config);

  router.openapi(
    createRoute({
      method: 'get',
      path: '/.well-known/oauth-protected-resource/mcp',
      tags: ['oauth'],
      summary: 'OAuth protected-resource metadata for MCP',
      responses: {
        200: {
          description: 'Protected-resource metadata',
          content: { 'application/json': { schema: oauthProtectedResourceMetadata } },
        },
      },
    }),
    (c) => {
      c.header('cache-control', 'no-store');
      const body: z.infer<typeof oauthProtectedResourceMetadata> = {
        resource,
        authorization_servers: [origin],
        scopes_supported: ['gpc:read', 'gpc:write', 'gpc:manage'],
        bearer_methods_supported: ['header'],
      };
      return c.json(body);
    },
  );

  router.openapi(
    createRoute({
      method: 'get',
      path: '/.well-known/oauth-authorization-server',
      tags: ['oauth'],
      summary: 'OAuth authorization-server metadata',
      responses: {
        200: {
          description: 'Authorization-server metadata',
          content: { 'application/json': { schema: oauthAuthorizationServerMetadata } },
        },
      },
    }),
    (c) => {
      c.header('cache-control', 'no-store');
      const body: z.infer<typeof oauthAuthorizationServerMetadata> = {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        revocation_endpoint: `${origin}/oauth/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['gpc:read', 'gpc:write', 'gpc:manage'],
        token_endpoint_auth_methods_supported: ['none'],
      };
      return c.json(body);
    },
  );

  const tokenForm = z.object({
    grant_type: z.string().min(1),
    client_id: z.string().min(1),
    resource: z.string().url(),
    code: z.string().optional(),
    redirect_uri: z.string().url().optional(),
    code_verifier: z
      .string()
      .regex(/^[A-Za-z0-9._~-]{43,128}$/)
      .optional(),
    refresh_token: z.string().optional(),
    request_id: z.string().min(1).max(200).optional(),
  });

  router.openapi(
    createRoute({
      method: 'post',
      path: '/oauth/token',
      tags: ['oauth'],
      summary: 'Exchange an OAuth code or rotate a refresh token',
      request: {
        body: {
          required: true,
          content: { 'application/x-www-form-urlencoded': { schema: tokenForm } },
        },
      },
      responses: {
        200: {
          description: 'OAuth token pair',
          content: { 'application/json': { schema: oauthTokenResponse } },
        },
        400: {
          description: 'OAuth error',
          content: { 'application/json': { schema: oauthError } },
        },
        413: {
          description: 'Request too large',
          content: { 'application/json': { schema: oauthError } },
        },
        429: {
          description: 'Rate limited',
          content: { 'application/json': { schema: oauthError } },
        },
      },
    }),
    async (c) => {
      c.header('cache-control', noStore['cache-control']);
      c.header('pragma', noStore.pragma);
      try {
        const form = c.req.valid('form');
        const result =
          form.grant_type === 'authorization_code'
            ? await exchangeAuthorizationCode(config, {
                code: form.code ?? '',
                clientId: form.client_id,
                redirectUri: form.redirect_uri ?? '',
                codeVerifier: form.code_verifier ?? '',
                resource: form.resource,
              })
            : form.grant_type === 'refresh_token'
              ? await rotateOAuthRefreshToken(
                  config,
                  form.refresh_token ?? '',
                  form.client_id,
                  form.resource,
                  form.request_id ?? randomUUID(),
                )
              : (() => {
                  throw new OAuthError('unsupported_grant_type', 'grant_type is not supported');
                })();
        return c.json(result, 200);
      } catch (error) {
        if (error instanceof OAuthError) return c.json(oauthFailure(error), 400);
        throw error;
      }
    },
  );

  const revokeForm = z.object({
    token: z.string().min(1),
    client_id: z.string().min(1),
    token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
  });
  router.openapi(
    createRoute({
      method: 'post',
      path: '/oauth/revoke',
      tags: ['oauth'],
      summary: 'Revoke an OAuth grant by one of its tokens',
      request: {
        body: {
          required: true,
          content: { 'application/x-www-form-urlencoded': { schema: revokeForm } },
        },
      },
      responses: {
        200: { description: 'Revocation accepted' },
        413: {
          description: 'Request too large',
          content: { 'application/json': { schema: oauthError } },
        },
        429: {
          description: 'Rate limited',
          content: { 'application/json': { schema: oauthError } },
        },
      },
    }),
    async (c) => {
      c.header('cache-control', 'no-store');
      const form = c.req.valid('form');
      await syncConfiguredOAuthClients(config);
      await revokeOAuthToken(form.token, form.client_id);
      return c.body(null, 200);
    },
  );

  return router;
}

export function createOAuthAccountRouter(config: AppConfig) {
  const router = createOpenApiApp();
  router.use('/oauth/*', async (c, next) => {
    c.header('cache-control', 'no-store');
    c.header('pragma', 'no-cache');
    await next();
  });
  router.use('/oauth/*', requireActiveJwt);

  router.openapi(
    createRoute({
      method: 'get',
      path: '/oauth/authorization',
      tags: ['oauth'],
      summary: 'Validate an authorization request and create a CSRF-bound consent view',
      security: [{ bearerAuth: [] }],
      request: { query: oauthAuthorizationQuery },
      responses: {
        200: {
          description: 'Consent details',
          content: { 'application/json': { schema: oauthAuthorizationDetails } },
        },
        400: errorResponse('Invalid authorization request'),
        401: errorResponse('Unauthorized'),
      },
    }),
    async (c) => {
      c.header('cache-control', 'no-store');
      try {
        const result = await beginAuthorization(config, c.get('user'), c.req.valid('query'));
        return c.json(
          {
            clientName: result.client.name,
            scopes: result.scopes,
            scopeDescriptions: SCOPE_DESCRIPTIONS,
            csrfToken: result.csrfToken,
            state: c.req.valid('query').state,
          },
          200,
        );
      } catch (error) {
        if (error instanceof OAuthError) {
          return c.json({ error: oauthFailure(error).error_description }, 400);
        }
        throw error;
      }
    },
  );

  router.openapi(
    createRoute({
      method: 'post',
      path: '/oauth/authorization',
      tags: ['oauth'],
      summary: 'Approve or deny a delegated OAuth grant',
      security: [{ bearerAuth: [] }],
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: oauthAuthorizationDecision } },
        },
      },
      responses: {
        200: {
          description: 'Validated redirect',
          content: { 'application/json': { schema: z.object({ redirectTo: z.string().url() }) } },
        },
        400: errorResponse('Invalid authorization request'),
        403: errorResponse('Recent authentication required'),
      },
    }),
    async (c) => {
      c.header('cache-control', 'no-store');
      const body = c.req.valid('json');
      const user = c.get('user');
      if (body.decision === 'approve' && !hasRecentAuthentication(user)) {
        return c.json({ error: 'recent authentication required' }, 403);
      }
      try {
        const redirectTo = await finishAuthorization(
          config,
          user,
          body,
          body.csrf_token,
          body.decision === 'approve',
        );
        return c.json({ redirectTo }, 200);
      } catch (error) {
        if (error instanceof OAuthError) {
          return c.json({ error: oauthFailure(error).error_description }, 400);
        }
        throw error;
      }
    },
  );

  router.openapi(
    createRoute({
      method: 'get',
      path: '/oauth/grants',
      tags: ['oauth'],
      summary: 'List connected OAuth clients',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Connected clients',
          content: { 'application/json': { schema: z.array(oauthGrantOut) } },
        },
      },
    }),
    async (c) => {
      await syncConfiguredOAuthClients(config);
      const rows = await getDb()
        .select({ grant: oauthGrants, client: oauthClients })
        .from(oauthGrants)
        .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
        .where(and(eq(oauthGrants.userId, c.get('user').id), isNull(oauthGrants.revokedAt)))
        .orderBy(desc(oauthGrants.createdAt));
      return c.json(
        rows.map(({ grant, client }) => ({
          id: grant.id,
          clientId: client.clientId,
          clientName: client.name,
          scopes: grant.scopes.map((scope) => oauthScope.parse(scope)),
          createdAt: grant.createdAt.toISOString(),
          lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
        })),
        200,
      );
    },
  );

  router.openapi(
    createRoute({
      method: 'delete',
      path: '/oauth/grants/{id}',
      tags: ['oauth'],
      summary: 'Revoke a connected OAuth client grant',
      security: [{ bearerAuth: [] }],
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        204: { description: 'Grant revoked' },
        404: errorResponse('Grant not found'),
      },
    }),
    async (c) => {
      const rows = await getDb()
        .update(oauthGrants)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(oauthGrants.id, c.req.valid('param').id),
            eq(oauthGrants.userId, c.get('user').id),
            isNull(oauthGrants.revokedAt),
          ),
        )
        .returning({ id: oauthGrants.id });
      if (rows.length === 0) return c.json({ error: 'grant not found' }, 404);
      return c.body(null, 204);
    },
  );

  return router;
}
