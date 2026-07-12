import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { OutboxEntry, SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';
import { useDialogState } from '../hooks/useDialogState.ts';
import { useToasts } from '../lib/toast.tsx';
import { readUserIdFromToken } from '../lib/tokenStore.ts';
import { getSyncOrchestrator } from '../sync/orchestrator.ts';
import { ConfirmDialog } from './ui/ConfirmDialog.tsx';

interface SyncLogViewProps {
  open: boolean;
  onClose: () => void;
  storageMessage?: string;
}

export function SyncLogView({ open, onClose, storageMessage }: SyncLogViewProps) {
  const ref = useDialogState(open);
  const toasts = useToasts();
  const outbox = useLiveQuery(
    () => getLocalDb().outbox.orderBy('enqueuedAt').reverse().toArray(),
    [],
  );
  const log = useLiveQuery(
    () => getLocalDb().syncLog.orderBy('occurredAt').reverse().limit(1_000).toArray(),
    [],
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
                          {debugText(op)}
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
                />
              ))}
            </SyncSection>

            <SyncSection title="Recently synced" empty="No sync activity has been recorded yet.">
              {(log ?? []).map((entry) => (
                <ChangeRow
                  key={entry.id}
                  title={logName(entry)}
                  meta={`${directionLabel(entry)} · ${formatTime(entry.occurredAt)}`}
                />
              ))}
            </SyncSection>
          </div>

          <footer className="border-t border-base-300 px-5 py-4">
            {storageMessage && (
              <p className="mb-3 text-xs text-base-content/60">{storageMessage}</p>
            )}
            <button
              type="button"
              className="btn btn-error btn-outline btn-sm"
              onClick={() => setResyncOpen(true)}
            >
              Abandon local changes and re-sync from server
            </button>
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

function ChangeRow({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 p-3 text-sm">
      <span className="font-medium">{title}</span>
      <span className="text-base-content/60">{meta}</span>
    </div>
  );
}

function changeName(op: OutboxEntry): string {
  return op.humanName ?? `${op.entityClass.replaceAll('_', ' ')} ${op.fieldPath ?? op.command}`;
}

function logName(entry: SyncLogEntry): string {
  return (
    entry.humanName ??
    `${entry.entityClass.replaceAll('_', ' ')} ${entry.fieldPath ?? entry.command}`
  );
}

function directionLabel(entry: SyncLogEntry): string {
  if (entry.result === 'reverted') return 'Reverted locally';
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

function debugText(op: OutboxEntry): string {
  return JSON.stringify(
    {
      clientOpId: op.clientOpId,
      entityClass: op.entityClass,
      entityId: op.entityId,
      command: op.command,
      fieldPath: op.fieldPath,
      attemptedValue: op.attemptedValue,
      previousValue: op.prevValue,
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
