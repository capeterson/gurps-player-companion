import { raceName } from '../../shared/domain/race.ts';
import { activeEffectDefinitionOut } from '../../shared/schemas/activeEffects.ts';
import { HUMAN_RACE } from '../../shared/schemas/race.ts';
import { campaignLibraryActiveEffects } from '../db/schema.ts';
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

import { createRoute } from '@hono/zod-openapi';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { campaignHouseRules } from '../../shared/schemas/campaign.ts';
import {
  type EntityClass,
  type LibraryEntityClass,
  type OperationEnvelope,
  type OperationOutcome,
  type SyncCursorChange,
  type SyncCursorRequest,
  type SyncCursorResponse,
  syncCursorRequest,
  syncCursorResponse,
  syncOperationsRequest,
  syncOperationsResponse,
} from '../../shared/schemas/sync.ts';
import {
  CLIENT_OUTDATED_ERROR,
  MIN_SUPPORTED_SYNC_PROTOCOL,
  SYNC_PROTOCOL_HEADER,
  SYNC_PROTOCOL_VERSION,
  parseSyncProtocol,
} from '../../shared/syncProtocol.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { getDb } from '../db/client.ts';
import {
  type DbCharacter,
  campaignMemberships,
  campaigns,
  characters,
  combatStates,
  entityTombstones,
} from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { CHARACTER_CHILD_TABLES } from '../services/characterChildren.ts';
import { withLibraryMechanics } from '../services/libraryMechanics.ts';
import {
  createDispatchBatch,
  dispatchOperation,
  publishBatchInvalidations,
} from '../services/syncDispatch.ts';
import { logTelemetryEvent, syncBatchSize, syncCursorRows, syncOutcomes } from '../telemetry.ts';
import { libraryEntityConfig, libraryRowOut } from './campaignLibraryEntities.ts';

const router = createOpenApiApp();
// Version gate first: an outdated build must learn to reload even when its
// token has expired, and no queued operation may be interpreted (or rejected
// and rolled back) in a shape this server no longer understands.
router.use('/sync/*', async (c, next) => {
  const clientProtocol = parseSyncProtocol(c.req.header(SYNC_PROTOCOL_HEADER));
  c.header(SYNC_PROTOCOL_HEADER, String(SYNC_PROTOCOL_VERSION));
  if (clientProtocol < MIN_SUPPORTED_SYNC_PROTOCOL) {
    return c.json(
      {
        error: CLIENT_OUTDATED_ERROR,
        clientProtocol,
        minProtocol: MIN_SUPPORTED_SYNC_PROTOCOL,
        serverProtocol: SYNC_PROTOCOL_VERSION,
      },
      426,
    );
  }
  if (clientProtocol > SYNC_PROTOCOL_VERSION) {
    // A newer client reached an older replica (rolling deploy or rollback).
    // Nothing was read; the client retries and reaches a current replica.
    c.header('retry-after', '5');
    return c.json({ error: 'server_outdated' }, 503);
  }
  await next();
});
router.use('/sync/*', requireActiveUser);

