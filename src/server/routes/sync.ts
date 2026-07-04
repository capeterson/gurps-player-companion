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
  characterSpells,
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
      outcomes.push(await dispatchOperation({ userId: user.id, batchId: op.batchId }, op));
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
    const characterAccess = await loadCharacterAccess(user.id, accessibleCampaignIds);
    // Every character the viewer can see at all (full or minimal). Used
    // for the `character` upsert query — minimal rows are projected to
    // public-only columns before being emitted (see `projectCharacterRow`).
    const accessibleCharacterIds: string[] = [...characterAccess.keys()];
    // Subset that the viewer is allowed to see in detail. Child entity
    // classes (traits / skills / inventory / combat) are scoped to this
    // list so a non-GM member of a campaign with shareCharacterSheets=false
    // doesn't pull other players' private rows down to IndexedDB.
    const fullAccessCharacterIds: string[] = [...characterAccess.entries()]
      .filter(([, mode]) => mode === 'full')
      .map(([id]) => id);

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
        fullAccessCharacterIds,
        characterAccess,
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
        // Authoritative access sets — already computed above for this
        // same request, zero extra queries. Lets the client prune local
        // rows that fell out of access (tombstones alone can't reach
        // ex-members: they're scoped to campaigns the viewer *currently*
        // belongs to).
        accessible: {
          characterIds: accessibleCharacterIds,
          campaignIds: accessibleCampaignIds,
        },
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

export type CharacterAccessMode = 'full' | 'minimal';

export interface CharacterAccessInputCharacter {
  readonly id: string;
  readonly ownerId: string;
  readonly campaignId: string | null;
}

export interface CharacterAccessInputCampaign {
  readonly id: string;
  readonly ownerId: string;
  readonly shareCharacterSheets: boolean;
}

/**
 * Pure decision for "what level of detail can `viewerId` pull for
 * each character via /sync/cursor?"  Extracted so the sync gate is
 * unit-testable without standing up Postgres.
 *
 *   `full`    — owner, campaign GM (campaign owner), or member of a
 *               campaign with shareCharacterSheets=true.
 *   `minimal` — non-GM member of a campaign with shareCharacterSheets=false.
 *
 * Owner and GM checks short-circuit `share`, so toggling the campaign
 * flag never restricts the GM's own visibility.  Mirrors the
 * `shouldUseMinimalView` gate on `GET /characters/{id}`.
 *
 * Characters whose campaignId is null and aren't owned by the viewer
 * are NOT included in the result — `listAccessibleCampaignIds` should
 * never have surfaced them in the first place, but we defend anyway.
 */
export function decideCharacterAccess(args: {
  viewerId: string;
  characters: readonly CharacterAccessInputCharacter[];
  campaigns: readonly CharacterAccessInputCampaign[];
}): Map<string, CharacterAccessMode> {
  const campaignById = new Map<string, CharacterAccessInputCampaign>();
  for (const c of args.campaigns) campaignById.set(c.id, c);

  const out = new Map<string, CharacterAccessMode>();
  for (const r of args.characters) {
    if (r.ownerId === args.viewerId) {
      out.set(r.id, 'full');
      continue;
    }
    if (r.campaignId === null) continue;
    const camp = campaignById.get(r.campaignId);
    if (!camp) continue;
    if (camp.ownerId === args.viewerId) {
      out.set(r.id, 'full');
      continue;
    }
    out.set(r.id, camp.shareCharacterSheets ? 'full' : 'minimal');
  }
  return out;
}

async function loadCharacterAccess(
  userId: string,
  campaignIds: string[],
): Promise<Map<string, CharacterAccessMode>> {
  const db = getDb();
  const where =
    campaignIds.length === 0
      ? eq(characters.ownerId, userId)
      : or(eq(characters.ownerId, userId), inArray(characters.campaignId, [...campaignIds]));
  const rows = await db
    .select({
      id: characters.id,
      ownerId: characters.ownerId,
      campaignId: characters.campaignId,
    })
    .from(characters)
    .where(where);

  const relevantCampaignIds = [
    ...new Set(rows.map((r) => r.campaignId).filter((id): id is string => id !== null)),
  ];
  let campaignRows: CharacterAccessInputCampaign[] = [];
  if (relevantCampaignIds.length > 0) {
    campaignRows = await db
      .select({
        id: campaigns.id,
        ownerId: campaigns.ownerId,
        shareCharacterSheets: campaigns.shareCharacterSheets,
      })
      .from(campaigns)
      .where(inArray(campaigns.id, relevantCampaignIds));
  }
  return decideCharacterAccess({
    viewerId: userId,
    characters: rows,
    campaigns: campaignRows,
  });
}

interface FetchArgs {
  readonly entityClass: EntityClass;
  readonly sinceRevision: number;
  readonly limit: number;
  readonly userId: string;
  /** Every character the viewer can see (full + minimal). */
  readonly accessibleCharacterIds: string[];
  /** Subset where the viewer can see private child rows. */
  readonly fullAccessCharacterIds: string[];
  readonly characterAccess: Map<string, CharacterAccessMode>;
  readonly accessibleCampaignIds: string[];
}

