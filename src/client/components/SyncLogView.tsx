import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { OutboxEntry, SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';
import { useDialogState } from '../hooks/useDialogState.ts';
import { useToasts } from '../lib/toast.tsx';
import { readUserIdFromToken } from '../lib/tokenStore.ts';
import { buildSyncDebugDump } from '../sync/debugDump.ts';
import { isOutboxAccessRestricted, isRecordAccessRestricted } from '../sync/minimalViewSweep.ts';
import { getSyncOrchestrator } from '../sync/orchestrator.ts';
import { useSyncStatus } from '../sync/useSyncIndicatorState.ts';
import { ConfirmDialog } from './ui/ConfirmDialog.tsx';

interface SyncLogViewProps {
  open: boolean;
  onClose: () => void;
  online: boolean;
  storageMessage?: string;
}

export function SyncLogView({ open, onClose, online, storageMessage }: SyncLogViewProps) {
  const ref = useDialogState(open);
  const toasts = useToasts();
  const status = useSyncStatus();
  const outbox = useLiveQuery(
    () => getLocalDb().outbox.orderBy('enqueuedAt').reverse().toArray(),
    [],
  );
  const log = useLiveQuery(
    () => getLocalDb().syncLog.orderBy('occurredAt').reverse().limit(1_000).toArray(),
    [],
  );
  // The outbox is deliberately NOT swept when access is downgraded --
  // a queued op is the user's own unsent intent and still has to be
  // delivered. But its `prevValue` can hold another player's private
  // value, so this view has to apply the share gate itself rather than
  // print whatever the row happens to carry.
  const access = useLiveQuery(
    async () => {
      const chars = await getLocalDb().characters.toArray();
      return {
        known: new Set(chars.map((c) => c.id)),
        masked: new Set(chars.filter((c) => c.minimalViewMasked).map((c) => c.id)),
      };
    },
    [],
    { known: new Set<string>(), masked: new Set<string>() },
  );
  const [revertTarget, setRevertTarget] = useState<OutboxEntry | null>(null);
  const [resyncOpen, setResyncOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const failures = (outbox ?? []).filter((op) => op.attemptCount >= 4);
  const pending = (outbox ?? []).filter((op) => op.attemptCount < 4);

  const revert = async () => {
    if (!revertTarget) return;
    setWorking(true);
    try {
      const op = await getSyncOrchestrator().revertFailedOperation(revertTarget.clientOpId);
      toasts.push(
        op.preservedNewerEdit
          ? `${changeName(op)} failed attempt removed; newer local edit kept`
          : `${changeName(op)} reverted to the last server-synced value`,
        { kind: 'success' },
      );
      setRevertTarget(null);
    } catch (err) {
      toasts.push(`Couldn't revert change — ${errorMessage(err)}`, { kind: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const downloadDebugLog = async () => {
    try {
      const dump = await buildSyncDebugDump();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sync-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toasts.push(`Couldn't build debug log — ${errorMessage(err)}`, { kind: 'error' });
    }
  };

  const resync = async () => {
    const userId = readUserIdFromToken();
    if (!userId) {
      toasts.push("Couldn't resync — no authenticated user was found", { kind: 'error' });
      setResyncOpen(false);
      return;
    }
    setWorking(true);
    try {
      await getSyncOrchestrator().clearLocalAndFullResync(userId);
      toasts.push('Local data cleared and resynced', { kind: 'success' });
      setResyncOpen(false);
    } catch (err) {
      toasts.push(`Couldn't resync — ${errorMessage(err)}`, { kind: 'error' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <dialog
        ref={ref}
        className="modal"
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <div className="modal-box flex max-h-[88vh] max-w-4xl flex-col border border-base-300 bg-base-100 p-0">
          <header className="flex items-start justify-between border-b border-base-300 px-5 py-4">
            <div>
              <h2 className="font-display text-xl font-semibold">Sync log</h2>
              <p className="text-sm text-base-content/60">
                Local changes and recent server activity
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              aria-label="Close sync log"
            >
              ✕
            </button>
          </header>

          <div className="min-h-0 space-y-6 overflow-y-auto px-5 py-4">
            {status.state === 'error' && status.error && (
              // The badge that opens this dialog says something is
              // wrong; this is where it says *what*.  Cycle-level
              // failures (server down, connection dropped, session
              // lost) produce no toast and no outbox row, so without
              // this the dialog looked completely healthy.
              <section
                aria-labelledby="sync-current-error-title"
                className="rounded-box border border-warning/50 bg-warning/10 p-3"
              >
                <h3 id="sync-current-error-title" className="font-semibold text-warning">
                  Sync isn't currently working
                </h3>
                <p className="mt-1 text-sm">{status.error.reason}</p>
                <p className="mt-1 text-xs text-base-content/60">
                  Last attempt {formatTime(status.error.at)}. Local changes are safe and will upload
                  once this clears.
                </p>
              </section>
            )}

            {failures.length > 0 && (
              <section aria-labelledby="sync-failures-title">
                <h3 id="sync-failures-title" className="mb-2 font-semibold text-error">
                  Repeatedly failing
                </h3>
                <div className="space-y-2">
                  {failures.map((op) => (
                    <article
                      key={op.clientOpId}
                      className="rounded-box border border-error/50 bg-error/10 p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-error">{changeName(op)}</p>
                          <p className="text-base-content/70">
                            Failed {op.attemptCount} times ·{' '}
                            {formatTime(op.lastAttemptAt ?? op.enqueuedAt)}
                          </p>
                          {op.serverReason && <p className="mt-1 text-error">{op.serverReason}</p>}
                        </div>
                        <button
                          type="button"
                          className="btn btn-error btn-sm"
                          onClick={() => setRevertTarget(op)}
                        >
                          Revert change
                        </button>
                      </div>
                      <details className="mt-3 rounded-field bg-base-100/70 p-2">
                        <summary className="cursor-pointer font-medium">Debug information</summary>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                          {debugText(op, isOutboxAccessRestricted(op, access))}
                        </pre>
                      </details>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <SyncSection title="Not synced" empty="No local changes are waiting to sync.">
              {pending.map((op) => (
                <ChangeRow
                  key={op.clientOpId}
                  title={changeName(op)}
                  meta={`${statusLabel(op)} · ${formatTime(op.enqueuedAt)}`}
                  details={
                    <PendingDetails op={op} hideValues={isOutboxAccessRestricted(op, access)} />
                  }
                />
              ))}
            </SyncSection>

            <SyncSection title="Recently synced" empty="No sync activity has been recorded yet.">
              {(log ?? []).map((entry) => (
                <ChangeRow
                  key={entry.id}
                  title={logName(entry)}
                  meta={`${directionLabel(entry)} · ${formatTime(entry.occurredAt)}`}
                  tone={
                    entry.result === 'failed' || entry.result === 'rolled_back' ? 'bad' : undefined
                  }
                  details={
                    <LogDetails
                      entry={entry}
                      restricted={isRecordAccessRestricted(entry, access)}
                    />
                  }
                />
              ))}
            </SyncSection>
          </div>

          <footer className="border-t border-base-300 px-5 py-4">
            {storageMessage && (
              <p className="mb-3 text-xs text-base-content/60">{storageMessage}</p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                className="btn btn-outline btn-sm h-auto whitespace-normal py-2"
                onClick={() => void downloadDebugLog()}
              >
                Download sync debug log
              </button>
              <button
                type="button"
                className="btn btn-error btn-outline btn-sm h-auto whitespace-normal py-2"
                disabled={!online}
                onClick={() => setResyncOpen(true)}
              >
                Abandon local changes and re-sync from server
              </button>
            </div>
            {!online && (
              <p className="mt-2 text-xs text-warning">
                Reconnect before abandoning local changes so a fresh server copy can be downloaded.
              </p>
            )}
          </footer>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="button" onClick={onClose}>
            close
          </button>
        </form>
      </dialog>

      <ConfirmDialog
        open={revertTarget !== null}
        title="Revert this local change?"
        confirmLabel={working ? 'Reverting…' : 'Revert change'}
        cancelLabel="Keep retrying"
        tone="error"
        onConfirm={() => {
          if (!working) void revert();
        }}
        onCancel={() => {
          if (!working) setRevertTarget(null);
        }}
      >
        The local value will return to its last server-synced value and this change will stop
        retrying.
      </ConfirmDialog>

      <ConfirmDialog
        open={resyncOpen}
        title="Abandon local changes and re-sync?"
        confirmLabel={working ? 'Re-syncing…' : 'Abandon and re-sync'}
        cancelLabel="Keep local data"
        tone="error"
        onConfirm={() => {
          if (!working) void resync();
        }}
        onCancel={() => {
          if (!working) setResyncOpen(false);
        }}
      >
        This permanently discards every pending local edit, clears the local database, and downloads
        a fresh copy from the server.
      </ConfirmDialog>
    </>
  );
}

function SyncSection({
  title,
  empty,
  children,
}: { title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <div className="divide-y divide-base-300 rounded-box border border-base-300">
        {hasChildren ? children : <p className="p-3 text-sm text-base-content/60">{empty}</p>}
      </div>
    </section>
  );
}

/**
 * One log line, expandable.  `"character inventory patch"` on its own
 * doesn't tell the user anything about what changed, but the full
 * before/after doesn't belong inline either -- so the summary stays a
 * one-liner and the specifics live behind a disclosure that is closed
 * by default.
 */
function ChangeRow({
  title,
  meta,
  details,
  tone,
}: { title: string; meta: string; details?: React.ReactNode; tone?: 'bad' | undefined }) {
  if (!details) {
    return (
      <div className="flex flex-wrap justify-between gap-2 p-3 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-base-content/60">{meta}</span>
      </div>
    );
  }
  return (
    <details className="group text-sm">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 p-3 hover:bg-base-200">
        <span
          aria-hidden="true"
          className="inline-block text-base-content/40 transition-transform group-open:rotate-90"
        >
          ›
        </span>
        <span className="font-medium">{title}</span>
        <span className={`ml-auto ${tone === 'bad' ? 'text-error' : 'text-base-content/60'}`}>
          {meta}
        </span>
      </summary>
      <div className="border-base-300 border-t bg-base-200/40 px-3 py-2">{details}</div>
    </details>
  );
}

/**
 * A detail row is plain data, never pre-rendered JSX, so `DetailList`
 * owns every styling decision in one place.  `kind: 'value'` defers to
 * `ValueText`, which knows how to print a bare field value, a whole
 * entity row, or a truncation marker.
 */
type DetailRow =
  | { label: string; kind: 'text'; text: string; tone?: 'error' }
  | { label: string; kind: 'value'; value: unknown };

function textRow(label: string, text: string, tone?: 'error'): DetailRow {
  return tone ? { label, kind: 'text', text, tone } : { label, kind: 'text', text };
}

function valueRow(label: string, value: unknown): DetailRow {
  return { label, kind: 'value', value };
}

/** Label / value grid used inside an expanded row. */
function DetailList({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-base-content/60">{row.label}</dt>
          <dd className="min-w-0 break-words font-mono">
            {row.kind === 'text' ? (
              <span className={row.tone === 'error' ? 'text-error' : undefined}>{row.text}</span>
            ) : (
              <ValueText value={row.value} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LogDetails({ entry, restricted }: { entry: SyncLogEntry; restricted: boolean }) {
  const rows: DetailRow[] = [];
  if (entry.reason) rows.push(textRow('Reason', entry.reason, 'error'));
  if (entry.fieldPath) rows.push(textRow('Field', entry.fieldPath));
  if (restricted) {
    // Either scrubbed at rest by the sweep, or still holding values for
    // a character the viewer can no longer see -- an offline revert can
    // write a fresh snapshot after the last sweep ran, with no later
    // pull to clean it up.
    rows.push(textRow('Values', 'removed — you no longer have access to this character'));
  } else if (hasValueSnapshot(entry)) {
    rows.push(valueRow('Before', entry.previousValue));
    rows.push(valueRow('After', entry.newValue));
  } else if (entry.direction === 'pull') {
    // Deliberate: pull entries never store row payloads, so a later
    // access downgrade can't leave another player's sheet data sitting
    // in this journal. See docs/specs/offline-sync.md.
    rows.push(textRow('Values', 'not recorded for downloads'));
  }
  if (entry.entityClass) rows.push(textRow('Entity', entry.entityClass.replaceAll('_', ' ')));
  if (entry.entityId) rows.push(textRow('Entity id', entry.entityId));
  if (entry.command) rows.push(textRow('Operation', entry.command));
  rows.push(textRow('When', formatTime(entry.occurredAt)));

  return (
    <>
      <DetailList rows={rows} />
      {/* `details` can carry a whole `latestEntity` row on a conflict,
          so it is gated by the same check as the value snapshots. */}
      {!restricted && entry.details !== undefined && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-base-content/60">Raw</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(entry.details, null, 2)}
          </pre>
        </details>
      )}
    </>
  );
}

function PendingDetails({ op, hideValues }: { op: OutboxEntry; hideValues: boolean }) {
  const rows: DetailRow[] = [];
  if (op.fieldPath) rows.push(textRow('Field', op.fieldPath));
  if (hideValues) {
    rows.push(textRow('Values', 'hidden — you no longer have access to this character'));
  } else {
    rows.push(valueRow('Before', op.prevValue));
    rows.push(valueRow('After', op.attemptedValue));
  }
  rows.push(textRow('Entity', op.entityClass.replaceAll('_', ' ')));
  rows.push(textRow('Entity id', op.entityId));
  rows.push(textRow('Operation', op.command));
  rows.push(textRow('Queued', formatTime(op.enqueuedAt)));
  if (op.attemptCount > 0) rows.push(textRow('Attempts', String(op.attemptCount)));
  if (op.serverReason) rows.push(textRow('Last error', op.serverReason, 'error'));
  return <DetailList rows={rows} />;
}

/**
 * A create/delete op's value is a whole row and a patch's is a bare
 * field value, so render whatever we got rather than assuming a scalar.
 */
function ValueText({ value }: { value: unknown }) {
  if (value === undefined) return <span className="text-base-content/50">(not recorded)</span>;
  if (value === null) return <span className="text-base-content/50">(empty)</span>;
  if (typeof value === 'string') {
    return value.length === 0 ? (
      <span className="text-base-content/50">(blank)</span>
    ) : (
      <>{value}</>
    );
  }
  if (typeof value !== 'object') return <>{String(value)}</>;
  if (isTruncated(value)) {
    return (
      <span className="text-base-content/60">
        (too large to record in full — {String(value.length ?? '?')} characters)
      </span>
    );
  }
  return (
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function isTruncated(value: object): value is { truncated: true; length?: number } {
  return 'truncated' in value && (value as { truncated?: unknown }).truncated === true;
}

/** Only push/local entries carry value snapshots; pull entries never do. */
function hasValueSnapshot(entry: SyncLogEntry): boolean {
  return entry.previousValue !== undefined || entry.newValue !== undefined;
}

function changeName(op: OutboxEntry): string {
  return op.humanName ?? `${op.entityClass.replaceAll('_', ' ')} ${op.fieldPath ?? op.command}`;
}

function logName(entry: SyncLogEntry): string {
  if (entry.humanName) return entry.humanName;
  // Cycle-level failures aren't about one entity.
  if (!entry.entityClass) return entry.reason ?? 'Sync cycle failed';
  return `${entry.entityClass.replaceAll('_', ' ')} ${entry.fieldPath ?? entry.command ?? ''}`.trim();
}

function directionLabel(entry: SyncLogEntry): string {
  if (entry.result === 'reverted') return 'Reverted locally';
  if (entry.result === 'requeued') return 'Requeued after conflict';
  if (entry.result === 'rolled_back') return 'Rolled back';
  if (entry.result === 'retrying') return 'Retrying started';
  if (entry.result === 'failed') {
    // `local` covers a lost session and anything thrown outside the
    // HTTP calls; calling those "Download failed" would point the user
    // at the wrong thing entirely.
    if (entry.direction === 'local') return 'Sync failed';
    return entry.direction === 'push' ? 'Upload failed' : 'Download failed';
  }
  return entry.direction === 'push' ? 'Pushed' : 'Pulled';
}

function statusLabel(op: OutboxEntry): string {
  if (op.status === 'in_flight') return 'Pushing';
  if (op.status === 'transient_retry') return `Retrying (${op.attemptCount})`;
  return 'Waiting';
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function debugText(op: OutboxEntry, hideValues = false): string {
  return JSON.stringify(
    {
      clientOpId: op.clientOpId,
      entityClass: op.entityClass,
      entityId: op.entityId,
      command: op.command,
      fieldPath: op.fieldPath,
      attemptedValue: hideValues ? '[hidden — no access to this character]' : op.attemptedValue,
      previousValue: hideValues ? '[hidden — no access to this character]' : op.prevValue,
      attemptCount: op.attemptCount,
      lastAttemptAt: op.lastAttemptAt,
      nextAttemptAt: op.nextEarliestAttemptAt,
      serverReason: op.serverReason,
      error: op.lastError,
    },
    null,
    2,
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}
