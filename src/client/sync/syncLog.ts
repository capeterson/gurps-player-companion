import Dexie from 'dexie';
import { isLibraryEntityClass } from '../../shared/schemas/sync.ts';
import type { SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';
import { isNetworkErrorMessage } from '../lib/networkErrors.ts';
import { readUserIdFromToken } from '../lib/tokenStore.ts';
import { newClientId } from './outbox.ts';
import { packSyncLogEntry } from './syncLogPayload.ts';

export const SYNC_LOG_RETENTION = 1_000;
let journalGeneration = 0;

/** A delayed compression must not repopulate diagnostic stores after logout/resync. */
export function invalidatePendingSyncLogWrites(): void {
  journalGeneration++;
}

/**
 * Per-value ceiling for the `previousValue` / `newValue` snapshots.
 * A `create` op's value is a whole entity row, and the journal keeps
 * 1,000 of them -- without a cap a few big rows (a long inventory
 * `notes`, a fat `tempEffects` array) could bloat IndexedDB for what is
 * only ever a diagnostic. Truncated values still show the user what
 * changed, which is the point.
 */
export const SYNC_LOG_VALUE_MAX_CHARS = 2_000;

export type NewSyncLogEntry = Omit<SyncLogEntry, 'id' | 'occurredAt'> & {
  id?: string;
  occurredAt?: string;
};

/** Offline fetch failures are normal; retain HTTP and application diagnostics. */
export function isNetworkSyncLogEntry(
  entry: Pick<SyncLogEntry, 'result' | 'reason' | 'details'>,
): boolean {
  if (entry.result !== 'failed' && entry.result !== 'retrying') return false;
  const reason = entry.reason ?? '';
  if (/\bHTTP \d{3}\b/.test(reason)) return false;
  // Online-only save diagnostics carry their HTTP status in details instead.
  if (
    entry.details !== null &&
    typeof entry.details === 'object' &&
    'status' in entry.details &&
    typeof entry.details.status === 'number'
  )
    return false;
  // Match the complete browser message, including older journal rows whose
  // payload may be compressed. Never decode bodies just to filter the log.
  const message = reason.includes(' — ') ? reason.slice(reason.lastIndexOf(' — ') + 3) : reason;
  return isNetworkErrorMessage(message);
}

/**
 * Bound a value before it goes into the journal.  Small scalars pass
 * through unchanged (the common case: one field of one character);
 * anything over the cap becomes a marker object so the UI can say "too
 * large to record" rather than silently showing nothing.
 *
 * Strings get the same ceiling as objects -- they are NOT small by
 * assumption. `notes` / `appearance` / trait + skill descriptions all
 * accept up to 20,000 characters, so exempting strings would let a
 * handful of edits to those fields retain tens of MB across the 1,000
 * before/after pairs this journal keeps.
 *
 * The same applies to a raw server outcome: a `conflict`/`stale_base`
 * response carries a whole `latestEntity` row, so `details` is capped
 * through here too rather than stored verbatim.
 */
export function snapshotValue(value: unknown, maxChars = SYNC_LOG_VALUE_MAX_CHARS): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') {
    return value.length <= maxChars
      ? value
      : {
          truncated: true,
          preview: value.slice(0, maxChars),
          length: value.length,
        };
  }
  if (typeof value !== 'object') return value;
  let json: string;
  try {
    json = JSON.stringify(value) ?? '';
  } catch {
    return { truncated: true, note: 'value could not be serialized' };
  }
  if (json.length <= maxChars) return value;
  return { truncated: true, preview: json.slice(0, maxChars), length: json.length };
}

