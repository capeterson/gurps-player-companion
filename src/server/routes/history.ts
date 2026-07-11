/**
 * GET /characters/:id/history  — per-character audit trail
 * GET /campaigns/:id/history   — per-campaign audit trail
 *
 * Both endpoints paginate `entity_history` by revision DESC with a
 * cursor-based `before` param and JOIN the `users` table to attach the
 * actor's display name.  `summarizeEvent` computes a human-readable
 * one-liner for each row before it leaves the server.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq, lt } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { summarizeEvent } from '../../shared/history/summarize.ts';
import { uuid } from '../../shared/schemas/common.ts';
import { historyEventOut, historyQueryParams } from '../../shared/schemas/history.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { loadCampaignOr403 } from '../auth/permissions.ts';
import { getDb } from '../db/client.ts';
import { characters, entityHistory, users } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { resolveCharacterView } from '../services/characterAccess.ts';

const router = createOpenApiApp();
router.use('/characters/*', requireActiveUser);
router.use('/campaigns/*', requireActiveUser);

/**
 * Column set shared by both history endpoints below: every
 * `entity_history` column plus the actor's display name via a left
 * join on `users` (the actor row can be missing for a deleted user).
 */
const historyEventColumns = {
  id: entityHistory.id,
  revision: entityHistory.revision,
  scope: entityHistory.scope,
  entityClass: entityHistory.entityClass,
  entityId: entityHistory.entityId,
  op: entityHistory.op,
  characterId: entityHistory.characterId,
  campaignId: entityHistory.campaignId,
  actorUserId: entityHistory.actorUserId,
  batchId: entityHistory.batchId,
  oldRow: entityHistory.oldRow,
  newRow: entityHistory.newRow,
  createdAt: entityHistory.createdAt,
  actorDisplayName: users.displayName,
};

/** Base select+join shared by both endpoints; callers add `.where()`, `.orderBy()`, `.limit()`. */
function baseHistorySelect() {
  return getDb()
    .select(historyEventColumns)
    .from(entityHistory)
    .leftJoin(users, eq(users.id, entityHistory.actorUserId));
}

type HistoryEventRow = Awaited<ReturnType<typeof baseHistorySelect>>[number];

/**
 * Project one `entity_history` row (+ joined actor name) to the
 * `historyEventOut` wire shape, computing the human-readable summary
 * and including the before/after snapshots only when `detail` is set.
 */
function toHistoryEvent(row: HistoryEventRow, detail: boolean): z.infer<typeof historyEventOut> {
  const { summary } = summarizeEvent({
    entityClass: row.entityClass,
    op: row.op,
    oldRow: (row.oldRow as Record<string, unknown>) ?? null,
    newRow: (row.newRow as Record<string, unknown>) ?? null,
  });

  const event: z.infer<typeof historyEventOut> = {
    id: row.id,
    revision: Number(row.revision),
    scope: row.scope as 'character' | 'campaign',
    entityClass: row.entityClass as z.infer<typeof historyEventOut>['entityClass'],
    entityId: row.entityId,
    op: row.op as 'insert' | 'update' | 'delete',
    characterId: row.characterId,
    campaignId: row.campaignId,
    actorUserId: row.actorUserId,
    actorDisplayName: row.actorDisplayName ?? null,
    batchId: row.batchId,
    summary,
    createdAt: row.createdAt.toISOString(),
  };

  if (detail) {
    event.oldRow = (row.oldRow as Record<string, unknown>) ?? null;
    event.newRow = (row.newRow as Record<string, unknown>) ?? null;
  }

  return event;
}

// ---------- GET /characters/:id/history ----------

