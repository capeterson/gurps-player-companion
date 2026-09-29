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
import { type SQL, and, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { type AnyPgColumn, alias } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import { summarizeEvent } from '../../shared/history/summarize.ts';
import { uuid } from '../../shared/schemas/common.ts';
import { historyEventOut, historyQueryParams } from '../../shared/schemas/history.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { loadCampaignOr403 } from '../auth/permissions.ts';
import { getDb } from '../db/client.ts';
import { characters, entityHistory, oauthClients, users } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { resolveCharacterView } from '../services/characterAccess.ts';
import { decideCharacterAccess } from './sync.ts';

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
  agentClientId: entityHistory.agentClientId,
  agentGrantId: entityHistory.agentGrantId,
  agentClientName: oauthClients.name,
};

/** Base select+join shared by both endpoints; callers add `.where()`, `.orderBy()`, `.limit()`. */
function baseHistorySelect(batchSize: SQL<number> | SQL.Aliased<number>) {
  return getDb()
    .select({ ...historyEventColumns, batchSize })
    .from(entityHistory)
    .leftJoin(users, eq(users.id, entityHistory.actorUserId))
    .leftJoin(oauthClients, eq(oauthClients.id, entityHistory.agentClientId));
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
    agentClientId: row.agentClientId,
    agentGrantId: row.agentGrantId,
    agentClientName: row.agentClientName ?? null,
    batchId: row.batchId,
    batchSize: Number(row.batchSize ?? 0),
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

    // Compute batch cardinality independently of the page cursor. A later
    // page may contain only an older suffix of an explicit batch, but the UI
    // still needs to know that the batch has siblings and must not treat it
    // as a synthetic singleton eligible for burst folding.
    const batchSize = sql<number>`CASE WHEN ${entityHistory.batchId} IS NULL THEN 0 ELSE (
      SELECT count(*) FROM entity_history AS batch_members
      WHERE batch_members.batch_id = ${entityHistory.batchId}
        AND batch_members.character_id = ${characterId}
    ) END`.as('batch_size');
    const rows = await baseHistorySelect(batchSize)
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

    const { campaign, role } = await loadCampaignOr403(campaignId, user.id);

    // Character roll-up is available to campaign staff running the game.
    if (scope === 'character' && role !== 'owner' && role !== 'manager') {
      throw new HTTPException(403, { message: 'forbidden' });
    }

    // Determine scope filter: default to campaign-scope rows only.
    const scopeFilter = scope ?? 'campaign';
    // History survives deletions and campaign transfers (including departure
    // mirrors with character_id=NULL). Authorize its recorded owner/campaign
    // context through the same share gate as current character payloads.
    const visibleOwners: string[] = [];
    if (scopeFilter === 'character') {
      const owners = await getDb()
        .selectDistinct({ ownerId: entityHistory.ownerUserId })
        .from(entityHistory)
        .where(and(eq(entityHistory.campaignId, campaignId), eq(entityHistory.scope, 'character')));
      const access = decideCharacterAccess({
        viewerId: user.id,
        characters: owners.map(({ ownerId }) => ({ id: ownerId, ownerId, campaignId })),
        campaigns: [{ ...campaign, viewerRole: role }],
      });
      visibleOwners.push(
        ...owners
          .filter(({ ownerId }) => access.get(ownerId) === 'full')
          .map(({ ownerId }) => ownerId),
      );
    }

    // Apply visibility BEFORE pagination and to batch cardinality too. Neither
    // summaries, details, nor counts may disclose hidden rows. A long hidden
    // prefix must not make the client mistake a short page for end-of-history.
    const visible = (table: {
      entityClass: AnyPgColumn;
      op: AnyPgColumn;
      oldRow: AnyPgColumn;
      newRow: AnyPgColumn;
      ownerUserId: AnyPgColumn;
    }) =>
      and(
        // Cursor-only bookkeeping remains audited but is absent from this feed.
        sql`NOT (
          ${table.entityClass} = 'campaign' AND ${table.op} = 'update'
          AND (${table.oldRow} - 'updated_at' - 'revision')
            IS NOT DISTINCT FROM (${table.newRow} - 'updated_at' - 'revision')
        )`,
        scopeFilter === 'character' ? inArray(table.ownerUserId, visibleOwners) : undefined,
        // Either private snapshot hides the whole event from non-authors,
        // including an update that later publishes a private adventure log.
        sql`(${table.entityClass} <> 'adventure_log' OR (
          (${table.oldRow}->>'visibility' IS DISTINCT FROM 'private'
            OR ${table.oldRow}->>'author_id' = ${user.id})
          AND (${table.newRow}->>'visibility' IS DISTINCT FROM 'private'
            OR ${table.newRow}->>'author_id' = ${user.id})
        ))`,
      );
    const batchMembers = alias(entityHistory, 'batch_members');
    const batchCount = getDb()
      .select({ value: count() })
      .from(batchMembers)
      .where(
        and(
          eq(batchMembers.batchId, entityHistory.batchId),
          eq(batchMembers.campaignId, campaignId),
          eq(batchMembers.scope, scopeFilter),
          visible(batchMembers),
        ),
      );
    const batchSize =
      sql<number>`CASE WHEN ${entityHistory.batchId} IS NULL THEN 0 ELSE (${batchCount}) END`.as(
        'batch_size',
      );
    const rows = await baseHistorySelect(batchSize)
      .where(
        and(
          eq(entityHistory.campaignId, campaignId),
          eq(entityHistory.scope, scopeFilter),
          before ? lt(entityHistory.revision, before) : undefined,
          visible(entityHistory),
        ),
      )
      .orderBy(desc(entityHistory.revision))
      .limit(limit);

    const events = rows.map((row) => toHistoryEvent(row, detail));
    return c.json(events, 200);
  },
);

export const historyRouter = router;