/** Coarse categories only: the underlying reason can contain user data. */
export function syncOutcomeReason(outcome: OperationOutcome): string {
  if (outcome.status === 'unauthorized') return 'access_denied';
  if (outcome.status === 'stale_base') return 'revision_mismatch';
  if (outcome.status === 'conflict') return 'conflict';
  if (outcome.status === 'transient') return 'retryable_failure';
  if (outcome.status !== 'rejected') return 'applied';
  const reason = outcome.reason ?? '';
  if (/parent|belongs to|not found/i.test(reason)) return 'missing_or_invalid_reference';
  if (/read.only|not writable|not allowed|forbidden/i.test(reason)) return 'write_restricted';
  if (/invalid|required|must|expected|validation/i.test(reason)) return 'invalid_input';
  return 'other_rejection';
}

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
      426: errorResponse('Client sync protocol is older than the server supports; reload the app'),
      503: errorResponse('Client sync protocol is newer than this server; retry later'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { operations } = c.req.valid('json');
    const outcomes = [];
    syncBatchSize.record(operations.length);
    // Apply ops in array order so e.g. (create trait X, patch trait X)
    // works.  Each op runs in dispatchOperation's own try/catch so a
    // failure on op N does not roll back ops 1..N-1.
    //
    // Rapid same-entity edits (e.g. add item -> mark as weapon -> tweak
    // stats) get enqueued client-side with the SAME baseRevision, since
    // nothing has been acked yet to advance it. Applying them in one
    // batch would otherwise stale_base every op after the first, once
    // per drain. `chains` fast-forwards each op's baseRevision past
    // revisions produced by earlier applied ops in *this same request*
    // -- those aren't conflicts, they're this client's own prior op in
    // the burst. Per-field coalescing (AGENTS.md rule S3) guarantees no
    // two ops in a burst patch the same field, so array order here is
    // exactly this client's intended order. A foreign write landing
    // mid-batch still pushes the DB revision above the chain's `latest`,
    // so the rewritten base is still stale and stale_base fires as
    // normal -- the client's stale_base self-heal remains the fallback
    // for that case and for bursts spanning more than one 50-op batch.
    const chains = createBatchRevisionChains();
    const batch = createDispatchBatch();
    for (const op of operations) {
      const effective = chains.rewrite(op);
      const outcome = await dispatchOperation(
        { userId: user.id, batchId: op.batchId, batch },
        effective,
      );
      chains.record(op, outcome);
      outcomes.push(outcome);
      if (outcome.status !== 'applied') {
        logTelemetryEvent(
          'sync.operation.not_applied',
          {
            entity_class: op.entityClass,
            operation: op.command,
            outcome: outcome.status,
            reason: syncOutcomeReason(outcome),
            request_id: c.get('requestId'),
          },
          'WARN',
        );
      }
      syncOutcomes.add(1, {
        entity_class: op.entityClass,
        operation: op.command,
        outcome: outcome.status,
      });
    }
    await publishBatchInvalidations(user.id, batch);
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
      426: errorResponse('Client sync protocol is older than the server supports; reload the app'),
      503: errorResponse('Client sync protocol is newer than this server; retry later'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { cursors, pageSize } = c.req.valid('json');
    const limit = Math.min(pageSize ?? DEFAULT_CURSOR_PAGE_SIZE, MAX_CURSOR_PAGE_SIZE);

    // Read tombstones and upserts from one snapshot. A newer upsert must
    // not advance a cursor past a tombstone committed after the batch read.
    const response = await getDb().transaction((tx) => pullCursor(tx, user.id, cursors, limit), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
    syncCursorRows.record(response.changes.length);
    return c.json(response, 200);
  },
);

// ---------- helpers ----------

interface RevisionChain {
  /** The ORIGINAL (pre-rewrite) baseRevision of the op that founded this chain. */
  readonly firstBase: number;
  /** newRevision of the most recent applied patch in the chain. */
  latest: number;
}

/**
 * Tracks per-entity revision chains produced by earlier ops in one
 * `/sync/operations` request, so later same-entity patches stamped
 * against the same (now-stale) base don't come back `stale_base` one
 * at a time across repeated drains. See the call site in the POST
 * handler above for the full rationale.
 *
 * Deliberately excludes `create` (and `delete`) outcomes:
 *   - A patch enqueued right after an unacked create carries
 *     `baseRevision === undefined` and already skips the server's
 *     stale check entirely, so seeding the chain from a create buys
 *     nothing in the normal flow.
 *   - A *replayed* create (`resolveReplayedCreate`) returns the row's
 *     CURRENT revision, which may already embed a concurrent foreign
 *     write. Seeding `latest` from it could fast-forward a later
 *     patch's base past that foreign write and mask a real conflict.
 * Excluding creates keeps the invariant provable: every revision in
 * `(firstBase, latest]` was produced by a patch this same client
 * queued and this same request applied.
 */
export function createBatchRevisionChains() {
  const chains = new Map<string, RevisionChain>();

  const key = (op: OperationEnvelope) => `${op.entityClass}|${op.entityId}`;

  return {
    /**
     * Returns the envelope to actually dispatch: a copy with
     * `baseRevision` fast-forwarded to the chain's `latest` when the
     * op's original base falls within `[firstBase, latest)`, otherwise
     * the original op untouched.
     */
    rewrite(op: OperationEnvelope): OperationEnvelope {
      if (op.command !== 'patch' || op.baseRevision === undefined) return op;
      const chain = chains.get(key(op));
      if (!chain) return op;
      if (op.baseRevision >= chain.firstBase && op.baseRevision < chain.latest) {
        return { ...op, baseRevision: chain.latest };
      }
      return op;
    },

    /**
     * Records an outcome to extend/seed the chain. MUST be called with
     * the ORIGINAL op (not the `rewrite`d copy) so `firstBase` reflects
     * the client's true original base, not an already-fast-forwarded one.
     */
    record(op: OperationEnvelope, outcome: OperationOutcome): void {
      if (op.command !== 'patch' || op.baseRevision === undefined) return;
      if (outcome.status !== 'applied' || typeof outcome.newRevision !== 'number') return;
      const k = key(op);
      const existing = chains.get(k);
      if (!existing) {
        chains.set(k, { firstBase: op.baseRevision, latest: outcome.newRevision });
      } else {
        existing.latest = Math.max(existing.latest, outcome.newRevision);
      }
    },
  };
}

type CursorDb = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

async function pullCursor(
  db: CursorDb,
  userId: string,
  cursors: SyncCursorRequest['cursors'],
  limit: number,
): Promise<SyncCursorResponse> {
  const accessibleCampaignIds = await listAccessibleCampaignIds(db, userId);
  const characterAccess = await loadCharacterAccess(db, userId, accessibleCampaignIds);
  // The character class includes minimal rows projected to public identity.
  // Private child rows are scoped to characters with full access.
  const accessibleCharacterIds = [...characterAccess.keys()];
  const fullAccessCharacterIds = [...characterAccess.entries()]
    .filter(([, mode]) => mode === 'full')
    .map(([id]) => id);

  const tombstones = await fetchTombstones(db, cursors, limit, userId, accessibleCampaignIds);
  const changes: SyncCursorChange[] = [];
  const hasMore: Partial<Record<EntityClass, boolean>> = {};
  const nextCursor: Partial<Record<EntityClass, number>> = {};

  for (const [index, cursor] of cursors.entries()) {
    const upserts = await fetchClassUpserts(db, {
      ...cursor,
      limit,
      userId,
      accessibleCharacterIds,
      fullAccessCharacterIds,
      characterAccess,
      accessibleCampaignIds,
    });
    const slice = mergeClassChanges(
      upserts,
      tombstones.get(index + 1) ?? [],
      limit,
      cursor.sinceRevision,
    );
    for (const change of slice.changes) changes.push(change);
    hasMore[cursor.entityClass] = slice.hasMore;
    nextCursor[cursor.entityClass] = slice.nextRevision;
  }

  // Clients apply changes in revision order across all classes.
  changes.sort((a, b) => a.revision - b.revision);
  return {
    changes,
    hasMore: hasMore as Record<EntityClass, boolean>,
    nextCursor: nextCursor as Record<EntityClass, number>,
    // Ex-members use these access sets to prune locally cached rows.
    accessible: { characterIds: accessibleCharacterIds, campaignIds: accessibleCampaignIds },
  };
}

async function listAccessibleCampaignIds(db: CursorDb, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: campaigns.id })
    .from(campaigns)
    .leftJoin(
      campaignMemberships,
      and(eq(campaignMemberships.campaignId, campaigns.id), eq(campaignMemberships.userId, userId)),
    )
    .where(
      and(
        isNull(campaigns.deletedAt),
        or(eq(campaigns.ownerId, userId), eq(campaignMemberships.userId, userId)),
      ),
    );
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
  readonly allowGmCharacterEditing?: boolean;
  readonly viewerRole?: 'owner' | 'manager' | 'member' | null;
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
    if (camp.allowGmCharacterEditing && camp.viewerRole === 'manager') {
      out.set(r.id, 'full');
      continue;
    }
    out.set(r.id, camp.shareCharacterSheets ? 'full' : 'minimal');
  }
  return out;
}

