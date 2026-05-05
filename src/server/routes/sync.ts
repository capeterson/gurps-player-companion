/**
 * /api/v1/sync/operations and /api/v1/sync/cursor.
 *
 * The local-first client never calls /characters PATCH directly --
 * every UI mutation is enqueued into the Dexie outbox and replayed via
 * /sync/operations.  /sync/cursor is the inverse: it returns rows
 * (and tombstones) the client missed while offline so Dexie can be
 * brought back in sync with the server.
 *
 * Per-op transactionality (inside dispatchOperation) means a single
 * bad op in a batch does not poison the rest -- each outcome is
 * independent.  The HTTP status is therefore always 200; per-op
 * status lives in `outcomes[].status`.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, gt, inArray, or } from 'drizzle-orm';
import {
  type EntityClass,
  type SyncCursorChange,
  syncCursorRequest,
  syncCursorResponse,
  syncOperationsRequest,
  syncOperationsResponse,
} from '../../shared/schemas/sync.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { getDb } from '../db/client.ts';
import {
  type DbCampaign,
  type DbCampaignMembership,
  type DbCharacter,
  campaignMemberships,
  campaigns,
  characterSkills,
  characterTraits,
  characters,
  combatStates,
  entityTombstones,
  inventoryItems,
} from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { dispatchOperation } from '../services/syncDispatch.ts';

const router = createOpenApiApp();
router.use('/sync/*', requireActiveUser);

const DEFAULT_CURSOR_PAGE_SIZE = 200;
const MAX_CURSOR_PAGE_SIZE = 500;

router.openapi(
  createRoute({
    method: 'post',
    path: '/sync/operations',
    tags: ['sync'],
    security: [{ bearerAuth: [] }],
    summary: 'Replay a batch of client outbox operations against the server',
    request: {
      body: { required: true, content: { 'application/json': { schema: syncOperationsRequest } } },
    },
    responses: {
      200: {
        description: 'Per-op outcomes (in input order)',
        content: { 'application/json': { schema: syncOperationsResponse } },
      },
      401: errorResponse('Unauthorized'),
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { operations } = c.req.valid('json');
    const outcomes = [];
    // Apply ops in array order so e.g. (create trait X, patch trait X)
    // works.  Each op runs in dispatchOperation's own try/catch so a
    // failure on op N does not roll back ops 1..N-1.
    for (const op of operations) {
      outcomes.push(await dispatchOperation({ userId: user.id }, op));
    }
    return c.json({ outcomes }, 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/sync/cursor',
    tags: ['sync'],
    security: [{ bearerAuth: [] }],
    summary: 'Pull rows + tombstones since the per-class cursor positions',
    request: {
      body: { required: true, content: { 'application/json': { schema: syncCursorRequest } } },
    },
    responses: {
      200: {
        description: 'Per-class changes since cursor',
        content: { 'application/json': { schema: syncCursorResponse } },
      },
      401: errorResponse('Unauthorized'),
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { cursors, pageSize } = c.req.valid('json');
    const limit = Math.min(pageSize ?? DEFAULT_CURSOR_PAGE_SIZE, MAX_CURSOR_PAGE_SIZE);

    const accessibleCampaignIds: string[] = await listAccessibleCampaignIds(user.id);
    const accessibleCharacterIds: string[] = await listAccessibleCharacterIds(
      user.id,
      accessibleCampaignIds,
    );

    const changes: SyncCursorChange[] = [];
    const hasMore: Partial<Record<EntityClass, boolean>> = {};
    const nextCursor: Partial<Record<EntityClass, number>> = {};

    for (const cursor of cursors) {
      const slice = await fetchClassChanges({
        entityClass: cursor.entityClass,
        sinceRevision: cursor.sinceRevision,
        limit,
        userId: user.id,
        accessibleCharacterIds,
        accessibleCampaignIds,
      });
      for (const change of slice.changes) changes.push(change);
      hasMore[cursor.entityClass] = slice.hasMore;
      nextCursor[cursor.entityClass] = slice.nextRevision;
    }

    // Sort across classes by revision so the client can apply changes
    // in monotonic order (avoids "tombstone before its create" anomalies
    // when a row was created and then deleted within one batch window).
    changes.sort((a, b) => a.revision - b.revision);

    return c.json(
      {
        changes,
        hasMore: hasMore as Record<EntityClass, boolean>,
        nextCursor: nextCursor as Record<EntityClass, number>,
      },
      200,
    );
  },
);

// ---------- helpers ----------

async function listAccessibleCampaignIds(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ id: campaigns.id })
    .from(campaigns)
    .leftJoin(
      campaignMemberships,
      and(eq(campaignMemberships.campaignId, campaigns.id), eq(campaignMemberships.userId, userId)),
    )
    .where(or(eq(campaigns.ownerId, userId), eq(campaignMemberships.userId, userId)));
  return rows.map((r) => r.id);
}

async function listAccessibleCharacterIds(
  userId: string,
  campaignIds: string[],
): Promise<string[]> {
  const db = getDb();
  const where =
    campaignIds.length === 0
      ? eq(characters.ownerId, userId)
      : or(eq(characters.ownerId, userId), inArray(characters.campaignId, [...campaignIds]));
  const rows = await db.select({ id: characters.id }).from(characters).where(where);
  return rows.map((r) => r.id);
}

interface FetchArgs {
  readonly entityClass: EntityClass;
  readonly sinceRevision: number;
  readonly limit: number;
  readonly userId: string;
  readonly accessibleCharacterIds: string[];
  readonly accessibleCampaignIds: string[];
}

interface FetchResult {
  readonly changes: SyncCursorChange[];
  readonly hasMore: boolean;
  readonly nextRevision: number;
}

async function fetchClassChanges(args: FetchArgs): Promise<FetchResult> {
  const { entityClass, sinceRevision, limit, userId, accessibleCharacterIds } = args;
  const db = getDb();

  // Always pull tombstones for this class first so the merged result
  // includes deletes interleaved with upserts in revision order.
  // Tombstones are scoped by owner_user_id (denormalized at trigger
  // time); campaign-scoped entities also surface to campaign members
  // via the campaign_id column.
  const tombstoneWhere =
    args.accessibleCampaignIds.length > 0
      ? and(
          eq(entityTombstones.entityClass, entityClass),
          gt(entityTombstones.revision, sinceRevision),
          or(
            eq(entityTombstones.ownerUserId, userId),
            inArray(entityTombstones.campaignId, [...args.accessibleCampaignIds]),
          ),
        )
      : and(
          eq(entityTombstones.entityClass, entityClass),
          gt(entityTombstones.revision, sinceRevision),
          eq(entityTombstones.ownerUserId, userId),
        );
  const tombstoneRows = await db
    .select()
    .from(entityTombstones)
    .where(tombstoneWhere)
    .orderBy(asc(entityTombstones.revision))
    .limit(limit);

  const upserts = await fetchClassUpserts({
    entityClass,
    sinceRevision,
    limit,
    userId,
    accessibleCharacterIds,
  });

  const merged: SyncCursorChange[] = [
    ...upserts,
    ...tombstoneRows.map<SyncCursorChange>((t) => ({
      entityClass,
      entityId: t.entityId,
      command: 'delete' as const,
      revision: Number(t.revision),
      deletedAt: t.deletedAt.toISOString(),
    })),
  ];
  merged.sort((a, b) => a.revision - b.revision);
  // Apply the per-class limit AFTER merging so we don't lose tombstones
  // sitting just past the upsert cap (or vice versa).
  const limited = merged.slice(0, limit);
  const hasMore = merged.length > limit;
  const last = limited[limited.length - 1];
  const nextRevision = last ? last.revision : sinceRevision;

  return { changes: limited, hasMore, nextRevision };
}

async function fetchClassUpserts(args: {
  entityClass: EntityClass;
  sinceRevision: number;
  limit: number;
  userId: string;
  accessibleCharacterIds: string[];
}): Promise<SyncCursorChange[]> {
  const { entityClass, sinceRevision, limit, userId, accessibleCharacterIds } = args;
  const db = getDb();

  switch (entityClass) {
    case 'character': {
      const rows = await db
        .select()
        .from(characters)
        .where(
          accessibleCharacterIds.length === 0
            ? and(gt(characters.revision, sinceRevision), eq(characters.ownerId, userId))
            : and(
                gt(characters.revision, sinceRevision),
                inArray(characters.id, [...accessibleCharacterIds]),
              ),
        )
        .orderBy(asc(characters.revision))
        .limit(limit);
      return rows.map((row) => upsertChange('character', row.id, Number(row.revision), row));
    }
    case 'character_trait':
      return await fetchChildClass({
        entityClass,
        table: characterTraits,
        idCol: characterTraits.id,
        revisionCol: characterTraits.revision,
        characterIdCol: characterTraits.characterId,
        accessibleCharacterIds,
        sinceRevision,
        limit,
      });
    case 'character_skill':
      return await fetchChildClass({
        entityClass,
        table: characterSkills,
        idCol: characterSkills.id,
        revisionCol: characterSkills.revision,
        characterIdCol: characterSkills.characterId,
        accessibleCharacterIds,
        sinceRevision,
        limit,
      });
    case 'character_inventory':
      return await fetchChildClass({
        entityClass,
        table: inventoryItems,
        idCol: inventoryItems.id,
        revisionCol: inventoryItems.revision,
        characterIdCol: inventoryItems.characterId,
        accessibleCharacterIds,
        sinceRevision,
        limit,
      });
    case 'character_combat':
      // Combat is 1:1 with its character.  We emit the row keyed by
      // characterId (not combat_states.id) so the client's local
      // store -- which uses characterId as the primary key -- can
      // apply upserts and tombstones with a single lookup.  Tombstone
      // emission for combat also uses characterId (see migration
      // 0005); the two halves stay in sync.
      return await fetchChildClass({
        entityClass,
        table: combatStates,
        idCol: combatStates.id,
        revisionCol: combatStates.revision,
        characterIdCol: combatStates.characterId,
        entityIdField: 'characterId',
        accessibleCharacterIds,
        sinceRevision,
        limit,
      });
    default:
      // Other entity classes (campaigns, library, adventure log) are not
      // synced through this endpoint yet -- the client doesn't drive any
      // mutations for them today.  Returning empty keeps the cursor
      // contract honest.
      return [];
  }
}

interface ChildFetchArgs {
  entityClass: EntityClass;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle table runtime object
  table: any;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle column runtime object
  idCol: any;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle column runtime object
  revisionCol: any;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle column runtime object
  characterIdCol: any;
  /**
   * Field on the returned row to use as the sync `entityId`.  Defaults
   * to `'id'`.  `character_combat` overrides this to `'characterId'`
   * because its local store is keyed on the parent character (1:1
   * relationship); using `combat_states.id` would mean upserts and
   * tombstones never match the local row.
   */
  entityIdField?: 'id' | 'characterId';
  accessibleCharacterIds: string[];
  sinceRevision: number;
  limit: number;
}

