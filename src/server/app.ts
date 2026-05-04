import type { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { AppConfig } from './config.ts';
import { type AppEnv, createOpenApiApp } from './openapi/app.ts';
import { apiKeysRouter } from './routes/apiKeys.ts';
import { authRouter } from './routes/auth.ts';
import { campaignsRouter } from './routes/campaigns.ts';
import { charactersRouter } from './routes/characters.ts';
import { healthRouter } from './routes/health.ts';
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
  app.route('/api/v1', charactersRouter);

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

  // Static + SPA fallback — must be the last route so it doesn't shadow
  // the /api/* handlers above.  In dev (Vite on :5173 proxying /api), the
  // `dist/client` folder will be empty and the fallback emits a 503.
  attachStaticHandler(app);

  return app;
}
