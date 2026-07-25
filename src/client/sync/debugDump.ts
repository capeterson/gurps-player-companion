/**
 * Assembles a JSON snapshot of client-side sync diagnostics so a player
 * can attach it to a bug report. Pure data assembly from Dexie -- no
 * DOM, no network -- so it works offline and is easy to unit test.
 *
 * Deliberately excludes entity stores (characters, traits, skills,
 * etc.): a dump attached to a bug report must not carry other players'
 * cached character sheets. Access tokens are never included; only the
 * derived userId (see `readUserIdFromToken`).
 *
 * Outbox values get the same share-gate treatment the sync dialog
 * applies: a GM or manager can queue an edit against a player's sheet,
 * so "this user's own attempted edits" is not the same as "values this
 * user is still allowed to see". Ops whose character has been masked
 * or pruned have their values replaced with a marker -- this file is
 * meant to be handed to someone else, which makes it the surface where
 * that matters most.
 */

import type { OutboxEntry, RejectionRecord, SyncCursor, SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';
import { readUserIdFromToken } from '../lib/tokenStore.ts';
import { isOutboxAccessRestricted } from './minimalViewSweep.ts';
import type { SyncIndicatorState } from './state.ts';
import { syncStateStore } from './state.ts';

export interface SyncDebugDump {
  meta: {
    generatedAt: string;
    userAgent: string;
    onLine: boolean;
    userId: string | null;
    syncIndicatorState: SyncIndicatorState;
    pendingCounts: {
      pending: number;
      inFlight: number;
      transientRetry: number;
    };
    storeCounts: Record<string, number>;
    mode: string;
  };
  syncCursors: SyncCursor[];
  outbox: OutboxEntry[];
  rejectionToasts: RejectionRecord[];
  syncLog: SyncLogEntry[];
}

const HIDDEN = '[hidden — no access to this character]';

/**
 * Apply the share gate to queued ops, using the same decision the sync
 * dialog renders with (`isOutboxAccessRestricted`) so the two can't
 * drift.  This is the surface where it matters most: the dump is a file
 * the user hands to someone else.
 */
function maskRestrictedOps(
  outbox: OutboxEntry[],
  characters: Array<{ id: string; minimalViewMasked?: boolean | undefined }>,
): OutboxEntry[] {
  const access = {
    known: new Set(characters.map((c) => c.id)),
    masked: new Set(characters.filter((c) => c.minimalViewMasked).map((c) => c.id)),
  };
  return outbox.map((op) =>
    isOutboxAccessRestricted(op, access)
      ? { ...op, attemptedValue: HIDDEN, prevValue: HIDDEN }
      : op,
  );
}

export async function buildSyncDebugDump(): Promise<SyncDebugDump> {
  const db = getLocalDb();
  const [rawOutbox, characterRows, rejectionToasts, syncLog, syncCursors, storeCounts] =
    await Promise.all([
      db.outbox.toArray(),
      db.characters.toArray(),
      db.rejectionToasts.toArray(),
      db.syncLog.orderBy('occurredAt').toArray(),
      db.syncCursors.toArray(),
      Promise.all([
        db.characters.count(),
        db.characterTraits.count(),
        db.characterSkills.count(),
        db.characterSpells.count(),
        db.characterInventory.count(),
        db.characterCombat.count(),
        db.campaigns.count(),
        db.tombstones.count(),
        db.outbox.count(),
        db.rejectionToasts.count(),
        db.syncLog.count(),
      ]).then(
        ([
          characters,
          characterTraits,
          characterSkills,
          characterSpells,
          characterInventory,
          characterCombat,
          campaigns,
          tombstones,
          outboxCount,
          rejectionToastsCount,
          syncLogCount,
        ]) => ({
          characters,
          characterTraits,
          characterSkills,
          characterSpells,
          characterInventory,
          characterCombat,
          campaigns,
          tombstones,
          outbox: outboxCount,
          rejectionToasts: rejectionToastsCount,
          syncLog: syncLogCount,
        }),
      ),
    ]);
  const outbox = maskRestrictedOps(rawOutbox, characterRows);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      onLine: typeof navigator !== 'undefined' ? navigator.onLine : true,
      userId: readUserIdFromToken(),
      syncIndicatorState: syncStateStore.value,
      pendingCounts: {
        pending: outbox.filter((op) => op.status === 'pending').length,
        inFlight: outbox.filter((op) => op.status === 'in_flight').length,
        transientRetry: outbox.filter((op) => op.status === 'transient_retry').length,
      },
      storeCounts,
      mode: import.meta.env.MODE,
    },
    syncCursors,
    outbox,
    rejectionToasts,
    syncLog,
  };
}
