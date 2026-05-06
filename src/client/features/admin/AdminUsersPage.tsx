/**
 * /admin/users — paginated list of users with a search box. Each row
 * links to the per-user detail page where suspend/purge live.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/admin.ts';

const PAGE_SIZE = 50;

export function AdminUsersPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  const list = useQuery({
    queryKey: ['admin', 'users', q, offset],
    queryFn: () => adminApi.listUsers({ q: q || undefined, limit: PAGE_SIZE, offset }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <p className="label-eyebrow">Admin</p>
        <h1 className="font-display text-3xl">Users</h1>
        <p className="text-sm text-base-content/60">
          Search by email or display name. Click a row for suspend / purge controls.
        </p>
      </header>

      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(0);
        }}
        placeholder="Search by email or display name…"
        className="input input-bordered input-sm w-full max-w-sm"
        aria-label="Search users"
      />

      {list.isLoading && <p className="text-sm text-base-content/60">Loading…</p>}
      {list.isError && (
        <p className="alert alert-error text-sm">
          {(list.error as Error).message ?? 'Failed to load users.'}
        </p>
      )}

      {list.data && (
        <>
          <div className="overflow-x-auto rounded border border-base-300">
            <table className="table table-zebra">
              <thead>
                <tr className="text-base-content/50 text-[10px] uppercase tracking-wider">
                  <th>Email</th>
                  <th>Display name</th>
                  <th className="text-right">Characters</th>
                  <th className="text-right">Campaigns</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((u) => (
                  <tr key={u.id} className="hover">
                    <td>
                      <Link to={`/admin/users/${u.id}`} className="link link-primary">
                        {u.email}
                      </Link>
                    </td>
                    <td>{u.displayName}</td>
                    <td className="num text-right">{u.characterCount}</td>
                    <td className="num text-right">{u.campaignCount}</td>
                    <td className="text-xs">
                      {u.purgeScheduledAt && (
                        <span className="badge badge-error badge-sm mr-1">purge</span>
                      )}
                      {!u.isActive && (
                        <span className="badge badge-warning badge-sm mr-1">suspended</span>
                      )}
                      {u.isSuperuser && (
                        <span className="badge badge-secondary badge-sm mr-1">superuser</span>
                      )}
                      {u.isActive && !u.purgeScheduledAt && (
                        <span className="badge badge-ghost badge-sm">active</span>
                      )}
                    </td>
                  </tr>
                ))}
                {list.data.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-sm text-base-content/60 py-6">
                      No matching users.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-base-content/60">
            <span>
              Showing {offset + 1}–{Math.min(offset + list.data.items.length, list.data.total)} of{' '}
              {list.data.total}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Prev
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setPage((p) => p + 1)}
                disabled={offset + list.data.items.length >= list.data.total}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
