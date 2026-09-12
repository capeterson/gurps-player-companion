import { type OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { upgradeWebSocket, websocket } from 'hono/bun';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { oauthAuthorizationQuery } from '../shared/schemas/oauth.ts';
import type { AppConfig } from './config.ts';
import { assertExactCoverage } from './mcp/catalog.ts';
import { createMcpHandler } from './mcp/transport.ts';
import { createOAuthAccountRouter, createOAuthRouter } from './oauth/routes.ts';
import { type AppEnv, createOpenApiApp } from './openapi/app.ts';
import { adminRouter } from './routes/admin.ts';
import { adventureLogRouter } from './routes/adventureLog.ts';
import { apiKeysRouter } from './routes/apiKeys.ts';
import { authRouter } from './routes/auth.ts';
import { campaignLibraryRouter } from './routes/campaignLibrary.ts';
import { campaignsRouter } from './routes/campaigns.ts';
import { characterSubResourcesRouter } from './routes/characterSubResources.ts';
import { charactersRouter } from './routes/characters.ts';
import { encounterRouter } from './routes/encounters.ts';
import { healthRouter } from './routes/health.ts';
import { historyRouter } from './routes/history.ts';
import { invitationsRouter } from './routes/invitations.ts';
import { notificationsRouter } from './routes/notifications.ts';
import { syncRouter } from './routes/sync.ts';
import { createSyncWsHandler } from './routes/syncWs.ts';
import { durableIdempotency } from './services/idempotency.ts';
import { mutationInvalidation } from './services/mutationInvalidation.ts';
import { attachStaticHandler } from './static.ts';

export function createApp(config: AppConfig): OpenAPIHono<AppEnv> {
  const app = createOpenApiApp();

  app.use('/api/v1/*', durableIdempotency);
  app.use('/api/v1/*', mutationInvalidation);

  if (config.corsOrigins.length > 0) {
    app.use(
      '/api/*',
      cors({
        origin: config.corsOrigins,
        credentials: true,
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      }),
    );
    app.use(
      '/mcp',
      cors({
        origin: config.corsOrigins,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version'],
        exposeHeaders: ['WWW-Authenticate', 'MCP-Protocol-Version'],
      }),
    );
    const oauthCors = cors({
      origin: config.corsOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    });
    app.use('/.well-known/*', oauthCors);
    app.use('/oauth/token', oauthCors);
    app.use('/oauth/revoke', oauthCors);
    app.use('/oauth/register', oauthCors);
  }

  app.route('/', createOAuthRouter(config));

  // Mount sub-routers under /api/v1
  app.route('/api/v1', healthRouter);
  app.route('/api/v1', authRouter);
  app.route('/api/v1', apiKeysRouter);
  app.route('/api/v1', campaignsRouter);
  app.route('/api/v1', invitationsRouter);
  app.route('/api/v1', notificationsRouter);
  app.route('/api/v1', adminRouter);
  app.route('/api/v1', campaignLibraryRouter);
  app.route('/api/v1', adventureLogRouter);
  app.route('/api/v1', encounterRouter);
  app.route('/api/v1', charactersRouter);
  app.route('/api/v1', characterSubResourcesRouter);
  app.route('/api/v1', historyRouter);
  app.route('/api/v1', createOAuthAccountRouter(config));

  // WebSocket push channel.  Auth via query-string token because the
  // browser WebSocket API can't set Authorization headers.  See
  // `routes/syncWs.ts` for the protocol.  MUST be registered BEFORE
  // `syncRouter` is mounted: that router installs
  // `use('/sync/*', requireActiveUser)`, which would otherwise reject
  // the handshake before our handler can read `?token=`.
  app.get(
    '/api/v1/sync/ws',
    createSyncWsHandler(upgradeWebSocket as Parameters<typeof createSyncWsHandler>[0]),
  );

  app.route('/api/v1', syncRouter);

  // Register the bearer security scheme so /api/v1/openapi.json describes it.
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT or gpc_-prefixed API key',
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/oauth/authorize',
      tags: ['oauth'],
      summary: 'Begin browser-based OAuth consent',
      request: { query: oauthAuthorizationQuery },
      responses: { 302: { description: 'Player consent page' } },
    }),
    (c) => {
      c.header('cache-control', 'no-store');
      c.header('pragma', 'no-cache');
      const target = new URL('/oauth/consent', c.req.url);
      target.search = new URL(c.req.url).search;
      return c.redirect(`${target.pathname}${target.search}`, 302);
    },
  );

  const openApiDocument = app.getOpenAPIDocument({
    openapi: '3.0.0',
    info: {
      title: 'GURPS Player Companion API',
      version: '0.1.0',
      description: 'Local-first GURPS character + campaign companion.',
    },
  });
  const mcpHandler = createMcpHandler(config, app, openApiDocument as unknown);
  // The SDK owns JSON-RPC parsing. Register the live handler before the
  // OpenAPI-only route so the bounded streaming reader runs before Hono's JSON
  // validator can buffer an untrusted body.
  app.on('POST', '/mcp', (c) => mcpHandler(c.req.raw));
  app.openapi(
    createRoute({
      method: 'post',
      path: '/mcp',
      tags: ['mcp'],
      summary: 'MCP 2025-11-25 Streamable HTTP transport',
      request: {
        body: { required: true, content: { 'application/json': { schema: z.unknown() } } },
      },
      responses: {
        200: {
          description: 'MCP JSON-RPC response',
          content: { 'application/json': { schema: z.unknown() } },
        },
        401: {
          description: 'OAuth access token required',
          content: { 'application/json': { schema: z.unknown() } },
        },
        405: { description: 'Only POST is supported in stateless mode' },
      },
    }),
    // Unreachable at runtime because the raw handler above is first. Keeping a
    // handler here lets the route remain the truthful OpenAPI contract.
    (c) => mcpHandler(c.req.raw, c.req.valid('json')),
  );
  app.on(['GET', 'DELETE'], '/mcp', (c) => mcpHandler(c.req.raw));

  assertExactCoverage(
    app.getOpenAPIDocument({
      openapi: '3.0.0',
      info: { title: 'GURPS Player Companion API', version: '0.1.0' },
    }),
  );

  // Expose the OpenAPI document.  Hidden in production via 404.
  if (config.environment !== 'production') {
    app.doc('/api/v1/openapi.json', {
      openapi: '3.0.0',
      info: {
        title: 'GURPS Player Companion API',
        version: '0.1.0',
        description: 'Local-first GURPS character + campaign companion.',
      },
    });
  }

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message || 'http_error' }, err.status);
    }
    console.error('unhandled error', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  // Static + SPA fallback. Skipped in dev — Vite owns the SPA there
  // (see `dev-entry.ts` + the `@hono/vite-dev-server` plugin in
  // `vite.config.ts`). In prod this serves the built `dist/client/`.
  // Must remain the last route so it doesn't shadow `/api/*` handlers.
  if (config.environment !== 'development') {
    attachStaticHandler(app);
  } else {
    // In dev, Hono only sees API, MCP, discovery, and OAuth protocol routes.
    // diverts everything else). Make the API 404 a JSON response to
    // match the prod static handler's contract.
    app.notFound((c) => c.json({ error: 'not_found' }, 404));
  }

  return app;
}
