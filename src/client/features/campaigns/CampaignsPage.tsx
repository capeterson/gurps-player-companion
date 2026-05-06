import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CampaignCreate, CampaignOut } from '../../../shared/schemas/campaign.ts';
import { AvatarStack } from '../../components/ui/Avatar.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { CampaignSettingsDialog } from './CampaignSettingsDialog.tsx';
import { InvitationsInbox } from './InvitationsInbox.tsx';

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
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
  // Holds the campaign whose settings dialog is open, or null. Keyed
  // by id so we can rebuild from the live `campaigns.data` and stay
  // in sync when the cache invalidates after a save.
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const settingsCampaign = campaigns.data?.find((c) => c.id === settingsId) ?? null;

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
      <InvitationsInbox />
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
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            create.mutate({ name: trimmed });
          }}
        >
          <div className="flex flex-col gap-1 flex-1 min-w-[200px] max-w-sm">
            <label className="label-text text-xs" htmlFor="new-campaign-name">
              Campaign name
            </label>
            <input
              id="new-campaign-name"
              type="text"
              className="input input-sm input-bordered"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (createError) setCreateError(null);
              }}
              placeholder="Ashes of the Vale"
              // biome-ignore lint/a11y/noAutofocus: user just clicked "+ New campaign"
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
          {createError && <p className="alert alert-error w-full text-sm mt-1">{createError}</p>}
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
          const myMembership = c.members.find((m) => m.userId === myId);
          const isManager = !isOwner && myMembership?.role === 'manager';
          const canManage = isOwner || isManager;
          return (
            <Link
              key={c.id}
              to={`/campaigns/${c.id}`}
              className={`card relative flex items-center gap-4 px-5 py-4 transition hover:border-border-strong ${
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
              <AvatarStack names={c.members.map((m) => m.displayName)} max={6} />
              <span className={`chip ${isOwner ? 'on' : ''}`}>
                {isOwner ? 'Owner' : isManager ? 'Manager' : 'Player'}
              </span>
              {canManage && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  // Stop the wrapping Link from navigating when the
                  // settings button is clicked. preventDefault catches the
                  // anchor's default behaviour; stopPropagation prevents
                  // the click from reaching the Link's React handler.
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSettingsId(c.id);
                  }}
                  aria-label={`Settings for ${c.name}`}
                  title="Campaign settings"
                >
                  ⚙
                </button>
              )}
            </Link>
          );
        })}
      </div>

      {settingsCampaign &&
        (() => {
          const myMembership = settingsCampaign.members.find((m) => m.userId === myId);
          const viewerRole =
            myId === settingsCampaign.ownerId ? 'owner' : (myMembership?.role ?? 'member');
          return (
            <CampaignSettingsDialog
              open={true}
              campaign={settingsCampaign}
              viewerRole={viewerRole}
              onClose={() => setSettingsId(null)}
            />
          );
        })()}
    </div>
  );
}