interface FetchResult {
  readonly changes: SyncCursorChange[];
  readonly hasMore: boolean;
  readonly nextRevision: number;
}

async function fetchClassChanges(args: FetchArgs): Promise<FetchResult> {
  const {
    entityClass,
    sinceRevision,
    limit,
    userId,
    accessibleCharacterIds,
    fullAccessCharacterIds,
    characterAccess,
  } = args;
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
    fullAccessCharacterIds,
    characterAccess,
    accessibleCampaignIds: args.accessibleCampaignIds,
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
  // `merged.length > limit` alone under-reports: each source query is
  // itself capped at `limit`, so when either one came back full there
  // may be rows past its own SQL LIMIT even though the merged list
  // fits.  Reporting hasMore=false in that case stalls the client's
  // backfill mid-stream until some unrelated change bumps a revision.
  const hasMore = merged.length > limit || tombstoneRows.length >= limit || upserts.length >= limit;
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
  fullAccessCharacterIds: string[];
  characterAccess: Map<string, CharacterAccessMode>;
  accessibleCampaignIds: string[];
}): Promise<SyncCursorChange[]> {
  const {
    entityClass,
    sinceRevision,
    limit,
    userId,
    accessibleCharacterIds,
    fullAccessCharacterIds,
    characterAccess,
    accessibleCampaignIds,
  } = args;
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
      return rows.map((row) => {
        // For characters the viewer is only allowed to see in minimal
        // form, blank out every private column before emission so the
        // viewer's IndexedDB can't be used to recover hidden stats /
        // notes / dismissed warnings.  The owner column stays so the
        // client's `shouldUseMinimalView`-equivalent gate works.
        const access = characterAccess.get(row.id) ?? 'full';
        const projected = access === 'minimal' ? projectCharacterRow(row) : row;
        return upsertChange('character', row.id, Number(row.revision), projected);
      });
    }
    case 'character_trait':
      return await fetchChildClass({
        entityClass,
        table: characterTraits,
        idCol: characterTraits.id,
        revisionCol: characterTraits.revision,
        characterIdCol: characterTraits.characterId,
        accessibleCharacterIds: fullAccessCharacterIds,
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
        accessibleCharacterIds: fullAccessCharacterIds,
        sinceRevision,
        limit,
      });
    case 'character_spell':
      return await fetchChildClass({
        entityClass,
        table: characterSpells,
        idCol: characterSpells.id,
        revisionCol: characterSpells.revision,
        characterIdCol: characterSpells.characterId,
        accessibleCharacterIds: fullAccessCharacterIds,
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
        accessibleCharacterIds: fullAccessCharacterIds,
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
        accessibleCharacterIds: fullAccessCharacterIds,
        sinceRevision,
        limit,
      });
    case 'campaign': {
      // Campaigns sync READ-ONLY: the client needs them locally so the
      // minimal-view sweep can evaluate `shareCharacterSheets` and so
      // campaign names resolve offline.  Mutations still go through the
      // REST routes; there is no /sync/operations dispatcher for them.
      if (accessibleCampaignIds.length === 0) return [];
      const rows = await db
        .select()
        .from(campaigns)
        .where(
          and(
            gt(campaigns.revision, sinceRevision),
            inArray(campaigns.id, [...accessibleCampaignIds]),
          ),
        )
        .orderBy(asc(campaigns.revision))
        .limit(limit);
      return rows.map((row) => upsertChange('campaign', row.id, Number(row.revision), row));
    }
    default:
      // Other entity classes (library, adventure log) are not synced
      // through this endpoint yet -- the client doesn't drive any
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
 * Project a character row down to the public "readily apparent" columns
 * for sync emission to a non-GM viewer of a campaign with
 * shareCharacterSheets=false. The viewer's IndexedDB will receive a row
 * with the right id / ownerId / campaignId / public identity bits, but
 * with private fields blanked to safe defaults so derived stats and
 * personal notes can't be reconstructed locally.
 *
 * Owner+ownerId stays so the client-side gate (`shouldUseMinimalView`
 * mirror in CharacterSheetPage) recognises this as someone else's
 * character and renders the minimal view instead of the full sheet.
 */
function projectCharacterRow(row: DbCharacter): DbCharacter {
  return {
    ...row,
    // Stat defaults so the row stays schema-valid (notNull columns).
    // The minimal view never reads these, but if a future code path
    // ever falls through to buildCharacterDetail with this row it
    // produces a "10/10/10/10 baseline character" rather than leaking
    // the real numbers.
    st: 10,
    dx: 10,
    iq: 10,
    ht: 10,
    hpMod: 0,
    willMod: 0,
    perMod: 0,
    fpMod: 0,
    speedQuarterMod: 0,
    moveMod: 0,
    tempSt: 0,
    tempDx: 0,
    tempIq: 0,
    tempHt: 0,
    tempHpMod: 0,
    tempWillMod: 0,
    tempPerMod: 0,
    tempFpMod: 0,
    tempSpeedQuarterMod: 0,
    tempMoveMod: 0,
    dismissedWarnings: [],
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