async function fetchChildClass(args: ChildFetchArgs): Promise<SyncCursorChange[]> {
  const db = getDb();
  if (args.accessibleCharacterIds.length === 0) return [];
  const rows = (await db
    .select()
    .from(args.table)
    .where(
      and(
        gt(args.revisionCol, args.sinceRevision),
        inArray(args.characterIdCol, [...args.accessibleCharacterIds]),
      ),
    )
    .orderBy(asc(args.revisionCol))
    .limit(args.limit)) as Array<{
    id: string;
    characterId?: string;
    revision: number | bigint;
  }>;
  const idField = args.entityIdField ?? 'id';
  return rows.map((row) => {
    const entityId = idField === 'characterId' ? (row.characterId ?? row.id) : row.id;
    return upsertChange(args.entityClass, entityId, Number(row.revision), row);
  });
}

function upsertChange(
  entityClass: EntityClass,
  entityId: string,
  revision: number,
  data: unknown,
): SyncCursorChange {
  return {
    entityClass,
    entityId,
    command: 'patch',
    revision,
    data: serializeRow(data),
  };
}

/**
 * Convert Drizzle row Date columns to ISO strings so the response
 * round-trips cleanly through JSON without depending on the client's
 * timezone.  Numeric columns (drizzle decimal mapping returns string)
 * are also normalized to numbers where appropriate.
 */
function serializeRow(data: unknown): unknown {
  if (data === null || typeof data !== 'object') return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v instanceof Date) {
      out[k] = v.toISOString();
    } else if (typeof v === 'bigint') {
      out[k] = Number(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Touch unused-import noise so biome doesn't complain.
export const _internalCampaign: typeof campaigns | undefined = undefined as
  | typeof campaigns
  | undefined;
export const _internalDbCampaign: DbCampaign | undefined = undefined;
export const _internalDbMembership: DbCampaignMembership | undefined = undefined;
export const _internalDbCharacter: DbCharacter | undefined = undefined;

export const syncRouter = router;
