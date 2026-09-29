/**
 * /admin/users/:id — full user dump with the suspend / purge state
 * machine. Owned characters and campaigns are surfaced as small lists
 * so the admin can navigate to the per-campaign detail without leaving
 * the admin tree.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { adminApi } from '../../lib/admin.ts';
import { ApiError } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';
import { readUserIdFromToken } from '../../lib/tokenStore.ts';

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toasts = useToasts();
  const queryKey = ['admin', 'user', id] as const;
  const [purgeConfirmation, setPurgeConfirmation] = useState<string>();

  const detail = useQuery({
    queryKey,
    queryFn: () => adminApi.getUser(id ?? ''),
    enabled: typeof id === 'string' && id.length > 0,
  });

  const onActionError = (err: unknown) =>
    toasts.push(err instanceof ApiError ? err.message : 'Action failed', { kind: 'error' });
  const onActionSuccess = async () => {
    setPurgeConfirmation(undefined);
    await Promise.all([
      qc.invalidateQueries({ queryKey }),
      qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
      qc.invalidateQueries({ queryKey: ['admin', 'campaign'] }),
    ]);
  };

  const suspend = useMutation({
    mutationFn: () => adminApi.suspend(id ?? ''),
    onSuccess: onActionSuccess,
    onError: onActionError,
  });
  const unsuspend = useMutation({
    mutationFn: () => adminApi.unsuspend(id ?? ''),
    onSuccess: onActionSuccess,
    onError: onActionError,
  });
  const purge = useMutation({
    mutationFn: () => adminApi.schedulePurge(id ?? ''),
    onSuccess: onActionSuccess,
    onError: onActionError,
  });
  const cancelPurge = useMutation({
    mutationFn: () => adminApi.cancelPurge(id ?? ''),
    onSuccess: onActionSuccess,
    onError: onActionError,
  });

  if (!id) return <p className="alert alert-error">Missing user id.</p>;
  if (detail.isLoading) return <p className="text-sm text-base-content/60">Loading…</p>;
  if (detail.isError) {
    return (
      <p className="alert alert-error text-sm">
        {(detail.error as Error).message ?? 'Failed to load user.'}
      </p>
    );
  }
  const u = detail.data;
  if (!u) return null;
  const isSelf = u.id === readUserIdFromToken();
  const busy = suspend.isPending || unsuspend.isPending || purge.isPending || cancelPurge.isPending;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="label-eyebrow">
            <Link to="/admin/users" className="link">
              ← All users
            </Link>
          </p>
          <h1 className="font-display break-all text-3xl">{u.displayName}</h1>
          <p className="break-all text-sm text-base-content/60">{u.email}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {u.isSuperuser && <span className="badge badge-secondary">superuser</span>}
          {!u.isActive && <span className="badge badge-warning">suspended</span>}
          {u.purgeScheduledAt && <span className="badge badge-error">purge pending</span>}
          {u.isActive && !u.purgeScheduledAt && <span className="badge badge-ghost">active</span>}
        </div>
      </header>

      <section className="card p-card space-y-3">
        <p className="label-eyebrow">Account state</p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-base-content/60 text-xs">Created</dt>
            <dd>{new Date(u.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-base-content/60 text-xs">Suspended at</dt>
            <dd>{u.suspendedAt ? new Date(u.suspendedAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt className="text-base-content/60 text-xs">Purge scheduled</dt>
            <dd>{u.purgeScheduledAt ? new Date(u.purgeScheduledAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt className="text-base-content/60 text-xs">Owned characters · campaigns</dt>
            <dd>
              <span className="num">{u.characterCount}</span> ·{' '}
              <span className="num">{u.campaignCount}</span>
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          {u.isActive ? (
            <button
              type="button"
              className="btn btn-warning btn-sm"
              onClick={() => suspend.mutate()}
              disabled={busy || isSelf}
            >
              Suspend
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-success btn-sm"
              onClick={() => unsuspend.mutate()}
              disabled={busy || isSelf || u.purgeScheduledAt !== null}
            >
              Unsuspend
            </button>
          )}
          {u.purgeScheduledAt ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => cancelPurge.mutate()}
              disabled={busy}
            >
              Cancel purge
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-error btn-sm"
              onClick={() => setPurgeConfirmation(id)}
              disabled={busy || isSelf}
            >
              Schedule purge (30 d)
            </button>
          )}
        </div>
        {isSelf && (
          <p className="text-sm text-base-content/60">
            You cannot suspend or purge your own account.
          </p>
        )}
        {u.purgeScheduledAt && (
          <p className="text-sm text-base-content/60">
            Deletion runs nightly at 03:00 UTC after the scheduled date. Cancel purge before
            unsuspending this account.
          </p>
        )}
      </section>

      <ConfirmDialog
        open={purgeConfirmation === id}
        title="Schedule account purge?"
        confirmLabel="Schedule purge"
        tone="error"
        pending={purge.isPending}
        pendingLabel="Scheduling…"
        onConfirm={() => purge.mutate()}
        onCancel={() => setPurgeConfirmation(undefined)}
      >
        <p>
          This immediately suspends {u.email} and revokes their sessions, API keys and connected
          apps. After 30 days, the nightly job permanently deletes this account, its owned
          characters and campaigns, including campaign libraries and logs. Other players keep their
          characters. Audit history is retained. Uploaded images are removed by image cleanup when
          no longer attached. You can cancel the purge before the job runs; cancellation leaves the
          account suspended.
        </p>
      </ConfirmDialog>

      <section className="card p-card space-y-3">
        <p className="label-eyebrow">Characters ({u.characters.length})</p>
        {u.characters.length === 0 ? (
          <p className="text-sm text-base-content/60">No characters owned.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {u.characters.map((ch) => (
              <li key={ch.id} className="flex justify-between gap-3">
                {/* Cross-bundle: character sheets live in the player app. */}
                <a href={`/characters/${ch.id}`} className="link link-primary truncate">
                  {ch.name}
                </a>
                <span className="text-base-content/40">
                  {new Date(ch.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-card space-y-3">
        <p className="label-eyebrow">Campaigns ({u.campaigns.length})</p>
        {u.campaigns.length === 0 ? (
          <p className="text-sm text-base-content/60">No campaigns.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {u.campaigns.map((cmp) => (
              <li key={cmp.id} className="flex justify-between gap-3">
                <Link to={`/admin/campaigns/${cmp.id}`} className="link link-primary truncate">
                  {cmp.name}
                </Link>
                <span className="badge badge-ghost badge-sm">{cmp.role}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
