import { createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  apiKeyCreateRequest,
  apiKeyCreatedResponse,
  apiKeyOut,
} from '../../shared/schemas/apiKey.ts';
import { generatePlaintextKey, hashApiKey } from '../auth/apiKey.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import type { AuthenticatedUser } from '../auth/session.ts';
import { getDb } from '../db/client.ts';
import { apiKeys } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';

const router = createOpenApiApp();

router.use('/auth/api-keys', requireActiveUser);
router.use('/auth/api-keys/*', requireActiveUser);

function requireJwt(user: AuthenticatedUser): void {
  if (user.authMethod !== 'jwt') {
    throw new HTTPException(403, { message: 'JWT required for API key management' });
  }
}

function rowToOut(row: typeof apiKeys.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/auth/api-keys',
    tags: ['auth'],
    summary: 'List active API keys for the current user',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'API keys',
        content: { 'application/json': { schema: z.array(apiKeyOut) } },
      },
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    requireJwt(user);
    const rows = await getDb()
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));
    return c.json(rows.map(rowToOut), 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/auth/api-keys',
    tags: ['auth'],
    summary: 'Create a new API key (plaintext returned once)',
    security: [{ bearerAuth: [] }],
    request: {
      body: { required: true, content: { 'application/json': { schema: apiKeyCreateRequest } } },
    },
    responses: {
      201: {
        description: 'API key created',
        content: { 'application/json': { schema: apiKeyCreatedResponse } },
      },
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    requireJwt(user);
    const body = c.req.valid('json');
    const plaintextKey = generatePlaintextKey();
    const keyHash = hashApiKey(plaintextKey);
    const [row] = await getDb()
      .insert(apiKeys)
      .values({ userId: user.id, name: body.name, keyHash, prefix: plaintextKey.slice(0, 12) })
      .returning();
    if (!row) throw new HTTPException(500, { message: 'insert failed' });
    return c.json({ apiKey: rowToOut(row), plaintextKey }, 201);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/auth/api-keys/{id}',
    tags: ['auth'],
    summary: 'Revoke an API key',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string().uuid() }),
    },
    responses: {
      204: { description: 'Revoked' },
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('API key not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    requireJwt(user);
    const { id } = c.req.valid('param');
    const result = await getDb()
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (result.length === 0) throw new HTTPException(404, { message: 'api key not found' });
    return c.body(null, 204);
  },
);

export const apiKeysRouter = router;
