/**
 * /admin/campaigns/:id — read-only campaign dump for instance admins.
 * Lists members + their roles + active state, and characters in the
 * campaign with a link to the sheet view.
 */

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { adminApi } from '../../lib/admin.ts';

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useQuery({
    queryKey: ['admin', 'campaign', id],
    queryFn: () => adminApi.getCampaign(id ?? ''),
    enabled: typeof id === 'string' && id.length > 0,
  });

  if (!id) return <p className="alert alert-error">Missing campaign id.</p>;
  if (detail.isLoading) return <p className="text-sm text-base-content/60">Loading…</p>;
  if (detail.isError) {
    return (
      <p className="alert alert-error text-sm">
        {(detail.error as Error).message ?? 'Failed to load campaign.'}
      </p>
    );
  }
  const c = detail.data;
  if (!c) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="label-eyebrow">
            <Link to="/admin/campaigns" className="link">
              ← All campaigns
            </Link>
          </p>
          <h1 className="font-display text-3xl">{c.name}</h1>
          {c.description && (
            <p className="text-sm text-base-content/60 max-w-prose">{c.description}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <span className={`badge ${c.shareCharacterSheets ? 'badge-ghost' : 'badge-warning'}`}>
            {c.shareCharacterSheets ? 'sheets shared' : 'sheets private'}
          </span>
        </div>
      </header>

      <section className="card p-card space-y-3">
        <p className="label-eyebrow">Owner</p>
        <p className="text-sm">
          <Link to={`/admin/users/${c.ownerId}`} className="link link-primary">
            {c.ownerDisplayName}
          </Link>
          <span className="ml-2 text-xs text-base-content/60">{c.ownerEmail}</span>
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-base-content/60 text-xs">Created</dt>
            <dd>{new Date(c.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-base-content/60 text-xs">Caps · Target</dt>
            <dd className="num">
              pt {c.pointTarget ?? '—'} · disad {c.disadvantageCap ?? '—'} · quirk{' '}
              {c.quirkCap ?? '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card p-card space-y-3">
        <p className="label-eyebrow">Members ({c.members.length})</p>
        <ul className="space-y-1 text-sm">
          {c.members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3">
              <Link to={`/admin/users/${m.userId}`} className="link link-primary truncate">
                {m.displayName}
              </Link>
              <span className="text-xs text-base-content/60">{m.email}</span>
              <span
                className={`badge badge-sm ${
                  m.role === 'owner'
                    ? 'badge-primary'
                    : m.role === 'manager'
                      ? 'badge-secondary'
                      : 'badge-ghost'
                }`}
              >
                {m.role}
              </span>
              {!m.isActive && <span className="badge badge-warning badge-sm">suspended</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-card space-y-3">
        <p className="label-eyebrow">Characters ({c.characters.length})</p>
        {c.characters.length === 0 ? (
          <p className="text-sm text-base-content/60">No characters in this campaign.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {c.characters.map((ch) => (
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
    </div>
  );
}
