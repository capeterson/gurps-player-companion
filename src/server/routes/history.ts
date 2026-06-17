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
import { campaignMemberships, campaigns, characters, entityHistory, users } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { decideCharacterAccess } from './sync.ts';

const router = createOpenApiApp();
router.use('/characters/*', requireActiveUser);
router.use('/campaigns/*', requireActiveUser);

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

    // Determine access level.
    let accessMode: 'full' | 'minimal';

    if (char.ownerId === user.id) {
      accessMode = 'full';
    } else if (char.campaignId) {
      // Need the campaign row to check GM status and shareCharacterSheets.
      const campRows = await db
        .select({
          id: campaigns.id,
          ownerId: campaigns.ownerId,
          shareCharacterSheets: campaigns.shareCharacterSheets,
        })
        .from(campaigns)
        .where(eq(campaigns.id, char.campaignId));

      const camp = campRows[0];
      if (!camp) throw new HTTPException(404, { message: 'character not found' });

      // `decideCharacterAccess` assumes its inputs were already filtered to
      // campaigns the viewer belongs to (it never re-checks membership), so a
      // shareCharacterSheets=true campaign would otherwise grant `full` access
      // to ANY authenticated user who knows the character id. Gate on actual
      // ownership/membership here before trusting the computed access mode.
      const isCampaignOwner = camp.ownerId === user.id;
      const memberRows = isCampaignOwner
        ? []
        : await db
            .select({ userId: campaignMemberships.userId })
            .from(campaignMemberships)
            .where(
              and(
                eq(campaignMemberships.campaignId, char.campaignId),
                eq(campaignMemberships.userId, user.id),
              ),
            );
      if (!isCampaignOwner && memberRows.length === 0) {
        throw new HTTPException(403, { message: 'forbidden' });
      }

      const computed = decideCharacterAccess({
        viewerId: user.id,
        characters: [char],
        campaigns: [camp],
      }).get(char.id);
      if (!computed) throw new HTTPException(403, { message: 'forbidden' });

      accessMode = computed;
    } else {
      // No campaign and not the owner.
      throw new HTTPException(403, { message: 'forbidden' });
    }

    // Members without full sheet access cannot see the change log.
    if (accessMode === 'minimal') {
      throw new HTTPException(403, { message: 'forbidden' });
    }

    // Query entity_history for this character, paginated by revision DESC.
    const whereClause = before
      ? and(eq(entityHistory.characterId, characterId), lt(entityHistory.revision, before))
      : eq(entityHistory.characterId, characterId);

    const rows = await db
      .select({
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
      })
      .from(entityHistory)
      .leftJoin(users, eq(users.id, entityHistory.actorUserId))
      .where(whereClause)
      .orderBy(desc(entityHistory.revision))
      .limit(limit);

    const events = rows.map((row) => {
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
    });

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

    const { campaign } = await loadCampaignOr403(campaignId, user.id);

    // scope=character is GM-only (campaign owner only).
    if (scope === 'character' && campaign.ownerId !== user.id) {
      throw new HTTPException(403, { message: 'forbidden' });
    }

    // Determine scope filter: default to campaign-scope rows only.
    const scopeFilter = scope ?? 'campaign';

    const whereClause = before
      ? and(
          eq(entityHistory.campaignId, campaignId),
          eq(entityHistory.scope, scopeFilter),
          lt(entityHistory.revision, before),
        )
      : and(eq(entityHistory.campaignId, campaignId), eq(entityHistory.scope, scopeFilter));

    const db = getDb();

    const campaignRows = await db
      .select({
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
      })
      .from(entityHistory)
      .leftJoin(users, eq(users.id, entityHistory.actorUserId))
      .where(whereClause)
      .orderBy(desc(entityHistory.revision))
      .limit(limit);

    // Private adventure-log entries are campaign-scoped but the log route only
    // shows them to their author (or the campaign owner). Apply the same gate
    // here so other members can't read private log titles via the summary or
    // pull the raw body with ?detail=1. Snapshots use jsonb column names
    // (`visibility`, `author_id`).
    const isCampaignOwner = campaign.ownerId === user.id;
    const visibleRows = campaignRows.filter((row) => {
      if (row.entityClass !== 'adventure_log' || isCampaignOwner) return true;
      const snap = (row.newRow ?? row.oldRow) as Record<string, unknown> | null;
      const isPrivate = snap?.visibility === 'private';
      const authorId = snap?.author_id;
      return !isPrivate || authorId === user.id;
    });

    const events = visibleRows.map((row) => {
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
    });

    return c.json(events, 200);
  },
);

export const historyRouter = router;