async function loadCharacterAccess(
  db: CursorDb,
  userId: string,
  campaignIds: string[],
): Promise<Map<string, CharacterAccessMode>> {
  // Recycle-binned characters are absent from the access set, so every device
  // prunes them locally; restoring one re-enters the set and backfills.
  const where = and(
    isNull(characters.deletedAt),
    campaignIds.length === 0
      ? eq(characters.ownerId, userId)
      : or(eq(characters.ownerId, userId), inArray(characters.campaignId, [...campaignIds])),
  );
  const rows = await db
    .select({
      id: characters.id,
      ownerId: characters.ownerId,
      campaignId: characters.campaignId,
    })
    .from(characters) // recycle-bin: filtered by the deletedAt predicate in `where` above
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
        allowGmCharacterEditing: campaigns.allowGmCharacterEditing,
        viewerRole: campaignMemberships.role,
      })
      .from(campaigns) // recycle-bin: access sets are already filtered; this reads rows of those sets
      .leftJoin(
        campaignMemberships,
        and(
          eq(campaignMemberships.campaignId, campaigns.id),
          eq(campaignMemberships.userId, userId),
        ),
      )
      .where(inArray(campaigns.id, relevantCampaignIds));
  }
  return decideCharacterAccess({
    viewerId: userId,
    characters: rows,
    campaigns: campaignRows,
  });
}

