/**
 * Assembles a JSON snapshot of client-side sync diagnostics so a player
 * can attach it to a bug report. Pure data assembly from Dexie -- no
 * DOM, no network -- so it works offline and is easy to unit test.
 *
 * Deliberately excludes entity stores (characters, traits, skills,
 * etc.): a dump attached to a bug report must not carry other players'
 * cached character sheets. The outbox/rejection/log rows already
 * contain everything needed to diagnose a sync issue -- and they only
 * ever hold this user's own attempted edits. Access tokens are never
 * included; only the derived userId (see `readUserIdFromToken`).
 */

import type { OutboxEntry, RejectionRecord, SyncCursor, SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';
import { readUserIdFromToken } from '../lib/tokenStore.ts';
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

export async function buildSyncDebugDump(): Promise<SyncDebugDump> {
  const db = getLocalDb();
  const [outbox, rejectionToasts, syncLog, syncCursors, storeCounts] = await Promise.all([
    db.outbox.toArray(),
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
