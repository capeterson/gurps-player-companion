import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api.ts';
import { formatBytes, readLocalDbStatus } from '../../lib/localDbStatus.ts';
import { useToasts } from '../../lib/toast.tsx';

export function SettingsPage() {
  const toasts = useToasts();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const localDb = useQuery({
    queryKey: ['settings', 'local-db-status'],
    queryFn: readLocalDbStatus,
    staleTime: 5_000,
  });

  const changePassword = useMutation({
    mutationFn: () => {
      if (newPassword !== confirmPassword) throw new Error('New passwords do not match');
      return api<void>('/auth/password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      toasts.push('Password changed', { kind: 'success' });
    },
    onError: (err) => {
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : 'password change failed';
      setError(message);
      toasts.push(`Couldn't change password — ${message}`, { kind: 'error' });
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <p className="label-eyebrow">Account</p>
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="max-w-2xl text-sm text-muted">
          Manage your sign-in credentials and inspect the browser-local Dexie/IndexedDB cache.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <form
          className="card gap-4 bg-base-200 p-5 border border-base-300"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            changePassword.mutate();
          }}
        >
          <div>
            <p className="label-eyebrow">Security</p>
            <h2 className="font-display text-2xl">Change password</h2>
          </div>
          <label className="form-control">
            <span className="label-text">Current password</span>
            <input
              type="password"
              className="input input-bordered"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label className="form-control">
            <span className="label-text">New password</span>
            <input
              type="password"
              className="input input-bordered"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <label className="form-control">
            <span className="label-text">Confirm new password</span>
            <input
              type="password"
              className="input input-bordered"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {error && <p className="text-sm text-error">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary w-fit"
            disabled={changePassword.isPending}
          >
            {changePassword.isPending ? 'Changing…' : 'Change password'}
          </button>
        </form>

        <section className="card gap-4 bg-base-200 p-5 border border-base-300">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="label-eyebrow">Local data</p>
              <h2 className="font-display text-2xl">Dexie status</h2>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => localDb.refetch()}
              disabled={localDb.isFetching}
            >
              {localDb.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {localDb.isError ? (
            <p className="text-sm text-error">
              Couldn’t inspect local DB — {(localDb.error as Error).message}
            </p>
          ) : (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-dim">Sync state</dt>
                <dd>{localDb.data?.syncState ?? 'Checking…'}</dd>
              </div>
              <div>
                <dt className="text-dim">Dexie / IndexedDB state</dt>
                <dd>{localDb.data?.dexieState ?? 'Checking…'}</dd>
              </div>
              <div>
                <dt className="text-dim">Local storage used</dt>
                <dd className="num">{formatBytes(localDb.data?.storageUsageBytes ?? null)}</dd>
              </div>
              <div>
                <dt className="text-dim">Browser quota</dt>
                <dd className="num">{formatBytes(localDb.data?.storageQuotaBytes ?? null)}</dd>
              </div>
              <div>
                <dt className="text-dim">Databases</dt>
                <dd>
                  {localDb.data?.databaseNames.length
                    ? localDb.data.databaseNames.join(', ')
                    : 'None detected'}
                </dd>
              </div>
              <div>
                <dt className="text-dim">Last checked</dt>
                <dd>{localDb.data?.refreshedAt.toLocaleTimeString() ?? '—'}</dd>
              </div>
            </dl>
          )}
        </section>
      </section>
    </div>
  );
}