async function fetchTombstones(
  db: CursorDb,
  cursors: SyncCursorRequest['cursors'],
  limit: number,
  userId: string,
  accessibleCampaignIds: string[],
): Promise<Map<number, SyncCursorChange[]>> {
  const byCursor = new Map<number, SyncCursorChange[]>();
  if (cursors.length === 0) return byCursor;

  const classes = cursors.map(({ entityClass }) => entityClass);
  const revisions = cursors.map(({ sinceRevision }) => sinceRevision);
  // Give the scope indexes a constant revision bound as well as the
  // exact per-cursor bound in the join.
  const minRevision = revisions.reduce((min, revision) => Math.min(min, revision));
  const ownerScope = sql`t.owner_user_id = ${userId}`;
  const scope = accessibleCampaignIds.length
    ? sql`(${ownerScope} or t.campaign_id = any(${sql.param(accessibleCampaignIds)}::uuid[]))`
    : ownerScope;

  // Partition by input position so repeated classes with different cursor
  // revisions keep their individual page limits.
  const { rows } = await db.execute<{
    cursor_position: number;
    entity_class: EntityClass;
    entity_id: string;
    revision: string;
    deleted_at: string;
  }>(sql`
    select cursor_position, entity_class, entity_id, revision, deleted_at
    from (
      select c.position::int as cursor_position, t.entity_class, t.entity_id, t.revision, t.deleted_at,
        row_number() over (partition by c.position order by t.revision) as rank
      from ${entityTombstones} t
      join unnest(${sql.param(classes)}::text[], ${sql.param(revisions)}::bigint[])
        with ordinality as c(entity_class, since_revision, position)
        on t.entity_class = c.entity_class and t.revision > c.since_revision
      where t.revision > ${minRevision} and ${scope}
    ) ranked
    where rank <= ${limit}
  `);

  for (const row of rows) {
    const change: SyncCursorChange = {
      entityClass: row.entity_class,
      entityId: row.entity_id,
      command: 'delete',
      revision: Number(row.revision),
      deletedAt: new Date(row.deleted_at).toISOString(),
    };
    const slice = byCursor.get(row.cursor_position);
    if (slice) slice.push(change);
    else byCursor.set(row.cursor_position, [change]);
  }
  return byCursor;
}

function mergeClassChanges(
  upserts: SyncCursorChange[],
  tombstones: SyncCursorChange[],
  limit: number,
  sinceRevision: number,
) {
  const merged = [...upserts, ...tombstones];
  merged.sort((a, b) => a.revision - b.revision);
  // Apply the per-class limit AFTER merging so we don't lose tombstones
  // sitting just past the upsert cap (or vice versa).
  const limited = merged.slice(0, limit);
  // `merged.length > limit` alone under-reports: each source query is
  // itself capped at `limit`, so when either one came back full there
  // may be rows past its own SQL LIMIT even though the merged list
  // fits.  Reporting hasMore=false in that case stalls the client's
  // backfill mid-stream until some unrelated change bumps a revision.
  const hasMore = merged.length > limit || tombstones.length >= limit || upserts.length >= limit;
  const last = limited[limited.length - 1];
  const nextRevision = last ? last.revision : sinceRevision;

  return { changes: limited, hasMore, nextRevision };
}