export async function appendSyncLog(entry: NewSyncLogEntry): Promise<void> {
  if (isNetworkSyncLogEntry(entry)) return;
  try {
    const generation = journalGeneration;
    const db = getLocalDb();
    const row: SyncLogEntry = {
      ...entry,
      id: entry.id ?? newClientId(),
      occurredAt: entry.occurredAt ?? new Date().toISOString(),
    };
    // Never wait on compression streams inside a live IDB transaction: it
    // would auto-commit and could abort the enclosing outbox reconciliation.
    const packed = Dexie.currentTransaction ? { entry: row } : await packSyncLogEntry(row);
    if (generation !== journalGeneration) return;
    await db.transaction('rw', db.syncLog, db.syncLogBodies, db.syncMeta, async () => {
      if (generation !== journalGeneration) return;
      await rememberSuccessfulOperations([row]);
      await db.syncLog.put(packed.entry);
      if (packed.body) await db.syncLogBodies.put(packed.body);
      else await db.syncLogBodies.delete(row.id);
    });
    scheduleSyncLogPrune();
  } catch {
    // Diagnostic persistence must never interrupt outbox settlement.
  }
}

/**
 * Append one cursor page's journal entries with a single write. Per-entry
 * appends that each pruned inline stalled large library pulls for tens of
 * seconds between cursor pages.
 */
export async function appendSyncLogEntries(entries: readonly NewSyncLogEntry[]): Promise<void> {
  const loggableEntries = entries.filter((entry) => !isNetworkSyncLogEntry(entry));
  if (loggableEntries.length === 0) return;
  try {
    const generation = journalGeneration;
    const db = getLocalDb();
    const now = new Date().toISOString();
    const rows: SyncLogEntry[] = loggableEntries.map((entry) => ({
      ...entry,
      id: entry.id ?? newClientId(),
      occurredAt: entry.occurredAt ?? now,
    }));
    const packed: Awaited<ReturnType<typeof packSyncLogEntry>>[] = [];
    // Bounded parallelism keeps large cursor pages from creating hundreds of
    // streams at once, without introducing a transaction per compressed row.
    for (let index = 0; index < rows.length; index += 8) {
      packed.push(
        ...(await Promise.all(
          rows
            .slice(index, index + 8)
            .map((row) => (Dexie.currentTransaction ? { entry: row } : packSyncLogEntry(row))),
        )),
      );
    }
    if (generation !== journalGeneration) return;
    await db.transaction('rw', db.syncLog, db.syncLogBodies, db.syncMeta, async () => {
      if (generation !== journalGeneration) return;
      await rememberSuccessfulOperations(rows);
      await db.syncLog.bulkPut(packed.map(({ entry }) => entry));
      await db.syncLogBodies.bulkDelete(rows.map(({ id }) => id));
      const bodies = packed.flatMap(({ body }) => (body ? [body] : []));
      if (bodies.length > 0) await db.syncLogBodies.bulkPut(bodies);
    });
    scheduleSyncLogPrune();
  } catch {
    // Diagnostic persistence must never interrupt a cursor pull.
  }
}

/**
 * Retention is eventually consistent: writes schedule a debounced prune
 * instead of counting and trimming inline, so bursts (a large cursor pull,
 * a drained outbox) pay for one prune. The journal may briefly exceed
 * SYNC_LOG_RETENTION; the max wait bounds that under continuous writes.
 */
export const SYNC_LOG_PRUNE_DEBOUNCE_MS = 2_000;
export const SYNC_LOG_PRUNE_MAX_WAIT_MS = 10_000;
let pruneTimer: ReturnType<typeof setTimeout> | null = null;
let pruneFirstScheduledAt: number | null = null;

function scheduleSyncLogPrune(): void {
  const now = Date.now();
  pruneFirstScheduledAt ??= now;
  if (pruneTimer) clearTimeout(pruneTimer);
  const delay = Math.max(
    0,
    Math.min(SYNC_LOG_PRUNE_DEBOUNCE_MS, pruneFirstScheduledAt + SYNC_LOG_PRUNE_MAX_WAIT_MS - now),
  );
  pruneTimer = setTimeout(() => {
    void flushSyncLogPrune();
  }, delay);
}

