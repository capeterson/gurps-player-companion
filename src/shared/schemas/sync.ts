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
  /** Validation schema version the client used.  Bumped on breaking changes. */
  validationVersion: z.number().int().nonnegative().default(1),
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
});

export const syncCursorResponse = z.object({
  changes: z.array(
    z.object({
      entityClass,
      entityId: uuid,
      command: operationCommand,
      revision,
      data: z.unknown().optional(),
      deletedAt: isoTimestamp.optional(),
    }),
  ),
});

export type OperationEnvelope = z.infer<typeof operationEnvelope>;
export type OperationOutcome = z.infer<typeof operationOutcome>;
export type SyncCursorRequest = z.infer<typeof syncCursorRequest>;
export type SyncCursorResponse = z.infer<typeof syncCursorResponse>;
