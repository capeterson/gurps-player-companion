import { createRoute, z } from '@hono/zod-openapi';
import { createOpenApiApp } from '../openapi/app.ts';

const healthSchema = z.object({ ok: z.boolean() }).openapi('Health');

const healthRoute = createRoute({
  method: 'get',
  path: '/healthz',
  tags: ['health'],
  summary: 'Liveness probe',
  responses: {
    200: {
      description: 'Server is alive',
      content: { 'application/json': { schema: healthSchema } },
    },
  },
});

export const healthRouter = createOpenApiApp();
healthRouter.openapi(healthRoute, (c) => c.json({ ok: true }, 200));
