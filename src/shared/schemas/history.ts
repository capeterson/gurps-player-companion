import { z } from 'zod';
import { isoTimestamp, uuid } from './common.ts';
import { entityClass } from './sync.ts';

export const historyScope = z.enum(['character', 'campaign']);
export const historyOp = z.enum(['insert', 'update', 'delete']);

/**
 * One item in a history feed, as returned by GET /characters/:id/history
 * and GET /campaigns/:id/history.  `old_row` and `new_row` are only
 * included when the client requests ?detail=1 and the viewer has full
 * access.
 */
export const historyEventOut = z.object({
  id: uuid,
  revision: z.number(),
  scope: historyScope,
  entityClass,
  entityId: uuid,
  op: historyOp,
  characterId: uuid.nullable(),
  campaignId: uuid.nullable(),
  actorUserId: uuid.nullable(),
  actorDisplayName: z.string().nullable(),
  batchId: uuid.nullable(),
  summary: z.string(),
  createdAt: isoTimestamp,
  oldRow: z.record(z.unknown()).nullable().optional(),
  newRow: z.record(z.unknown()).nullable().optional(),
});
export type HistoryEventOut = z.infer<typeof historyEventOut>;

export const historyQueryParams = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // NB: do NOT use z.coerce.boolean() — it parses ANY non-empty string
  // (including 'false' and '0') as true, so `?detail=false` would still
  // expose raw old_row/new_row snapshots. Only explicit truthy tokens
  // enable detail; everything else (false/0/absent/unknown) stays off.
  detail: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true' || v === 'yes'),
  scope: historyScope.optional(),
});
export type HistoryQueryParams = z.infer<typeof historyQueryParams>;

/**
 * SYNCABLE_TABLES maps every EntityClass to its Postgres table name and
 * family.  Adding an EntityClass to the enum in sync.ts without adding an
 * entry here will cause the Guard-1 enforcement test to fail CI.
 */
export const SYNCABLE_TABLES: Record<string, { table: string; family: 'character' | 'campaign' }> =
  {
    character: { table: 'characters', family: 'character' },
    character_trait: { table: 'character_traits', family: 'character' },
    character_skill: { table: 'character_skills', family: 'character' },
    character_spell: { table: 'character_spells', family: 'character' },
    character_inventory: { table: 'inventory_items', family: 'character' },
    character_combat: { table: 'combat_states', family: 'character' },
    campaign: { table: 'campaigns', family: 'campaign' },
    campaign_membership: { table: 'campaign_memberships', family: 'campaign' },
    campaign_library_trait: { table: 'campaign_library_traits', family: 'campaign' },
    campaign_library_skill: { table: 'campaign_library_skills', family: 'campaign' },
    campaign_library_spell: { table: 'campaign_library_spells', family: 'campaign' },
    campaign_library_item: { table: 'campaign_library_items', family: 'campaign' },
    adventure_log: { table: 'adventure_log_entries', family: 'campaign' },
  };
