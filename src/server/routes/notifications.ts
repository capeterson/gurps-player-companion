/**
 * Per-user notifications API.
 *
 * Endpoints (gpw parity):
 *   GET    /notifications[?unreadOnly=true]
 *   POST   /notifications/{id}/read
 *   POST   /notifications/read-all
 *   DELETE /notifications/{id}
 *
 * Notification rows are emitted by other server code (currently the
 * invitations router) and consumed by the NotificationsBell in the
 * header. The polling interval lives client-side.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { uuid } from '../../shared/schemas/common.ts';
import { type NotificationOut, notificationOut } from '../../shared/schemas/notification.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { getDb } from '../db/client.ts';
import { type DbNotification, notifications } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';

const router = createOpenApiApp();
router.use('/notifications', requireActiveUser);
router.use('/notifications/*', requireActiveUser);

function toOut(n: DbNotification): NotificationOut {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    payload: n.payload,
    relatedId: n.relatedId,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/notifications',
    tags: ['notifications'],
    summary: 'List the current user’s notifications',
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        unreadOnly: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v === 'true'),
      }),
    },
    responses: {
      200: {
        description: 'List',
        content: { 'application/json': { schema: z.array(notificationOut) } },
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { unreadOnly } = c.req.valid('query');
    const db = getDb();
    const where = unreadOnly
      ? and(eq(notifications.userId, user.id), isNull(notifications.readAt))
      : eq(notifications.userId, user.id);
    const rows = await db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt));
    return c.json(rows.map(toOut), 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/notifications/{id}/read',
    tags: ['notifications'],
    summary: 'Mark a notification as read',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: notificationOut } },
      },
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const db = getDb();
    const existing = await db.select().from(notifications).where(eq(notifications.id, id));
    const row = existing[0];
    if (!row || row.userId !== user.id) {
      throw new HTTPException(404, { message: 'notification not found' });
    }
    if (row.readAt === null) {
      const updated = await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(eq(notifications.id, id))
        .returning();
      const u = updated[0];
      if (!u) throw new HTTPException(500, { message: 'notification vanished' });
      return c.json(toOut(u), 200);
    }
    return c.json(toOut(row), 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/notifications/read-all',
    tags: ['notifications'],
    summary: 'Mark every unread notification as read',
    security: [{ bearerAuth: [] }],
    responses: { 204: { description: 'Done' } },
  }),
  async (c) => {
    const user = c.get('user');
    const db = getDb();
    await db
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return c.body(null, 204);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/notifications/{id}',
    tags: ['notifications'],
    summary: 'Dismiss (delete) a notification',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid }) },
    responses: {
      204: { description: 'Dismissed' },
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const db = getDb();
    const existing = await db.select().from(notifications).where(eq(notifications.id, id));
    const row = existing[0];
    if (!row || row.userId !== user.id) {
      throw new HTTPException(404, { message: 'notification not found' });
    }
    await db.delete(notifications).where(eq(notifications.id, id));
    return c.body(null, 204);
  },
);

export const notificationsRouter = router;
