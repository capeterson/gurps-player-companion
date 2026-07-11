/**
 * Local Dexie database — the source of truth for the UI.
 *
 * Per AGENTS.md: every UI mutation writes here first and appends an
 * outbox row; reads use `useLiveQuery`/`liveQuery` against these
 * stores; the sync orchestrator drains the outbox to the server and
 * pulls cursor changes back into the same stores.
 *
 * Stores at version 1:
 *
 *   characters         pk=id
 *   characterTraits    pk=id
 *   characterSkills    pk=id
 *   characterInventory pk=id
 *   characterCombat    pk=characterId  (1:1 with characters)
 *   campaigns          pk=id
 *   outbox             pk=clientOpId
 *   syncCursors        pk=entityClass
 *   syncMeta           pk=key
 *   tombstones         pk=[entityClass+entityId]
 *   rejectionToasts    pk=id
 *
 * The `[entityId+fieldPath]` compound index on `outbox` is what
 * the coalescing path uses to find a pending op for the same field
 * and replace it (latest-wins) per AGENTS.md rule 1.
 */

import Dexie, { type Table } from 'dexie';
import type { TempEffect } from '../../shared/schemas/character.ts';
import type { EntityClass, OperationCommand } from '../../shared/schemas/sync.ts';

/**
 * Local mirror of the server's character row.  Fields match the
 * server's Drizzle row shape so /sync/cursor responses can be written
 * verbatim.  Numbers are stored as numbers; ISO strings remain strings.
 */
