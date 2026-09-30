import { createRoute } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  notificationPreferences,
  notificationPreferencesPatch,
} from '../../shared/schemas/notificationPreferences.ts';
import { requireActiveJwt } from '../auth/middleware.ts';
import { getDb, runInDbTransaction } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';

const router = createOpenApiApp();
router.use('/auth/notification-preferences', requireActiveJwt);
const responses = {
  200: {
    description: 'Notification preferences',
    content: { 'application/json': { schema: notificationPreferences } },
  },
  401: errorResponse('Unauthorized'),
};
router.openapi(
  createRoute({
    method: 'get',
    path: '/auth/notification-preferences',
    tags: ['auth'],
    summary: 'Read notification preferences',
    security: [{ bearerAuth: [] }],
    responses,
  }),
  async (c) => {
    const [row] = await getDb()
      .select({ preferences: users.notificationPreferences })
      .from(users)
      .where(eq(users.id, c.get('user').id));
    if (!row) throw new HTTPException(401, { message: 'unknown_user' });
    return c.json(notificationPreferences.parse(row.preferences), 200);
  },
);
router.openapi(
  createRoute({
    method: 'patch',
    path: '/auth/notification-preferences',
    tags: ['auth'],
    summary: 'Update notification preferences',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: notificationPreferencesPatch } },
      },
    },
    responses: { ...responses, 422: errorResponse('Validation error') },
  }),
  async (c) => {
    const patch = c.req.valid('json');
    const preferences = await runInDbTransaction(async () => {
      const db = getDb();
      const [row] = await db
        .select({ preferences: users.notificationPreferences })
        .from(users)
        .where(eq(users.id, c.get('user').id))
        .for('update');
      if (!row) throw new HTTPException(401, { message: 'unknown_user' });
      const next = notificationPreferences.parse({ ...row.preferences, ...patch });
      await db
        .update(users)
        .set({ notificationPreferences: next, updatedAt: new Date() })
        .where(eq(users.id, c.get('user').id));
      return next;
    });
    return c.json(preferences, 200);
  },
);
export const notificationPreferencesRouter = router;
