import { Table, TableHeader, TableRow } from '../../components/ui/Table.tsx';
/**
 * /admin/users — paginated list of users with a search box. Each row
 * links to the per-user detail page where suspend/purge live.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/admin.ts';

const PAGE_SIZE = 50;

export function UsersPage() {
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
            <Table preferenceKey="admin:users" className="table table-zebra">
              <thead>
                <tr className="text-base-content/50 text-[10px] uppercase tracking-wider">
                  <TableHeader column="email" label="Email" />
                  <TableHeader column="name" label="Display name" />
                  <TableHeader column="characters" label="Characters" className="text-right" />
                  <TableHeader column="campaigns" label="Campaigns" className="text-right" />
                  <TableHeader column="status" label="Status" />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((u) => (
                  <TableRow
                    filterValues={{
                      email: u.email,
                      name: u.displayName,
                      characters: u.characterCount,
                      campaigns: u.campaignCount,
                      status: [
                        u.isActive ? 'active' : 'suspended',
                        ...(u.isSuperuser ? ['superuser'] : []),
                        ...(u.purgeScheduledAt ? ['purge'] : []),
                      ],
                    }}
                    key={u.id}
                    className="hover"
                  >
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
                  </TableRow>
                ))}
                {list.data.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-sm text-base-content/60 py-6">
                      No matching users.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
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
