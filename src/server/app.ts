import type { OpenAPIHono } from '@hono/zod-openapi';
import { upgradeWebSocket, websocket } from 'hono/bun';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { AppConfig } from './config.ts';
import { type AppEnv, createOpenApiApp } from './openapi/app.ts';
import { adventureLogRouter } from './routes/adventureLog.ts';
import { apiKeysRouter } from './routes/apiKeys.ts';
import { authRouter } from './routes/auth.ts';
import { campaignLibraryRouter } from './routes/campaignLibrary.ts';
import { campaignsRouter } from './routes/campaigns.ts';
import { characterSubResourcesRouter } from './routes/characterSubResources.ts';
import { charactersRouter } from './routes/characters.ts';
import { healthRouter } from './routes/health.ts';
import { invitationsRouter } from './routes/invitations.ts';
import { syncRouter } from './routes/sync.ts';
import { createSyncWsHandler } from './routes/syncWs.ts';
import { attachStaticHandler } from './static.ts';

export function createApp(config: AppConfig): OpenAPIHono<AppEnv> {
  const app = createOpenApiApp();

  if (config.corsOrigins.length > 0) {
    app.use(
      '/api/*',
      cors({
        origin: config.corsOrigins,
        credentials: true,
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      }),
    );
  }

  // Mount sub-routers under /api/v1
  app.route('/api/v1', healthRouter);
  app.route('/api/v1', authRouter);
  app.route('/api/v1', apiKeysRouter);
  app.route('/api/v1', campaignsRouter);
  app.route('/api/v1', invitationsRouter);
  app.route('/api/v1', campaignLibraryRouter);
  app.route('/api/v1', adventureLogRouter);
  app.route('/api/v1', charactersRouter);
  app.route('/api/v1', characterSubResourcesRouter);

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
    // In dev, Hono only sees `/api/*` (the Vite plugin's exclude regex
    // diverts everything else). Make the API 404 a JSON response to
    // match the prod static handler's contract.
    app.notFound((c) => c.json({ error: 'not_found' }, 404));
  }

  return app;
}