router.openapi(
  createRoute({
    method: 'get',
    path: '/characters/{id}/history',
    tags: ['history'],
    security: [{ bearerAuth: [] }],
    summary: 'Paginated audit history for a single character',
    request: {
      params: z.object({ id: uuid }),
      query: historyQueryParams,
    },
    responses: {
      200: {
        description: 'History events, newest first',
        content: { 'application/json': { schema: z.array(historyEventOut) } },
      },
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id: characterId } = c.req.valid('param');
    const { before, limit, detail } = c.req.valid('query');

    const db = getDb();

    // Load the character.
    const charRows = await db
      .select({
        id: characters.id,
        ownerId: characters.ownerId,
        campaignId: characters.campaignId,
      })
      .from(characters)
      .where(eq(characters.id, characterId));

    const char = charRows[0];
    if (!char) throw new HTTPException(404, { message: 'character not found' });

    // `resolveCharacterView` owns the membership gate that
    // `decideCharacterAccess` deliberately skips (it assumes its inputs
    // were already filtered to campaigns the viewer belongs to) — a
    // shareCharacterSheets=true campaign would otherwise grant `full`
    // access to ANY authenticated user who knows the character id.
    const view = await resolveCharacterView(user.id, char);
    if (view === 'forbidden') throw new HTTPException(403, { message: 'forbidden' });
    // Members without full sheet access cannot see the change log.
    if (view === 'minimal') throw new HTTPException(403, { message: 'forbidden' });

    // Query entity_history for this character, paginated by revision DESC.
    const whereClause = before
      ? and(eq(entityHistory.characterId, characterId), lt(entityHistory.revision, before))
      : eq(entityHistory.characterId, characterId);

    const rows = await baseHistorySelect()
      .where(whereClause)
      .orderBy(desc(entityHistory.revision))
      .limit(limit);

    const events = rows.map((row) => toHistoryEvent(row, detail));
    return c.json(events, 200);
  },
);

// ---------- GET /campaigns/:id/history ----------

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns/{id}/history',
    tags: ['history'],
    security: [{ bearerAuth: [] }],
    summary: 'Paginated audit history for a campaign',
    request: {
      params: z.object({ id: uuid }),
      query: historyQueryParams,
    },
    responses: {
      200: {
        description: 'History events, newest first',
        content: { 'application/json': { schema: z.array(historyEventOut) } },
      },
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id: campaignId } = c.req.valid('param');
    const { before, limit, detail, scope } = c.req.valid('query');

    const { role } = await loadCampaignOr403(campaignId, user.id);

    // Character roll-up is available to campaign staff running the game.
    if (scope === 'character' && role !== 'owner' && role !== 'manager') {
      throw new HTTPException(403, { message: 'forbidden' });
    }

    // Determine scope filter: default to campaign-scope rows only.
    const scopeFilter = scope ?? 'campaign';

    const selectBatch = (beforeRev: number | undefined) =>
      baseHistorySelect()
        .where(
          beforeRev
            ? and(
                eq(entityHistory.campaignId, campaignId),
                eq(entityHistory.scope, scopeFilter),
                lt(entityHistory.revision, beforeRev),
              )
            : and(eq(entityHistory.campaignId, campaignId), eq(entityHistory.scope, scopeFilter)),
        )
        .orderBy(desc(entityHistory.revision))
        .limit(limit);

    // Private adventure-log entries are visible ONLY to their author — even
    // the campaign owner cannot read another member's private entry through
    // /campaigns/{id}/log, so we don't exempt the owner here either. Hide a row
    // if EITHER snapshot was a private entry not authored by the viewer:
    // editing a private entry to 'campaign' visibility would otherwise leak the
    // prior private title/body via the old_row when ?detail=1. Snapshots use
    // jsonb column names (`visibility`, `author_id`).
    const rowVisible = (row: HistoryEventRow): boolean => {
      if (row.entityClass !== 'adventure_log') return true;
      for (const snap of [row.oldRow, row.newRow] as Array<Record<string, unknown> | null>) {
        if (snap && snap.visibility === 'private' && snap.author_id !== user.id) return false;
      }
      return true;
    };

    // Over-fetch: the visibility predicate runs AFTER the SQL limit, so a
    // single query could return fewer than `limit` visible rows and make the
    // client stop paginating early (it treats a short page as the end). Keep
    // pulling older batches until we have `limit` visible rows or the source is
    // exhausted. Bounded by MAX_BATCHES so a pathological run of hidden rows
    // can't loop unboundedly.
    const MAX_BATCHES = 20;
    const visibleRows: HistoryEventRow[] = [];
    let cursor = before;
    for (let i = 0; i < MAX_BATCHES && visibleRows.length < limit; i++) {
      const batch = await selectBatch(cursor);
      if (batch.length === 0) break;
      for (const row of batch) {
        if (rowVisible(row)) visibleRows.push(row);
      }
      cursor = Number(batch[batch.length - 1]?.revision);
      if (batch.length < limit) break; // source exhausted
    }

    const events = visibleRows.slice(0, limit).map((row) => toHistoryEvent(row, detail));
    return c.json(events, 200);
  },
);

export const historyRouter = router;
