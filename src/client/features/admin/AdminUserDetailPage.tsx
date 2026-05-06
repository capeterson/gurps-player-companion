/**
 * /admin/users/:id — full user dump with the suspend / purge state
 * machine. Owned characters and campaigns are surfaced as small lists
 * so the admin can navigate to the per-campaign detail without leaving
 * the admin tree.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { adminApi } from '../../lib/admin.ts';
import { ApiError } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';

export function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toasts = useToasts();
  const queryKey = ['admin', 'user', id] as const;

  const detail = useQuery({
    queryKey,
    queryFn: () => adminApi.getUser(id ?? ''),
    enabled: typeof id === 'string' && id.length > 0,
  });

  const onActionError = (err: unknown) =>
    toasts.push(err instanceof ApiError ? err.message : 'Action failed', { kind: 'error' });
  const onActionSuccess = () => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['admin', 'users'] });
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="label-eyebrow">
            <Link to="/admin/users" className="link">
              ← All users
            </Link>
          </p>
          <h1 className="font-display text-3xl">{u.displayName}</h1>
          <p className="text-sm text-base-content/60">{u.email}</p>
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
              disabled={suspend.isPending}
            >
              Suspend
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-success btn-sm"
              onClick={() => unsuspend.mutate()}
              disabled={unsuspend.isPending || u.purgeScheduledAt !== null}
              title={u.purgeScheduledAt ? 'Cancel purge first' : undefined}
            >
              Unsuspend
            </button>
          )}
          {u.purgeScheduledAt ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => cancelPurge.mutate()}
              disabled={cancelPurge.isPending}
            >
              Cancel purge
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-error btn-sm"
              onClick={() => purge.mutate()}
              disabled={purge.isPending}
            >
              Schedule purge (30 d)
            </button>
          )}
        </div>
      </section>

      <section className="card p-card space-y-3">
        <p className="label-eyebrow">Characters ({u.characters.length})</p>
        {u.characters.length === 0 ? (
          <p className="text-sm text-base-content/60">No characters owned.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {u.characters.map((ch) => (
              <li key={ch.id} className="flex justify-between gap-3">
                <Link to={`/characters/${ch.id}`} className="link link-primary truncate">
                  {ch.name}
                </Link>
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
