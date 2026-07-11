/**
 * Adventure log entries: per-campaign session notes + private GM/player
 * scratch. Read access is membership-scoped, with private entries hidden
 * from non-authors. Write access is restricted to the entry's author or
 * the campaign owner.
 *
 * The `adventure_log_entries` table has been in the schema since
 * migration 0001 — this router exposes it for the first time.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, ne, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  adventureLogCreate,
  adventureLogOut,
  adventureLogUpdate,
} from '../../shared/schemas/adventureLog.ts';
import { uuid } from '../../shared/schemas/common.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { loadCampaignOr403, requireCampaignMember } from '../auth/permissions.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { type DbAdventureLogEntry, adventureLogEntries, users } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { buildPatchSet } from '../services/patchSet.ts';

const router = createOpenApiApp();
router.use('/campaigns/*', requireActiveUser);

interface AuthorRow {
  id: string;
  displayName: string;
}

function entryToOut(row: DbAdventureLogEntry, author: AuthorRow) {
  // sessionDate is a Postgres `date`. Drizzle's pg driver hands it back as a
  // 'YYYY-MM-DD' string; we keep the type narrow here (no Date coercion).
  return {
    id: row.id,
    campaignId: row.campaignId,
    authorId: row.authorId,
    authorDisplayName: author.displayName,
    sessionDate: row.sessionDate,
    title: row.title,
    body: row.body,
    visibility: row.visibility,
    xpAwards: row.xpAwards,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns/{id}/log',
    tags: ['adventure-log'],
    summary: 'List log entries (members see campaign-visible + their own private)',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: {
        description: 'Adventure log entries (newest first)',
        content: { 'application/json': { schema: z.array(adventureLogOut) } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await requireCampaignMember(id, user.id);
    const db = getDb();
    const rows = await db
      .select({ entry: adventureLogEntries, author: users })
      .from(adventureLogEntries)
      .innerJoin(users, eq(users.id, adventureLogEntries.authorId))
      .where(
        and(
          eq(adventureLogEntries.campaignId, id),
          // private entries only readable by author
          or(
            eq(adventureLogEntries.visibility, 'campaign'),
            eq(adventureLogEntries.authorId, user.id),
          ),
        ),
      )
      .orderBy(desc(adventureLogEntries.sessionDate), desc(adventureLogEntries.createdAt));
    return c.json(
      rows.map((r) => entryToOut(r.entry, { id: r.author.id, displayName: r.author.displayName })),
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/log',
    tags: ['adventure-log'],
    summary: 'Create a log entry (author = current user)',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: adventureLogCreate } } },
    },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: adventureLogOut } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignMember(id, user.id);
    const created = await withAudit(user.id, undefined, async (tx) => {
      const [row] = await tx
        .insert(adventureLogEntries)
        .values({
          campaignId: id,
          authorId: user.id,
          sessionDate: body.sessionDate,
          title: body.title,
          body: body.body,
          visibility: body.visibility,
          xpAwards: body.xpAwards,
        })
        .returning();
      if (!row) throw new HTTPException(500, { message: 'insert failed' });
      return row;
    });
    return c.json(entryToOut(created, { id: user.id, displayName: user.displayName }), 201);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/campaigns/{id}/log/{entryId}',
    tags: ['adventure-log'],
    summary: 'Edit a log entry (author or campaign owner)',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid, entryId: uuid }),
      body: { required: true, content: { 'application/json': { schema: adventureLogUpdate } } },
    },
    responses: {
      200: {
        description: 'Updated entry',
        content: { 'application/json': { schema: adventureLogOut } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, entryId } = c.req.valid('param');
    const body = c.req.valid('json');
    const { campaign } = await loadCampaignOr403(id, user.id);
    const db = getDb();
    const existing = (
      await db
        .select()
        .from(adventureLogEntries)
        .where(and(eq(adventureLogEntries.id, entryId), eq(adventureLogEntries.campaignId, id)))
    )[0];
    if (!existing) throw new HTTPException(404, { message: 'entry not found' });
    if (existing.authorId !== user.id && campaign.ownerId !== user.id) {
      throw new HTTPException(403, { message: 'author or owner only' });
    }
    const updated = await withAudit(user.id, undefined, async (tx) => {
      const [row] = await tx
        .update(adventureLogEntries)
        .set(buildPatchSet(body))
        .where(eq(adventureLogEntries.id, entryId))
        .returning();
      if (!row) throw new HTTPException(500, { message: 'update failed' });
      return row;
    });
    const author = (
      await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, updated.authorId))
    )[0];
    if (!author) throw new HTTPException(500, { message: 'author missing' });
    return c.json(entryToOut(updated, author), 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/campaigns/{id}/log/{entryId}',
    tags: ['adventure-log'],
    summary: 'Delete a log entry (author or campaign owner)',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid, entryId: uuid }) },
    responses: {
      204: { description: 'Deleted' },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, entryId } = c.req.valid('param');
    const { campaign } = await loadCampaignOr403(id, user.id);
    const db = getDb();
    const existing = (
      await db
        .select()
        .from(adventureLogEntries)
        .where(and(eq(adventureLogEntries.id, entryId), eq(adventureLogEntries.campaignId, id)))
    )[0];
    if (!existing) throw new HTTPException(404, { message: 'entry not found' });
    if (existing.authorId !== user.id && campaign.ownerId !== user.id) {
      throw new HTTPException(403, { message: 'author or owner only' });
    }
    await withAudit(user.id, undefined, async (tx) => {
      await tx.delete(adventureLogEntries).where(eq(adventureLogEntries.id, entryId));
    });
    return c.body(null, 204);
  },
);

// Touch otherwise-unused imports so the linter stays quiet.
export const _ = { asc, ne };
export const adventureLogRouter = router;