async function fetchClassUpserts(
  db: CursorDb,
  args: {
    entityClass: EntityClass;
    sinceRevision: number;
    limit: number;
    userId: string;
    accessibleCharacterIds: string[];
    fullAccessCharacterIds: string[];
    characterAccess: Map<string, CharacterAccessMode>;
    accessibleCampaignIds: string[];
  },
): Promise<SyncCursorChange[]> {
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
  switch (entityClass) {
    case 'character': {
      const rows = await db
        .select()
        .from(characters)
        .where(
          accessibleCharacterIds.length === 0
            ? and(
                gt(characters.revision, sinceRevision),
                isNull(characters.deletedAt),
                eq(characters.ownerId, userId),
              )
            : and(
                gt(characters.revision, sinceRevision),
                isNull(characters.deletedAt),
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
        return upsertChange(
          'character',
          row.id,
          Number(row.revision),
          withoutRecycleMarkers(projected),
        );
      });
    }
    case 'character_trait':
    case 'character_skill':
    case 'character_spell':
    case 'character_language':
    case 'character_technique':
    case 'character_inventory':
    case 'character_loadout': {
      const table = CHARACTER_CHILD_TABLES[entityClass];
      const changes = await fetchChildClass(db, {
        entityClass,
        table,
        idCol: table.id,
        revisionCol: table.revision,
        characterIdCol: table.characterId,
        accessibleCharacterIds: fullAccessCharacterIds,
        sinceRevision,
        limit,
      });
      // Trait and skill rows carry their library mechanics declarations.
      return entityClass === 'character_trait' || entityClass === 'character_skill'
        ? await withLibraryMechanics(changes, accessibleCampaignIds)
        : changes;
    }
    case 'character_combat':
      // Combat is 1:1 with its character.  We emit the row keyed by
      // characterId (not combat_states.id) so the client's local
      // store -- which uses characterId as the primary key -- can
      // apply upserts and tombstones with a single lookup.  Tombstone
      // emission for combat also uses characterId (see migration
      // 0005); the two halves stay in sync.
      return await fetchChildClass(db, {
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
        .select({ campaign: campaigns, viewerRole: campaignMemberships.role })
        .from(campaigns)
        .leftJoin(
          campaignMemberships,
          and(
            eq(campaignMemberships.campaignId, campaigns.id),
            eq(campaignMemberships.userId, userId),
          ),
        )
        .where(
          and(
            gt(campaigns.revision, sinceRevision),
            isNull(campaigns.deletedAt),
            inArray(campaigns.id, [...accessibleCampaignIds]),
          ),
        )
        .orderBy(asc(campaigns.revision))
        .limit(limit);
      const definitions = rows.length
        ? await db
            .select()
            .from(campaignLibraryActiveEffects)
            .where(
              inArray(
                campaignLibraryActiveEffects.campaignId,
                rows.map((r) => r.campaign.id),
              ),
            )
        : [];
      return rows.map(({ campaign, viewerRole }) =>
        upsertChange('campaign', campaign.id, Number(campaign.revision), {
          ...withoutRecycleMarkers(campaign),
          activeEffectDefinitions: definitions
            .filter(
              (d) => d.campaignId === campaign.id && (campaign.ownerId === userId || !d.restricted),
            )
            .map((d) =>
              activeEffectDefinitionOut.parse({
                ...d,
                revision: Number(d.revision),
                createdAt: d.createdAt.toISOString(),
                updatedAt: d.updatedAt.toISOString(),
              }),
            ),
          houseRules: campaignHouseRules.parse(campaign.houseRules),
          viewerRole: campaign.ownerId === userId ? 'owner' : viewerRole,
        }),
      );
    }
    case 'campaign_library_trait':
    case 'campaign_library_skill':
    case 'campaign_library_spell':
    case 'campaign_library_item':
    case 'campaign_library_language':
    case 'campaign_library_technique':
    case 'campaign_library_style':
    case 'campaign_library_enchantment':
    case 'campaign_library_race':
    case 'campaign_library_active_effect':
    case 'campaign_library_source':
    case 'campaign_library_modifier':
      return await fetchLibraryClass(
        db,
        entityClass,
        sinceRevision,
        limit,
        accessibleCampaignIds,
        userId,
      );
    default:
      // Other entity classes (campaign membership, adventure log) are not
      // synced through this endpoint.  Returning empty keeps the cursor
      // contract honest.
      return [];
  }
}

/**
 * Library rows are campaign content every member may read (matching
 * `GET /campaigns/{id}/library`), so they are scoped by campaign access
 * rather than character access. Rows carry their REST projection plus
 * `revision`, the same shape the client stores and compares on stale_base.
 */
async function fetchLibraryClass(
  db: CursorDb,
  entityClass: LibraryEntityClass,
  sinceRevision: number,
  limit: number,
  accessibleCampaignIds: string[],
  userId: string,
): Promise<SyncCursorChange[]> {
  if (accessibleCampaignIds.length === 0) return [];
  const cfg = libraryEntityConfig(entityClass);
  // biome-ignore lint/suspicious/noExplicitAny: generic library table runtime object
  const table = cfg.table as any;
  const rows = (await db
    .select({ row: table, ownerId: campaigns.ownerId })
    .from(table)
    .innerJoin(campaigns, eq(cfg.table.campaignId, campaigns.id)) // recycle-bin: access sets are already filtered; this reads rows of those sets
    .where(
      and(
        gt(table.revision, sinceRevision),
        inArray(cfg.table.campaignId, [...accessibleCampaignIds]),
      ),
    )
    .orderBy(asc(table.revision))
    .limit(limit)) as Array<{
    row: { id: string; revision: unknown; restricted?: boolean };
    ownerId: string;
  }>;
  return rows.map(({ row, ownerId }) =>
    row.restricted && ownerId !== userId
      ? {
          entityClass,
          entityId: row.id,
          command: 'delete' as const,
          revision: Number(row.revision),
          deletedAt: new Date().toISOString(),
        }
      : upsertChange(entityClass, row.id, Number(row.revision), libraryRowOut(cfg, row)),
  );
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

async function fetchChildClass(db: CursorDb, args: ChildFetchArgs): Promise<SyncCursorChange[]> {
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
 * Project a character row down to the **identity-only** payload for sync
 * emission to a non-GM viewer of a campaign with
 * shareCharacterSheets=false. The viewer's IndexedDB receives a row that
 * carries id / ownerId / campaignId / public identity bits (name / height /
 * weight / age / birthdate / appearance), plus the
 * schema-default values for the columns the row still needs to satisfy
 * `LocalCharacter`. Every private column is set to its safe default so:
 *
 *   - `buildCharacterDetail` (used on the client) produces only the
 *     10/10/10/10 baseline derived stats if any code path falls through
 *     to it, never the real numbers that were cached before access was
 *     downgraded;
 *   - the orchestrator's `applyServerRow` overwrites the local Dexie row
 *     with this masked payload, purging the stale `st=15 / hpMod=2 /
 *     tempEffects=[real buffs]` that were synced while the viewer had
 *     full access (the previous behaviour only blanked fields when the
 *     cursor re-emitted the row, which it doesn't do on a share-flag
 *     flip because the character row's own revision doesn't advance).
 *
 * This is the **server half** of the share gate. The client half
 * (`enforceMinimalViewLocally`) mirrors it by rewriting the cached row
 * down to the same identity-only set after every cursor pull; both
 * must stay in lockstep per AGENTS.md's share-gate invariant.
 */
function projectCharacterRow(row: DbCharacter): DbCharacter & { raceName: string } {
  // Drop every private column by replacing the row with a mask that
  // supplies the schema defaults for NOT NULL numeric / jsonb columns.
  return {
    id: row.id,
    ownerId: row.ownerId,
    campaignId: row.campaignId,
    name: row.name,
    height: row.height,
    weight: row.weight,
    age: row.age,
    birthdate: row.birthdate,
    appearance: row.appearance,
    portraitAssetId: row.portraitAssetId,
    // Stat defaults so the row stays schema-valid (notNull columns).
    // The minimal view never reads these, but if a future code path
    // ever falls through to buildCharacterDetail with this row it
    // produces a "10/10/10/10 baseline character" rather than leaking
    // the real numbers.
    st: 10,
    dx: 10,
    iq: 10,
    ht: 10,
    earnedPoints: 0,
    hpMod: 0,
    willMod: 0,
    perMod: 0,
    fpMod: 0,
    speedQuarterMod: 0,
    moveMod: 0,
    // Share-gate critical: a minimal viewer must never receive another
    // player's named/manual temp effects or dismissed warnings, so
    // these collapse to empty rather than passing the real lists through.
    tempEffects: [],
    race: structuredClone(HUMAN_RACE),
    raceName: raceName(row.race),
    activeEffects: [],
    dismissedWarnings: [],
    activeConditionGroups: [],
    lastEquipmentSwitch: null,
    deletedAt: null,
    deletedBy: null,
    recycledFromCampaignId: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

/**
 * Convert Drizzle row Date columns to ISO strings so the response
 * round-trips cleanly through JSON without depending on the client's
 * timezone.  Numeric columns (drizzle decimal mapping returns string)
 * are also normalized to numbers where appropriate.
 */
/** Recycle-bin bookkeeping is server-only; clients learn of a bin by loss of access. */
function withoutRecycleMarkers<T extends object>(
  row: T,
): Omit<T, 'deletedAt' | 'deletedBy' | 'recycledFromCampaignId'> {
  const {
    deletedAt: _a,
    deletedBy: _b,
    recycledFromCampaignId: _c,
    ...rest
  } = row as T & Record<string, unknown>;
  return rest as never;
}

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

export const syncRouter = router;