export interface LocalCharacter {
  id: string;
  ownerId: string;
  campaignId: string | null;
  name: string;
  playerName: string | null;
  height: string | null;
  weight: string | null;
  age: number | null;
  appearance: string | null;
  techLevel: number | null;
  st: number;
  dx: number;
  iq: number;
  ht: number;
  hpMod: number;
  willMod: number;
  perMod: number;
  fpMod: number;
  speedQuarterMod: number;
  moveMod: number;
  /** Optional: rows written before migration 0017 (or not yet synced
   * since) may lack this column; readers default missing values to
   * `[]`. Not indexed -- no store version bump needed. */
  tempEffects?: TempEffect[];
  dismissedWarnings: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface LocalCharacterTrait {
  id: string;
  characterId: string;
  kind: 'advantage' | 'disadvantage' | 'perk' | 'quirk' | 'language' | 'cultural_familiarity';
  name: string;
  points: number;
  level: number | null;
  notes: string | null;
  modifiers: unknown[];
  libraryTraitId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface LocalCharacterSkill {
  id: string;
  characterId: string;
  name: string;
  attribute: 'ST' | 'DX' | 'IQ' | 'HT' | 'Will' | 'Per' | 'Other';
  difficulty: 'E' | 'A' | 'H' | 'VH';
  points: number;
  techLevel: number | null;
  specialization: string | null;
  notes: string | null;
  librarySkillId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface LocalCharacterSpell {
  id: string;
  characterId: string;
  name: string;
  college: string | null;
  /** Optional because rows synced before the difficulty column existed
   * lack it; readers default missing values to 'H'. */
  difficulty?: 'H' | 'VH';
  points: number;
  baseEnergyCost: number;
  maintenanceCost: number | null;
  castingTime: string | null;
  duration: string | null;
  prerequisites: string | null;
  notes: string | null;
  librarySpellId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface LocalCharacterInventory {
  id: string;
  characterId: string;
  name: string;
  quantity: number;
  weightLbs: number;
  cost: number;
  notes: string | null;
  parentId: string | null;
  externalLocation: string | null;
  worn: boolean;
  equipped: boolean;
  isContainer: boolean;
  hideawayCapacityLbs: number;
  weightReductionPercent: number;
  isArmor: boolean;
  armor: unknown | null;
  weaponData: unknown | null;
  powerstoneData: unknown | null;
  magicItemData: unknown | null;
  libraryItemId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface LocalCharacterCombat {
  id: string;
  characterId: string;
  currentHp: number;
  currentFp: number;
  conditions: string[];
  maneuver: string | null;
  posture: 'standing' | 'prone' | 'kneeling' | 'crawling' | 'sitting' | 'crouching' | 'lying';
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface LocalCampaign {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  pointTarget: number | null;
  disadvantageCap: number | null;
  quirkCap: number | null;
  /** Optional: rows synced before the mana column existed lack it;
   * readers default missing values to 'normal'. */
  manaLevel?: 'none' | 'low' | 'normal' | 'high' | 'very_high';
  /**
   * When false, non-owner members see the minimal "readily apparent"
   * view of other players' character sheets instead of the full
   * sheet.  Optional in the schema for backwards compatibility with
   * Dexie rows written before this column landed; treat absent as
   * `true` (the safe default = full sharing on).
   */
  shareCharacterSheets?: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/**
 * One row per pending mutation.  Lifecycle:
 *   pending → in_flight → applied (row deleted; revision stamped)
 *                         | rejected/unauthorized/conflict/stale_base/
 *                         |   suspended (row deleted; `rejectionToasts`
 *                         |   keeps the durable audit + toast record)
 *                         | transient_retry (drains again once backoff
 *                         |   elapses; retries forever, relaxing to a
 *                         |   5-minute cadence past MAX_ATTEMPTS)
 * Rows found `in_flight` while holding the cross-tab drain lock are
 * orphans from a crashed/closed tab and are re-promoted to `pending`
 * (see `recoverStaleInFlight`).  `failed_permanent` remains in the
 * enum only for rows written by older client versions.
 */
export type OutboxStatus =
  | 'pending'
  | 'in_flight'
  | 'applied'
  | 'rejected'
  | 'failed_permanent'
  | 'transient_retry';

export interface OutboxEntry {
  clientOpId: string;
  entityClass: EntityClass;
  entityId: string;
  command: OperationCommand;
  /**
   * Composite indexed string `${entityId}|${fieldPath ?? ''}` used by
   * the coalescing path.  Stored explicitly (not derived) so Dexie
   * can index it as a single column without compound-index gymnastics.
   */
  coalesceKey: string;
  fieldPath?: string | undefined;
  attemptedValue: unknown;
  prevValue?: unknown;
  baseRevision?: number | undefined;
  /**
   * Parent character id for child entity classes
   * (`character_trait`, `character_skill`, `character_inventory`,
   * `character_combat`).  Stored separately from `attemptedValue` /
   * `prevValue` so per-field patches keep those fields as the raw
   * primitive value -- the orchestrator's rollback path writes
   * `prevValue` straight back into the local row, so wrapping it as
   * `{ characterId, value }` would corrupt the field on revert.
   */
  parentId?: string | undefined;
  validationVersion: number;
  status: OutboxStatus;
  enqueuedAt: string;
  lastAttemptAt?: string | undefined;
  attemptCount: number;
  /** ISO timestamp; orchestrator only drains rows whose nextEarliestAttemptAt is in the past. */
  nextEarliestAttemptAt?: string | undefined;
  serverReason?: string | undefined;
  serverNewRevision?: number | undefined;
  /**
   * Stable label used in toasts ("Couldn't save ${humanName}").  Filled
   * in by the enqueue site so the orchestrator doesn't have to know
   * field-display conventions.
   */
  humanName?: string | undefined;
  /** Optional flash key so the orchestrator can target a specific input on rollback. */
  flashKey?: string | undefined;
  /**
   * Groups mutations from one user gesture (e.g. multi-item inventory move,
   * "revert all temps") so the history UI can fold them into one expandable
   * entry.  Generated by runBatch() in outbox.ts.
   */
  batchId?: string | undefined;
}

export interface SyncCursor {
  entityClass: EntityClass;
  /** Highest revision seen for this entity class.  Sent as `sinceRevision` in /sync/cursor. */
  revision: number;
}

export interface SyncMetaRow {
  key: string;
  value: unknown;
}

export interface TombstoneRow {
  entityClass: EntityClass;
  entityId: string;
  revision: number;
  deletedAt: string;
}

/**
 * Persistent toast metadata.  The toast UI re-emits these on bootstrap
 * so async failures survive a page reload.  `dismissedAt` flips the
 * row out of the active set without losing the audit trail.
 */
export interface RejectionRecord {
  id: string;
  clientOpId: string;
  entityClass: EntityClass;
  entityId: string;
  fieldPath?: string | undefined;
  humanName?: string | undefined;
  reason: string;
  status: 'rejected' | 'unauthorized' | 'failed_permanent' | 'conflict';
  createdAt: string;
  dismissedAt?: string | undefined;
}

class LocalDb extends Dexie {
  characters!: Table<LocalCharacter, string>;
  characterTraits!: Table<LocalCharacterTrait, string>;
  characterSkills!: Table<LocalCharacterSkill, string>;
  characterSpells!: Table<LocalCharacterSpell, string>;
  characterInventory!: Table<LocalCharacterInventory, string>;
  characterCombat!: Table<LocalCharacterCombat, string>;
  campaigns!: Table<LocalCampaign, string>;
  outbox!: Table<OutboxEntry, string>;
  syncCursors!: Table<SyncCursor, string>;
  syncMeta!: Table<SyncMetaRow, string>;
  tombstones!: Table<TombstoneRow, [string, string]>;
  rejectionToasts!: Table<RejectionRecord, string>;

  constructor() {
    super('gurps-pc-local');
    this.version(1).stores({
      characters: 'id, ownerId, campaignId, updatedAt, revision',
      characterTraits: 'id, characterId, [characterId+kind], updatedAt, revision',
      characterSkills: 'id, characterId, updatedAt, revision',
      characterInventory: 'id, characterId, parentId, updatedAt, revision',
      // characterCombat is 1:1 with character; pk=characterId.
      characterCombat: 'characterId, revision',
      campaigns: 'id, ownerId, revision',
      outbox: 'clientOpId, status, coalesceKey, enqueuedAt, [status+enqueuedAt]',
      syncCursors: 'entityClass',
      syncMeta: 'key',
      tombstones: '[entityClass+entityId], revision',
      rejectionToasts: 'id, entityId, dismissedAt',
    });
    // v2 adds character_spells.  Bumping the version triggers Dexie's
    // schema upgrade flow; existing stores are preserved.
    this.version(2).stores({
      characterSpells: 'id, characterId, updatedAt, revision',
    });
    // v3 adds an `entityId` index to the outbox.  The orchestrator's
    // applyServerRow queries outbox rows by entityId to skip fields
    // with pending local edits (AGENTS.md rule S4); without the index
    // Dexie throws SchemaError and the skip silently never happens,
    // letting cursor pulls clobber unsaved local intent.
    this.version(3).stores({
      outbox: 'clientOpId, status, coalesceKey, enqueuedAt, entityId, [status+enqueuedAt]',
    });
  }
}

let dbInstance: LocalDb | null = null;

/**
 * Lazy singleton — Dexie opens the connection on first table access.
 * Tests reset it via `resetLocalDb()`.
 */
export function getLocalDb(): LocalDb {
  if (!dbInstance) dbInstance = new LocalDb();
  return dbInstance;
}

/**
 * Wipe and re-open the local DB.  Used by:
 *   - test cleanup (afterEach in setup.ts)
 *   - logout (orchestrator.purge) so account switching never leaks
 *     the previous user's rows into a `useLiveQuery`.
 */
export async function resetLocalDb(): Promise<void> {
  if (!dbInstance) return;
  await dbInstance.delete();
  dbInstance = null;
}

/** All store names — handy for transactions that touch every table. */
export const ALL_STORE_NAMES = [
  'characters',
  'characterTraits',
  'characterSkills',
  'characterSpells',
  'characterInventory',
  'characterCombat',
  'campaigns',
  'outbox',
  'syncCursors',
  'syncMeta',
  'tombstones',
  'rejectionToasts',
] as const;

/**
 * Map an EntityClass to the corresponding Dexie store name.  Used by
 * the orchestrator when applying /sync/cursor responses.
 */
export function storeForEntityClass(entityClass: EntityClass): keyof LocalDb | null {
  switch (entityClass) {
    case 'character':
      return 'characters';
    case 'character_trait':
      return 'characterTraits';
    case 'character_skill':
      return 'characterSkills';
    case 'character_spell':
      return 'characterSpells';
    case 'character_inventory':
      return 'characterInventory';
    case 'character_combat':
      return 'characterCombat';
    case 'campaign':
      return 'campaigns';
    default:
      return null;
  }
}

/** Build the outbox coalesce key.  Empty fieldPath collapses to bare entityId. */
export function coalesceKey(entityId: string, fieldPath?: string): string {
  return `${entityId}|${fieldPath ?? ''}`;
}
