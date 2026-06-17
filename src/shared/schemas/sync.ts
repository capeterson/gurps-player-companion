import { z } from 'zod';
import { isoTimestamp, revision, uuid } from './common.ts';

/**
 * Entity classes that participate in sync.  This is the closed set the
 * client and server agree on for outbox routing and cursor backfill.
 */
export const entityClass = z.enum([
  'character',
  'character_trait',
  'character_skill',
  'character_spell',
  'character_inventory',
  'character_combat',
  'campaign',
  'campaign_membership',
  'campaign_library_trait',
  'campaign_library_skill',
  'campaign_library_item',
  'adventure_log',
]);
export type EntityClass = z.infer<typeof entityClass>;

export const operationCommand = z.enum(['create', 'patch', 'delete']);
export type OperationCommand = z.infer<typeof operationCommand>;

/** Status the server returns for each queued operation. */
export const operationStatus = z.enum([
  'applied',
  'rejected',
  'conflict',
  'unauthorized',
  'suspended',
  'stale_base',
  'transient',
]);
export type OperationStatus = z.infer<typeof operationStatus>;

export const operationEnvelope = z.object({
  clientOpId: uuid,
  entityClass,
  entityId: uuid,
  command: operationCommand,
  fieldPath: z.string().max(160).optional(),
  attemptedValue: z.unknown(),
  prevValue: z.unknown().optional(),
  baseRevision: revision.optional(),
  /**
   * Parent character id for child entity classes
   * (`character_trait`, `character_skill`, `character_inventory`,
   * `character_combat`).  The dispatcher's `requireParentId` reads
   * this first; legacy creates that put `characterId` inside
   * `attemptedValue` still work as a fallback.  Including it as a
   * top-level field on the envelope keeps `attemptedValue` /
   * `prevValue` as the raw field values for per-field patches, so
   * orchestrator rollback (which writes `prevValue` back into the
   * Dexie row) doesn't accidentally store a wrapped `{ characterId,
   * value }` object as the field.
   */
  parentId: uuid.optional(),
  /** Validation schema version the client used.  Bumped on breaking changes. */
  validationVersion: z.number().int().nonnegative().default(1),
  /**
   * Client-generated id grouping mutations from one user gesture (e.g. a
   * multi-item inventory move or "revert all temps").  The server threads
   * this through to app.batch_id so all history rows from one gesture share
   * a batch_id and the UI can fold them into one expandable entry.  Omit
   * for singleton edits.
   */
  batchId: uuid.optional(),
  createdAt: isoTimestamp,
});

export const operationOutcome = z.object({
  clientOpId: uuid,
  status: operationStatus,
  /** When applied/conflict, the server's new revision for the entity. */
  newRevision: revision.optional(),
  /** Human-readable reason for non-applied statuses. */
  reason: z.string().optional(),
  /** When status === stale_base or conflict, the latest server entity. */
  latestEntity: z.unknown().optional(),
});

export const syncCursorRequest = z.object({
  cursors: z.array(
    z.object({
      entityClass,
      sinceRevision: revision,
    }),
  ),
  /**
   * Per-class cap on rows returned in this response.  Server clamps to
   * its own internal max (default 500).  Clients keep calling with the
   * advanced cursor until `hasMore[class]` is false for every class.
   */
  pageSize: z.number().int().min(1).max(1000).optional(),
});

export const syncCursorChange = z.object({
  entityClass,
  entityId: uuid,
  command: operationCommand,
  revision,
  data: z.unknown().optional(),
  deletedAt: isoTimestamp.optional(),
});

export const syncCursorResponse = z.object({
  changes: z.array(syncCursorChange),
  /** entityClass → has-more flag.  When true, call again with the new cursor. */
  hasMore: z.record(entityClass, z.boolean()),
  /** entityClass → highest revision returned in this batch.  Use as the next cursor. */
  nextCursor: z.record(entityClass, revision),
});

/** /api/v1/sync/operations request: a batch of envelopes (max 50). */
export const syncOperationsRequest = z.object({
  operations: z.array(operationEnvelope).min(1).max(50),
});

/** /api/v1/sync/operations response: per-op outcomes in the same order. */
export const syncOperationsResponse = z.object({
  outcomes: z.array(operationOutcome),
});

export type OperationEnvelope = z.infer<typeof operationEnvelope>;
export type OperationOutcome = z.infer<typeof operationOutcome>;
export type SyncCursorRequest = z.infer<typeof syncCursorRequest>;
export type SyncCursorResponse = z.infer<typeof syncCursorResponse>;
export type SyncCursorChange = z.infer<typeof syncCursorChange>;
export type SyncOperationsRequest = z.infer<typeof syncOperationsRequest>;
export type SyncOperationsResponse = z.infer<typeof syncOperationsResponse>;
