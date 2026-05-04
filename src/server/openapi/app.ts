/**
 * The OpenAPIHono root.  All routes that should appear in the OpenAPI
 * document mount on this app.  Each route uses `createRoute` from
 * `@hono/zod-openapi` so request/response shapes are reflected
 * automatically.
 */

import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { AuthVariables } from '../auth/middleware.ts';

export type AppEnv = { Variables: AuthVariables };

export function createOpenApiApp() {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: 'validation_error',
            issues: result.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
              code: i.code,
            })),
          },
          422,
        );
      }
    },
  });
  return app;
}

export const errorBody = z
  .object({
    error: z.string(),
  })
  .openapi('ErrorBody');

export function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: errorBody } },
  };
}