/** Run any scheduled prune now (tests, and callers that need exact retention). */
export async function flushSyncLogPrune(): Promise<void> {
  if (pruneTimer) clearTimeout(pruneTimer);
  pruneTimer = null;
  pruneFirstScheduledAt = null;
  try {
    await pruneSyncLog();
  } catch {
    // Best-effort; the next write schedules another attempt.
  }
}

export async function pruneSyncLog(): Promise<void> {
  const db = getLocalDb();
  await db.transaction('rw', db.syncLog, db.syncLogBodies, async () => {
    const excess = (await db.syncLog.count()) - SYNC_LOG_RETENTION;
    if (excess <= 0) return;
    const oldestIds = await db.syncLog.orderBy('occurredAt').limit(excess).primaryKeys();
    await db.syncLog.bulkDelete(oldestIds);
    await db.syncLogBodies.bulkDelete(oldestIds);
  });
}

/**
 * Strip the character payloads from journal entries for characters the
 * viewer may no longer see.
 *
 * The share gate applies to **every** surface carrying character data
 * (`AGENTS.md`), and this journal is one: a GM/manager editing a
 * player's sheet records that player's before/after values here, and a
 * `conflict`/`stale_base` outcome can carry a whole `latestEntity` row
 * in `details`. The entity stores get purged when access is downgraded
 * (`enforceMinimalViewLocally` / `pruneInaccessibleLocally`) — without
 * this the same values stayed readable in the sync dialog and in the
 * downloadable debug dump.
 *
 * The row itself survives with its metadata (class, timing, outcome),
 * which is the same shape a `pull` entry has always kept, so the
 * operational history stays intact.
 */
export async function redactSyncLogForCharacters(characterIds: Iterable<string>): Promise<number> {
  const ids = new Set(characterIds);
  if (ids.size === 0) return 0;
  try {
    const db = getLocalDb();
    const affected = await db.syncLog
      .filter(
        (entry) =>
          !entry.redacted &&
          ((entry.entityId !== undefined && ids.has(entry.entityId)) ||
            (entry.parentId !== undefined && ids.has(entry.parentId))),
      )
      .toArray();
    if (affected.length > 0) {
      await db.transaction('rw', db.syncLog, db.syncLogBodies, async () => {
        await db.syncLogBodies.bulkDelete(affected.map(({ id }) => id));
        await db.syncLog.bulkPut(
          affected.map((entry) => ({
            ...entry,
            previousValue: undefined,
            newValue: undefined,
            details: undefined,
            request: undefined,
            entityName: undefined,
            humanName: undefined,
            payloadStored: undefined,
            payloadMetadata: undefined,
            redacted: true,
          })),
        );
      });
    }
    // Rejection records carry private content too: `humanName` on a
    // child rejection reads `skill "Stealth"` / `item "..."`, and the
    // debug dump exports these rows verbatim.
    const rejections = await db.rejectionToasts
      .filter(
        (rec) =>
          !rec.redacted &&
          (ids.has(rec.entityId) || (rec.parentId !== undefined && ids.has(rec.parentId))),
      )
      .toArray();
    if (rejections.length > 0) {
      await db.rejectionToasts.bulkPut(
        rejections.map((rec) => ({
          ...rec,
          humanName: undefined,
          fieldPath: undefined,
          redacted: true,
        })),
      );
    }
    return affected.length + rejections.length;
  } catch {
    return 0;
  }
}

