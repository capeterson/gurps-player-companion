import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CampaignCreate, CampaignOut } from '../../../shared/schemas/campaign.ts';
import { ApiError, api } from '../../lib/api.ts';

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
}

const AVATAR_PALETTE = [
  'bg-base-200',
  'bg-base-300/40',
  'bg-base-200',
  'bg-base-300/40',
  'bg-base-200',
  'bg-base-300/40',
];

function initialFor(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

export function CampaignsPage() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<CampaignOut[]>('/campaigns'),
  });

  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const create = useMutation({
    mutationFn: (snap: { name: string }) =>
      api<CampaignOut>('/campaigns', {
        method: 'POST',
        body: { name: snap.name } satisfies CampaignCreate,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setName('');
      setShowCreate(false);
      setCreateError(null);
    },
    onError: (err) => {
      setCreateError(err instanceof ApiError ? err.message : 'Create failed');
    },
  });

  const myId = me.data?.id;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="label-eyebrow">Workspace · {me.data?.displayName ?? '…'}</p>
          <h1 className="font-display text-4xl font-semibold leading-none">Your Campaigns</h1>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? 'Cancel' : '+ New campaign'}
        </button>
      </header>

      {showCreate && (
        <form
          className="card grid gap-3 p-card sm:grid-cols-[minmax(16rem,28rem)_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            create.mutate({ name: trimmed });
          }}
        >
          <label className="form-control">
            <span className="label-text">Campaign name</span>
            <input
              type="text"
              className="input input-bordered"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (createError) setCreateError(null);
              }}
              placeholder="Ashes of the Vale"
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
          {createError && <p className="alert alert-error sm:col-span-2 text-sm">{createError}</p>}
        </form>
      )}

      {campaigns.isLoading && <p className="text-muted">Loading campaigns…</p>}
      {campaigns.isError && (
        <p className="alert alert-error">Failed to load campaigns. Refresh to retry.</p>
      )}

      {campaigns.data && campaigns.data.length === 0 && !showCreate && (
        <div className="card p-card text-center text-muted">
          <p>No campaigns yet.</p>
          <p className="text-sm">
            Create one to share characters and an adventure log with your table.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(campaigns.data ?? []).map((c) => {
          const isOwner = myId === c.ownerId;
          return (
            <Link
              key={c.id}
              to={`/log?campaign=${c.id}`}
              className={`card flex items-center gap-4 px-5 py-4 transition hover:border-border-strong ${
                isOwner ? 'border-l-[3px] border-l-primary' : ''
              }`}
            >
              <div
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-field border border-dashed border-border-strong text-[10px] uppercase tracking-widest text-dim"
              >
                cover
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-semibold truncate">{c.name}</div>
                <div className="mt-0.5 text-xs text-muted">
                  <span className="num">{c.members.length}</span> member
                  {c.members.length === 1 ? '' : 's'}
                  {c.description ? <> · {c.description}</> : null}
                </div>
              </div>
              <div className="flex items-center" aria-label="Members">
                {c.members.slice(0, 6).map((m, j) => (
                  <div
                    key={m.userId}
                    title={m.displayName}
                    className={`flex h-6 w-6 items-center justify-center rounded-full border border-base-300 text-[10px] text-muted ${
                      AVATAR_PALETTE[j % AVATAR_PALETTE.length]
                    }`}
                    style={{ marginLeft: j === 0 ? 0 : '-0.5rem' }}
                  >
                    {initialFor(m.displayName)}
                  </div>
                ))}
              </div>
              <span className={`chip ${isOwner ? 'on' : ''}`}>{isOwner ? 'Owner' : 'Player'}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
