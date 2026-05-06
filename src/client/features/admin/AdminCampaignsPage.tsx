/**
 * /admin/campaigns — paginated campaign list with search across name,
 * owner display name, and owner email.  Each row links to the per-
 * campaign admin detail.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/admin.ts';

const PAGE_SIZE = 50;

export function AdminCampaignsPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  const list = useQuery({
    queryKey: ['admin', 'campaigns', q, offset],
    queryFn: () => adminApi.listCampaigns({ q: q || undefined, limit: PAGE_SIZE, offset }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <p className="label-eyebrow">Admin</p>
        <h1 className="font-display text-3xl">Campaigns</h1>
        <p className="text-sm text-base-content/60">
          Search by campaign name, owner display name, or owner email.
        </p>
      </header>

      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(0);
        }}
        placeholder="Search campaigns…"
        className="input input-bordered input-sm w-full max-w-sm"
        aria-label="Search campaigns"
      />

      {list.isLoading && <p className="text-sm text-base-content/60">Loading…</p>}
      {list.isError && (
        <p className="alert alert-error text-sm">
          {(list.error as Error).message ?? 'Failed to load campaigns.'}
        </p>
      )}

      {list.data && (
        <>
          <div className="overflow-x-auto rounded border border-base-300">
            <table className="table table-zebra">
              <thead>
                <tr className="text-base-content/50 text-[10px] uppercase tracking-wider">
                  <th>Campaign</th>
                  <th>Owner</th>
                  <th className="text-right">Members</th>
                  <th className="text-right">Characters</th>
                  <th>Sheets</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr key={c.id} className="hover">
                    <td>
                      <Link to={`/admin/campaigns/${c.id}`} className="link link-primary">
                        {c.name}
                      </Link>
                    </td>
                    <td>
                      <Link to={`/admin/users/${c.ownerId}`} className="link">
                        {c.ownerDisplayName}
                      </Link>
                      <span className="ml-2 text-xs text-base-content/50">{c.ownerEmail}</span>
                    </td>
                    <td className="num text-right">{c.memberCount}</td>
                    <td className="num text-right">{c.characterCount}</td>
                    <td className="text-xs">
                      {c.shareCharacterSheets ? (
                        <span className="badge badge-ghost badge-sm">shared</span>
                      ) : (
                        <span className="badge badge-warning badge-sm">private</span>
                      )}
                    </td>
                  </tr>
                ))}
                {list.data.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-sm text-base-content/60 py-6">
                      No matching campaigns.
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
