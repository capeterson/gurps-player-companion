import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { EntityClass } from '../../shared/schemas/sync.ts';
import type { OutboxEntry, SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';
import { syncEntityTable } from '../db/syncEntityStore.ts';
import { useDialogState } from '../hooks/useDialogState.ts';
import { useToasts } from '../lib/toast.tsx';
import { readUserIdFromToken } from '../lib/tokenStore.ts';
import { buildSyncDebugDump } from '../sync/debugDump.ts';
import { buildPendingImageExport } from '../sync/mediaRecovery.ts';
import {
  characterAccessFrom,
  isOutboxAccessRestricted,
  isRecordAccessRestricted,
} from '../sync/minimalViewSweep.ts';
import { getSyncOrchestrator } from '../sync/orchestrator.ts';
import { resolveLegacyCampaignDependency } from '../sync/outbox.ts';
import {
  isSuccessfulSyncOperation,
  lastSuccessfulSyncKey,
  readRevokedCampaigns,
  readRevokedCharacters,
} from '../sync/syncLog.ts';
import { loadSyncLogEntry } from '../sync/syncLogPayload.ts';
import {
  focusedSyncLogValues,
  syncFieldLabel,
  syncLogEntityLink,
  syncLogTitle,
} from '../sync/syncLogPresentation.ts';
import { useSyncStatus } from '../sync/useSyncIndicatorState.ts';
import { useSyncWsStatus } from '../sync/useSyncWsStatus.ts';
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
  const websocket = useSyncWsStatus();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [open]);
  const lastSuccess = useLiveQuery(async () => {
    const value = (await getLocalDb().syncMeta.get(lastSuccessfulSyncKey()))?.value;
    return typeof value === 'string' ? value : undefined;
  }, []);
  const outbox = useLiveQuery(
    () => getLocalDb().outbox.orderBy('enqueuedAt').reverse().toArray(),
    [],
  );
  const log = useLiveQuery(
    () => getLocalDb().syncLog.orderBy('occurredAt').reverse().limit(1_000).toArray(),
    [],
  );
  // Bulk-read each class once. Never decompress journal bodies to render titles.
  const entities = useLiveQuery(async () => {
    const groups = new Map<EntityClass, Set<string>>();
    for (const record of [...(log ?? []), ...(outbox ?? [])]) {
      if (!record.entityClass || !record.entityId) continue;
      const ids = groups.get(record.entityClass) ?? new Set<string>();
      ids.add(record.entityId);
      groups.set(record.entityClass, ids);
    }
    const result = new Map<string, Record<string, unknown>>();
    await Promise.all(
      [...groups].map(async ([entityClass, idSet]) => {
        const ids = [...idSet];
        const rows = await syncEntityTable(entityClass)?.bulkGet(ids);
        rows?.forEach((row, index) => {
          if (row) result.set(`${entityClass}:${ids[index]}`, row);
        });
      }),
    );
    return result;
  }, [log, outbox]);
  const currentEntity = (record: {
    entityClass?: string | undefined;
    entityId?: string | undefined;
  }) => entities?.get(`${record.entityClass}:${record.entityId}`);
  const lastOperation = [lastSuccess, (log ?? []).find(isSuccessfulSyncOperation)?.occurredAt]
    .filter((at): at is string => typeof at === 'string' && Number.isFinite(Date.parse(at)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  // The outbox is deliberately NOT swept when access is downgraded --
  // a queued op is the user's own unsent intent and still has to be
  // delivered. But its `prevValue` can hold another player's private
  // value, so this view has to apply the share gate itself rather than
  // print whatever the row happens to carry.
  const access = useLiveQuery(
    async () => {
      const [characters, revokedCharacters, revokedCampaigns] = await Promise.all([
        getLocalDb().characters.toArray(),
        readRevokedCharacters(),
        readRevokedCampaigns(),
      ]);
      return characterAccessFrom(characters, revokedCharacters, revokedCampaigns);
    },
    [],
    {
      known: new Set<string>(),
      masked: new Set<string>(),
      revoked: new Set<string>(),
      revokedCampaigns: new Set<string>(),
    },
  );
  const [revertTarget, setRevertTarget] = useState<OutboxEntry | null>(null);
  const [resyncOpen, setResyncOpen] = useState(false);
  const pendingImages = useLiveQuery(() => getLocalDb().mediaUploads.count(), [], 0);
  const [working, setWorking] = useState(false);

  const failures = (outbox ?? []).filter((op) => op.attemptCount >= 4);
  const pending = (outbox ?? []).filter((op) => op.attemptCount < 4);
  const recentChanges = combineBursts(combineAcknowledgements(log ?? []));
  const campaignHolds = (outbox ?? []).filter((op) => op.localCampaignDependencyUnknown);
  const confirmCampaignOrder = async (op: OutboxEntry, wait: boolean) => {
    try {
      await resolveLegacyCampaignDependency(op.clientOpId, wait);
      toasts.push('Campaign order saved. Your addition remains queued.', { kind: 'success' });
    } catch (err) {
      toasts.push(`Could not save campaign order — ${errorMessage(err)}`, { kind: 'error' });
    }
  };

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

  const downloadPendingImages = async () => {
    try {
      const data = await buildPendingImageExport();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'pending-images.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toasts.push(`Couldn't export pending images — ${errorMessage(error)}`, { kind: 'error' });
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
        <div className="modal-box flex max-h-[88dvh] max-w-[min(56rem,calc(100dvw-2rem))] flex-col border border-base-300 bg-base-100 p-0">
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
            <section
              aria-label="Connection status"
              className="grid gap-4 border-b border-base-300 pb-4 sm:grid-cols-2"
            >
              <div>
                <p className="text-xs text-base-content/60">WebSocket</p>
                <p className="mt-1 flex items-center gap-2 font-medium">
                  <span
                    aria-hidden="true"
                    className={`status status-sm ${online && websocket.state === 'connected' ? 'status-success' : 'status-warning'}`}
                  />
                  {online ? wsLabel(websocket.state) : 'Offline'}
                </p>
                {(!online || websocket.state !== 'connected') && (
                  <p className="mt-1 text-xs text-base-content/60">
                    {websocket.lastConnectedAt ? (
                      <>
                        Last connected <RelativeTime at={websocket.lastConnectedAt} now={now} />
                      </>
                    ) : (
                      'Not yet connected'
                    )}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-base-content/60">Last successful sync</p>
                <p className="mt-1 font-medium">
                  {lastOperation ? (
                    <RelativeTime at={lastOperation} now={now} />
                  ) : (
                    'No successful sync recorded'
                  )}
                </p>
                {online && websocket.state !== 'connected' && (
                  <p className="mt-1 text-xs text-base-content/60">
                    HTTP sync continues while WebSocket reconnects.
                  </p>
                )}
              </div>
            </section>
            {campaignHolds.length > 0 && (
              <section aria-label="Confirm campaign order">
                <h3 className="font-semibold text-warning">Confirm an older unsaved addition</h3>
                <p className="text-sm">
                  The app update could not recover which campaign this library addition belongs to.
                  Your addition and campaign change are saved locally and paused. Choose the library
                  you selected it from to continue syncing.
                </p>
                {campaignHolds.map((op) => (
                  <article key={op.clientOpId} className="mt-3 space-y-2">
                    <p>
                      {!isOutboxAccessRestricted(op, access) &&
                      syncLogEntityLink(op, currentEntity(op)) ? (
                        <a
                          className="link link-hover"
                          href={syncLogEntityLink(op, currentEntity(op))}
                        >
                          {changeName(op, false, currentEntity(op))}
                        </a>
                      ) : (
                        changeName(op, isOutboxAccessRestricted(op, access), currentEntity(op))
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void confirmCampaignOrder(op, false)}
                      >
                        Original campaign
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void confirmCampaignOrder(op, true)}
                      >
                        Destination campaign
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )}
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
                          <p className="font-semibold text-error">
                            {!isOutboxAccessRestricted(op, access) &&
                            syncLogEntityLink(op, currentEntity(op)) ? (
                              <a
                                className="link link-hover"
                                href={syncLogEntityLink(op, currentEntity(op))}
                              >
                                {changeName(op, false, currentEntity(op))}
                              </a>
                            ) : (
                              changeName(
                                op,
                                isOutboxAccessRestricted(op, access),
                                currentEntity(op),
                              )
                            )}
                          </p>
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
                  title={changeName(op, isOutboxAccessRestricted(op, access), currentEntity(op))}
                  href={
                    !isOutboxAccessRestricted(op, access)
                      ? syncLogEntityLink(op, currentEntity(op))
                      : undefined
                  }
                  meta={`${statusLabel(op)} · ${formatTime(op.enqueuedAt)}`}
                  details={
                    <PendingDetails op={op} hideValues={isOutboxAccessRestricted(op, access)} />
                  }
                />
              ))}
            </SyncSection>

            <SyncSection title="Recently synced" empty="No sync activity has been recorded yet.">
              {recentChanges.map(({ entry, responses, members }) => (
                <ChangeRow
                  key={entry.id}
                  title={logName(
                    entry,
                    isRecordAccessRestricted(entry, access),
                    currentEntity(entry),
                  )}
                  href={
                    !isRecordAccessRestricted(entry, access)
                      ? syncLogEntityLink(entry, currentEntity(entry))
                      : undefined
                  }
                  meta={`${directionLabel(entry)} · ${relativeTime(entry.occurredAt, now)}`}
                  tone={
                    entry.result === 'failed' || entry.result === 'rolled_back' ? 'bad' : undefined
                  }
                  details={
                    <LogDetails
                      entry={entry}
                      restricted={isRecordAccessRestricted(entry, access)}
                      members={members.filter(
                        (member) => !isRecordAccessRestricted(member, access),
                      )}
                      responses={responses.filter(
                        (response) => !isRecordAccessRestricted(response, access),
                      )}
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
              {pendingImages > 0 && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm h-auto whitespace-normal py-2"
                  onClick={() => void downloadPendingImages()}
                >
                  Export {pendingImages} unsaved image{pendingImages === 1 ? '' : 's'}
                </button>
              )}
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
        Export unsaved images first if you want to keep their original files. This permanently
        discards every pending local edit and unsaved image, clears the local database, and
        downloads a fresh copy from the server.
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
  href,
  meta,
  details,
  tone,
}: {
  title: string;
  href?: string | undefined;
  meta: string;
  details?: React.ReactNode;
  tone?: 'bad' | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!details) {
    return (
      <div className="flex flex-wrap justify-between gap-2 p-3 text-sm">
        {href ? (
          <a
            href={href}
            className="link link-hover min-w-0 max-w-full wrap-anywhere font-medium text-primary"
            onClick={(event) => event.stopPropagation()}
          >
            {title}
          </a>
        ) : (
          <span className="min-w-0 max-w-full wrap-anywhere font-medium">{title}</span>
        )}
        <span className="text-base-content/60">{meta}</span>
      </div>
    );
  }
  return (
    <details className="group text-sm" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 p-3 hover:bg-base-200">
        <span
          aria-hidden="true"
          className="inline-block text-base-content/40 transition-transform group-open:rotate-90"
        >
          ›
        </span>
        {href ? (
          <a
            href={href}
            className="link link-hover min-w-0 max-w-full wrap-anywhere font-medium text-primary"
            onClick={(event) => event.stopPropagation()}
          >
            {title}
          </a>
        ) : (
          <span className="min-w-0 max-w-full wrap-anywhere font-medium">{title}</span>
        )}
        <span className={`ml-auto ${tone === 'bad' ? 'text-error' : 'text-base-content/60'}`}>
          {meta}
        </span>
      </summary>
      {expanded && (
        <div className="border-base-300 border-t bg-base-200/40 px-3 py-2">{details}</div>
      )}
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

interface SyncLogItem {
  entry: SyncLogEntry;
  responses: SyncLogEntry[];
  members: SyncLogEntry[];
}

/** Match exact entity+revision. REST refreshes can change local data; retain that diff. */
function combineAcknowledgements(entries: SyncLogEntry[]): SyncLogItem[] {
  const pushes = new Map<string, SyncLogItem>();
  const items = entries.map<SyncLogItem>((entry) => ({ entry, responses: [], members: [entry] }));
  const responseKey = (entry: SyncLogEntry, revision: unknown) =>
    entry.entityClass && entry.entityId && typeof revision === 'number'
      ? JSON.stringify([entry.entityClass, entry.entityId, revision])
      : undefined;
  for (const item of items) {
    const { entry } = item;
    if (entry.direction !== 'push' || entry.result !== 'synced') continue;
    const key = responseKey(entry, logMetadata(entry)?.newRevision);
    // The journal is newest first. Keep the latest acknowledgement if an
    // idempotent retry recorded the same revision more than once.
    if (key && !pushes.has(key)) pushes.set(key, item);
  }
  return items.filter((item) => {
    const { entry } = item;
    const appliedFields = logMetadata(entry)?.appliedFields;
    if (entry.direction !== 'pull' || entry.result !== 'synced' || !Array.isArray(appliedFields))
      return true;
    const key = responseKey(entry, logMetadata(entry)?.revision);
    const push = key ? pushes.get(key) : undefined;
    if (
      !push ||
      (!push.entry.source &&
        (hasValueSnapshot(entry) ||
          appliedFields.length !== 0 ||
          Date.parse(push.entry.occurredAt) > Date.parse(entry.occurredAt)))
    )
      return true;
    push.responses.push(entry);
    return false;
  });
}

/** Only explicitly identified, continuous successful numeric bursts collapse. */
function combineBursts(items: SyncLogItem[]): SyncLogItem[] {
  const active = new Map<string, SyncLogItem>();
  const result: SyncLogItem[] = [];
  const number = (entry: SyncLogEntry, side: 'previous' | 'new') => {
    const value = side === 'previous' ? entry.previousValue : entry.newValue;
    return typeof value === 'number'
      ? value
      : entry.payloadMetadata?.[side === 'previous' ? 'previousNumber' : 'newNumber'];
  };
  for (const item of items) {
    const { entry } = item;
    if (!entry.entityClass || !entry.entityId) active.clear();
    else if (!entry.fieldPath) {
      for (const [key, candidate] of active) {
        if (
          candidate.entry.entityClass === entry.entityClass &&
          candidate.entry.entityId === entry.entityId
        )
          active.delete(key);
      }
    }
    const scope = JSON.stringify([entry.entityClass, entry.entityId, entry.fieldPath]);
    const previous = number(entry, 'previous');
    const next = number(entry, 'new');
    const eligible =
      entry.batchId &&
      entry.direction === 'push' &&
      entry.result === 'synced' &&
      entry.command === 'patch' &&
      entry.fieldPath &&
      !entry.redacted &&
      typeof previous === 'number' &&
      typeof next === 'number';
    const newer = active.get(scope);
    if (
      eligible &&
      newer &&
      newer.entry.batchId === entry.batchId &&
      number(newer.members[newer.members.length - 1] as SyncLogEntry, 'previous') === next
    ) {
      newer.members.push(...item.members);
      newer.responses.push(...item.responses);
      continue;
    }
    // A failure, download, different burst or discontinuity is a hard boundary.
    active.delete(scope);
    if (eligible) active.set(scope, item);
    result.push(item);
  }
  return result;
}

function logMetadata(entry: SyncLogEntry): Record<string, unknown> | undefined {
  return entry.details !== null && typeof entry.details === 'object'
    ? (entry.details as Record<string, unknown>)
    : entry.payloadMetadata;
}

function LogDetails({
  entry,
  restricted,
  responses,
  members,
}: {
  entry: SyncLogEntry;
  restricted: boolean;
  responses: SyncLogEntry[];
  members: SyncLogEntry[];
}) {
  const [loaded, setLoaded] = useState<{
    source: SyncLogEntry;
    entry?: SyncLogEntry;
    members?: SyncLogEntry[];
    error?: string;
  }>();
  useEffect(() => {
    if (restricted || (!entry.payloadStored && members.length === 1)) return;
    let active = true;
    void Promise.all(members.map(loadSyncLogEntry)).then(
      (values) =>
        active &&
        setLoaded({
          source: entry,
          entry: {
            ...(values[0] as SyncLogEntry),
            previousValue: values[values.length - 1]?.previousValue,
          },
          members: values,
        }),
      (error) => active && setLoaded({ source: entry, error: errorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [entry, restricted, members]);
  if (!restricted && (entry.payloadStored || members.length > 1)) {
    if (loaded?.source !== entry || !loaded.entry) {
      return (
        <output className="block text-xs text-base-content/60">
          {loaded?.source === entry && loaded.error
            ? `Couldn't load change details — ${loaded.error}`
            : 'Loading change details…'}
        </output>
      );
    }
    return (
      <LogDetailsContent
        entry={loaded.entry}
        restricted={loaded.entry.redacted === true}
        responses={responses}
        members={loaded.members ?? [loaded.entry]}
      />
    );
  }
  return (
    <LogDetailsContent
      entry={entry}
      restricted={restricted}
      responses={responses}
      members={members}
    />
  );
}