/** Strip downloaded campaign snapshots when the viewer loses that campaign. */
export async function redactSyncLogForCampaigns(campaignIds: Iterable<string>): Promise<number> {
  const ids = new Set(campaignIds);
  if (ids.size === 0) return 0;
  try {
    const db = getLocalDb();
    const affected = await db.syncLog
      .filter(
        (entry) =>
          !entry.redacted &&
          ((entry.entityClass === 'campaign' &&
            entry.entityId !== undefined &&
            ids.has(entry.entityId)) ||
            // Library journal rows are parented by their campaign.
            (isLibraryEntityClass(entry.entityClass) &&
              entry.parentId !== undefined &&
              ids.has(entry.parentId))),
      )
      .toArray();
    if (affected.length > 0) {
      await db.transaction('rw', db.syncLog, db.syncLogBodies, async () => {
        await db.syncLogBodies.bulkDelete(affected.map(({ id }) => id));
        await db.syncLog.bulkPut(
          affected.map((entry) => ({
            ...entry,
            previousValue: undefined,
            newValue: undefined,
            details: undefined,
            request: undefined,
            entityName: undefined,
            humanName: undefined,
            payloadStored: undefined,
            payloadMetadata: undefined,
            fieldPath: undefined,
            redacted: true,
          })),
        );
      });
    }
    return affected.length;
  } catch {
    return 0;
  }
}

/** `syncMeta` key holding the ids whose access has been revoked locally. */
export const REVOKED_CHARACTERS_KEY = 'revokedCharacters';
/** Same fail-closed ledger for downloaded campaign journal snapshots. */
export const REVOKED_CAMPAIGNS_KEY = 'revokedCampaigns';
/** Bound on that ledger; ids only, so this is generous. */
export const REVOKED_CHARACTERS_RETENTION = 1_000;

/**
 * Remember that a character's access was revoked, independently of its
 * row.
 *
 * `redactSyncLogForCharacters` is best-effort by design (diagnostic
 * housekeeping must never break a sync cycle), and the prune deletes
 * the character row *before* calling it. If the redaction then fails --
 * quota, aborted transaction -- the row is gone, nothing is marked, and
 * a read-time check on a root record would see "unknown character" and
 * fail **open**. This ledger outlives the row so that path fails closed.
 */
export async function rememberRevokedCharacters(ids: Iterable<string>): Promise<void> {
  const incoming = [...ids];
  if (incoming.length === 0) return;
  try {
    const db = getLocalDb();
    const existing = await readRevokedCharacters();
    const merged = [...existing, ...incoming.filter((id) => !existing.includes(id))];
    await db.syncMeta.put({
      key: REVOKED_CHARACTERS_KEY,
      value: merged.slice(-REVOKED_CHARACTERS_RETENTION),
    });
  } catch {
    // Best-effort; the row-level markers still cover the common path.
  }
}

export async function readRevokedCharacters(): Promise<string[]> {
  try {
    const row = await getLocalDb().syncMeta.get(REVOKED_CHARACTERS_KEY);
    return Array.isArray(row?.value) ? (row.value as string[]) : [];
  } catch {
    return [];
  }
}

export async function rememberRevokedCampaigns(ids: Iterable<string>): Promise<void> {
  const incoming = [...ids];
  if (incoming.length === 0) return;
  try {
    const db = getLocalDb();
    const existing = await readRevokedCampaigns();
    const merged = [...existing, ...incoming.filter((id) => !existing.includes(id))];
    await db.syncMeta.put({
      key: REVOKED_CAMPAIGNS_KEY,
      value: merged.slice(-REVOKED_CHARACTERS_RETENTION),
    });
  } catch {
    // Best-effort; at-rest redaction still covers the common path.
  }
}

export async function readRevokedCampaigns(): Promise<string[]> {
  try {
    const row = await getLocalDb().syncMeta.get(REVOKED_CAMPAIGNS_KEY);
    return Array.isArray(row?.value) ? (row.value as string[]) : [];
  } catch {
    return [];
  }
}

/** Hard cap on stored rejection records. */
export const REJECTION_RETENTION = 200;
/**
 * A rejection older than this stops being re-toasted on bootstrap.
 * `rejectionToasts` rows are persistent *because* the user must not
 * miss a rollback -- but a rejection from months ago is noise, not
 * news, and a wall of stale toasts is exactly as unhelpful as no toast
 * at all.  The row survives (auto-dismissed) as the audit trail, and
 * the sync-log dialog still lists it.
 */