function LogDetailsContent({
  entry,
  restricted,
  responses,
  members,
}: {
  entry: SyncLogEntry;
  restricted: boolean;
  responses: SyncLogEntry[];
  members: SyncLogEntry[];
}) {
  const rows: DetailRow[] = [];
  if (members.length > 1)
    rows.push(
      textRow(
        'Changes',
        `${members.length} rapid adjustments · net change ${typeof entry.newValue === 'number' && typeof entry.previousValue === 'number' ? entry.newValue - entry.previousValue : ''}`,
      ),
    );
  if (entry.reason) rows.push(textRow('Reason', entry.reason, 'error'));
  if (entry.fieldPath) rows.push(textRow('Field', syncFieldLabel(entry.fieldPath)));
  if (entry.source) rows.push(textRow('Source', entry.source));
  if (restricted) {
    // Either scrubbed at rest by the sweep, or still holding values for
    // an entity the viewer can no longer see -- an offline revert can
    // write a fresh character snapshot after the last sweep ran, with
    // no later pull to clean it up.
    const subject = entry.entityClass === 'campaign' ? 'campaign' : 'character';
    rows.push(textRow('Values', `removed — you no longer have access to this ${subject}`));
  } else if (hasValueSnapshot(entry)) {
    const focused = focusedSyncLogValues(entry);
    if (!entry.fieldPath && focused.changedFields.length > 0)
      rows.push(textRow('Changed', focused.changedFields.map(syncFieldLabel).join(', ')));
    if (
      (isEmptySnapshot(focused.previousValue) && isEmptySnapshot(focused.newValue)) ||
      (entry.fieldPath &&
        focused.changedFields.length === 0 &&
        !isTruncatedSnapshot(focused.previousValue) &&
        !isTruncatedSnapshot(focused.newValue))
    ) {
      rows.push(textRow('Values', 'no data fields changed locally'));
    } else {
      rows.push(
        entry.command === 'create' && focused.previousValue === undefined
          ? textRow('Before', 'No entry')
          : valueRow('Before', focused.previousValue),
      );
      rows.push(
        entry.command === 'delete' && entry.result === 'synced' && focused.newValue === undefined
          ? textRow('After', 'Removed')
          : valueRow('After', focused.newValue),
      );
    }
  } else if (entry.direction === 'pull') {
    // New entries always carry `appliedFields`, including an empty
    // list for revision-only/protected-field pulls. Older entries lack
    // that marker because their values truly were never captured.
    const appliedFields = logMetadata(entry)?.appliedFields;
    rows.push(
      textRow(
        'Values',
        Array.isArray(appliedFields)
          ? 'no data fields changed locally'
          : 'not recorded by the app version that downloaded this change',
      ),
    );
  }
  if (entry.entityClass) rows.push(textRow('Entity', entry.entityClass.replaceAll('_', ' ')));
  if (entry.entityId) rows.push(textRow('Entity id', entry.entityId));
  if (entry.command) rows.push(textRow('Operation', entry.command));
  const refreshed = [
    ...new Set(
      responses.flatMap((response) => {
        const fields = logMetadata(response)?.appliedFields;
        return Array.isArray(fields)
          ? fields.filter((field): field is string => typeof field === 'string')
          : [];
      }),
    ),
  ];
  if (refreshed.length)
    rows.push(
      textRow('Local refresh', `${refreshed.map(syncFieldLabel).join(', ')} (details in Response)`),
    );
  rows.push(textRow('When', formatTime(entry.occurredAt)));

  return (
    <>
      <DetailList rows={rows} />
      <div className="flex flex-wrap items-start gap-x-6">
        {!restricted &&
          entry.direction === 'push' &&
          (entry.request !== undefined || entry.result === 'synced') && (
            <PayloadDisclosure
              label="Request"
              note={
                entry.request === undefined
                  ? 'Recorded operation fields; the original request was not retained.'
                  : undefined
              }
              value={
                members.length > 1
                  ? [...members]
                      .reverse()
                      .map((member) => ({ occurredAt: member.occurredAt, request: member.request }))
                  : (entry.request ?? {
                      entityClass: entry.entityClass,
                      entityId: entry.entityId,
                      parentId: entry.parentId,
                      command: entry.command,
                      fieldPath: entry.fieldPath,
                      prevValue: entry.previousValue,
                      attemptedValue: entry.newValue,
                    })
              }
            />
          )}
        {/* Outcomes can carry a whole latestEntity; apply the same access gate
          to both the acknowledgement and its associated cursor response. */}
        {!restricted && (entry.details !== undefined || responses.length > 0) && (
          <PayloadDisclosure
            label="Response"
            loadValue={async () => {
              const decoded = await Promise.all(responses.map(loadSyncLogEntry));
              return decoded.length > 0
                ? {
                    acknowledgement:
                      members.length > 1
                        ? [...members].reverse().map((member) => ({
                            occurredAt: member.occurredAt,
                            response: member.details,
                          }))
                        : entry.details,
                    cursor: decoded.map((response) => ({
                      occurredAt: response.occurredAt,
                      ...logMetadata(response),
                      ...(hasValueSnapshot(response)
                        ? { previousValue: response.previousValue, newValue: response.newValue }
                        : {}),
                    })),
                  }
                : members.length > 1
                  ? [...members].reverse().map((member) => ({
                      occurredAt: member.occurredAt,
                      response: member.details,
                    }))
                  : entry.details;
            }}
          />
        )}
      </div>
    </>
  );
}

function PayloadDisclosure({
  label,
  value,
  loadValue,
  note,
}: {
  label: string;
  note?: string | undefined;
  value?: unknown;
  loadValue?: () => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="mt-2 min-w-0 max-w-full open:w-full sm:open:w-[calc(50%-0.75rem)]"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs text-base-content/60">{label}</summary>
      {expanded && (
        <>
          {note && <p className="mt-1 text-xs text-base-content/60">{note}</p>}
          <PayloadText value={value} loadValue={loadValue} />
        </>
      )}
    </details>
  );
}

function PayloadText({
  value,
  loadValue,
}: { value?: unknown; loadValue?: (() => Promise<unknown>) | undefined }) {
  const [loaded, setLoaded] = useState<{
    source: typeof loadValue;
    value?: unknown;
    error?: string;
  }>();
  useEffect(() => {
    if (!loadValue) return;
    let active = true;
    void loadValue().then(
      (value) => active && setLoaded({ source: loadValue, value }),
      (error) => active && setLoaded({ source: loadValue, error: errorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [loadValue]);
  if (loadValue && (loaded?.source !== loadValue || loaded.error)) {
    return (
      <output className="mt-1 block text-xs text-base-content/60">
        {loaded?.source === loadValue && loaded.error
          ? `Couldn't load response — ${loaded.error}`
          : 'Loading response…'}
      </output>
    );
  }
  return (
    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
      {JSON.stringify(loadValue ? loaded?.value : value, null, 2)}
    </pre>
  );
}

function PendingDetails({ op, hideValues }: { op: OutboxEntry; hideValues: boolean }) {
  const rows: DetailRow[] = [];
  if (op.fieldPath) rows.push(textRow('Field', syncFieldLabel(op.fieldPath)));
  if (hideValues) {
    rows.push(textRow('Values', 'hidden — you no longer have access to this character'));
  } else {
    const focused = focusedSyncLogValues({
      command: op.command,
      fieldPath: op.fieldPath,
      previousValue: op.prevValue,
      newValue: op.command === 'delete' ? undefined : op.attemptedValue,
    });
    if (!op.fieldPath && focused.changedFields.length)
      rows.push(textRow('Changed', focused.changedFields.map(syncFieldLabel).join(', ')));
    if (
      (isEmptySnapshot(focused.previousValue) && isEmptySnapshot(focused.newValue)) ||
      (op.fieldPath &&
        focused.changedFields.length === 0 &&
        !isTruncatedSnapshot(focused.previousValue) &&
        !isTruncatedSnapshot(focused.newValue))
    ) {
      rows.push(textRow('Values', 'no data fields changed locally'));
    } else {
      rows.push(
        op.command === 'create' && focused.previousValue === undefined
          ? textRow('Before', 'No entry')
          : valueRow('Before', focused.previousValue),
      );
      rows.push(
        op.command === 'delete'
          ? textRow('After', 'Removed locally')
          : valueRow('After', focused.newValue),
      );
    }
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

/** Undefined is a valid one side of a create/delete, so either side is sufficient. */
function hasValueSnapshot(entry: SyncLogEntry): boolean {
  return (
    entry.previousValue !== undefined ||
    entry.newValue !== undefined ||
    entry.payloadMetadata?.hasValueSnapshot === true
  );
}

/**
 * `humanName` embeds private content on a child op (`skill "Stealth"`,
 * `item "Hidden Blade"`), and it is the row's visible title -- so a
 * restricted op falls back to the generic class label.
 */
function changeName(op: OutboxEntry, restricted = false, row?: Record<string, unknown>): string {
  if (restricted) return `${op.entityClass.replaceAll('_', ' ')} ${op.command}`;
  if (row)
    return syncLogTitle(
      { ...op, id: op.clientOpId, direction: 'push', result: 'synced', occurredAt: op.enqueuedAt },
      row,
    );
  return op.humanName ?? `${op.entityClass.replaceAll('_', ' ')} ${op.fieldPath ?? op.command}`;
}

function logName(entry: SyncLogEntry, restricted = false, row?: Record<string, unknown>): string {
  if (!restricted && (entry.entityName || row)) return syncLogTitle(entry, row);
  if (entry.humanName && !restricted) return entry.humanName;
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

function wsLabel(state: string): string {
  return (
    (
      {
        connecting: 'Connecting',
        connected: 'Connected',
        reconnecting: 'Disconnected · Reconnecting',
        offline: 'Offline',
        stopped: 'Not connected',
      } as Record<string, string>
    )[state] ?? 'Not connected'
  );
}

export function relativeTime(at: string, now: number): string {
  const delta = Math.max(0, now - Date.parse(at));
  if (!Number.isFinite(delta)) return 'Unknown';
  if (delta < 60_000) return 'just now';
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86_400_000],
    ['month', 30 * 86_400_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  const [unit, size] = units.find(([, size]) => delta >= size) ?? ['minute', 60_000];
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(
    -Math.floor(delta / size),
    unit,
  );
}

function RelativeTime({ at, now }: { at: string; now: number }) {
  return (
    <time dateTime={at} title={formatTime(at)}>
      {relativeTime(at, now)}
    </time>
  );
}

function isEmptySnapshot(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function isTruncatedSnapshot(value: unknown): boolean {
  return (
    value !== null && typeof value === 'object' && 'truncated' in value && value.truncated === true
  );
}