export const REJECTION_REPLAY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export async function markRejectionDismissed(id: string): Promise<void> {
  try {
    await getLocalDb().rejectionToasts.update(id, { dismissedAt: new Date().toISOString() });
  } catch {
    // Best-effort: losing a dismissal only means the toast reappears.
  }
}

/**
 * Auto-dismiss rejections too old to replay, then trim the table to
 * `REJECTION_RETENTION`.  Unlike `syncLog` this store had no retention
 * at all, so it grew without bound for the life of the install.
 */
export async function pruneRejectionToasts(now: number = Date.now()): Promise<void> {
  try {
    const db = getLocalDb();
    const cutoff = new Date(now - REJECTION_REPLAY_MAX_AGE_MS).toISOString();
    const stale = await db.rejectionToasts
      .filter((r) => !r.dismissedAt && r.createdAt < cutoff)
      .primaryKeys();
    if (stale.length > 0) {
      const dismissedAt = new Date(now).toISOString();
      await db.rejectionToasts.bulkUpdate(stale.map((key) => ({ key, changes: { dismissedAt } })));
    }
    const excess = (await db.rejectionToasts.count()) - REJECTION_RETENTION;
    if (excess > 0) {
      const all = await db.rejectionToasts.toArray();
      const oldest = all
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, excess)
        .map((r) => r.id);
      await db.rejectionToasts.bulkDelete(oldest);
    }
  } catch {
    // Diagnostic housekeeping must never block a sync cycle.
  }
}

/** Account-scoped metadata survives journal pruning and is purged with all local stores. */
export function lastSuccessfulSyncKey(): string {
  return `lastSuccessfulSyncOperation:${readUserIdFromToken() ?? 'session'}`;
}

/** Separate from the legacy sync time, which also included empty manual checks. */
export function lastChangesSyncKey(): string {
  return `lastSyncChanges:${readUserIdFromToken() ?? 'session'}`;
}

/** Every completed HTTP cursor check counts, including empty background polls. */
export async function rememberSuccessfulSync(isCurrent: () => boolean): Promise<void> {
  const generation = journalGeneration;
  const db = getLocalDb();
  const key = lastSuccessfulSyncKey();
  const at = new Date().toISOString();
  try {
    await db.transaction('rw', db.syncMeta, async () => {
      if (generation !== journalGeneration || !isCurrent()) return;
      await rememberNewerTime(key, at, () => generation === journalGeneration && isCurrent());
    });
  } catch {
    // Diagnostic persistence must never turn a completed check into a sync failure.
  }
}

async function rememberNewerTime(
  key: string,
  at: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const db = getLocalDb();
  const previous = (await db.syncMeta.get(key))?.value;
  if (
    isCurrent() &&
    (typeof previous !== 'string' ||
      !Number.isFinite(Date.parse(previous)) ||
      Date.parse(previous) < Date.parse(at))
  ) {
    await db.syncMeta.put({ key, value: at });
  }
}

export function isSuccessfulSyncOperation(entry: SyncLogEntry): boolean {
  if (entry.result !== 'synced') return false;
  if (entry.direction === 'push') return true;
  if (entry.direction !== 'pull') return false;
  const metadata = entry.payloadMetadata ?? entry.details;
  const fields =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>).appliedFields
      : undefined;
  return Array.isArray(fields)
    ? fields.length > 0
    : entry.previousValue !== undefined || entry.newValue !== undefined;
}

async function rememberSuccessfulOperations(entries: readonly SyncLogEntry[]): Promise<void> {
  const latest = entries
    .filter(isSuccessfulSyncOperation)
    .map((entry) => entry.occurredAt)
    .filter((at) => Number.isFinite(Date.parse(at)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  if (!latest) return;
  await rememberNewerTime(lastChangesSyncKey(), latest);
}
