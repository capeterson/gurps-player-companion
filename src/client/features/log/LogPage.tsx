import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AdventureLogCreate, AdventureLogOut } from '../../../shared/schemas/adventureLog.ts';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import { ApiError, api } from '../../lib/api.ts';

type FilterKind = 'all' | 'shared' | 'private';

/** Today as 'YYYY-MM-DD' in the user's local calendar. `toISOString()`
 * is UTC, which during local evening hours pushes the default forward
 * a day in U.S. time zones — assemble from local date parts instead. */
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Render a 'YYYY-MM-DD' session date as a friendly local string.
 * Parsing as `new Date('YYYY-MM-DDT00:00:00Z')` would shift the day
 * for west-of-UTC users (May 5 entry shows as May 4); construct the
 * Date from numeric parts so it lives at local midnight on the right
 * calendar day regardless of zone. */
function formatDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  const [y, m, d] = parts;
  if (parts.length !== 3 || !y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Top-level adventure-log page.  When `campaignIdProp` is omitted the
 * page picks a campaign from the `?campaign=` query string (or the
 * first one available) and mirrors the selection back into the URL —
 * the legacy /log behaviour.  When a parent route passes the id
 * directly (e.g. /campaigns/:id), the URL-sync logic is skipped and
 * the page just renders the log for that campaign.
 */
export function LogPage({ campaignId: campaignIdProp }: { campaignId?: string } = {}) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<CampaignOut[]>('/campaigns'),
    enabled: !campaignIdProp,
  });

  const urlCampaign = params.get('campaign');
  const campaignId = useMemo(() => {
    if (campaignIdProp) return campaignIdProp;
    if (urlCampaign && campaigns.data?.some((c) => c.id === urlCampaign)) return urlCampaign;
    return campaigns.data?.[0]?.id ?? null;
  }, [campaignIdProp, urlCampaign, campaigns.data]);

  // Mirror the resolved campaign back to the URL so reloads are stable
  // (only when this page owns the routing — embedded mode is driven by
  // the parent route's path param).
  useEffect(() => {
    if (campaignIdProp) return;
    if (campaignId && urlCampaign !== campaignId) {
      const next = new URLSearchParams(params);
      next.set('campaign', campaignId);
      setParams(next, { replace: true });
    }
  }, [campaignIdProp, campaignId, urlCampaign, params, setParams]);

  const entries = useQuery({
    queryKey: ['campaigns', campaignId, 'log'],
    queryFn: () => api<AdventureLogOut[]>(`/campaigns/${campaignId}/log`),
    enabled: !!campaignId,
  });

  const [filter, setFilter] = useState<FilterKind>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<AdventureLogCreate>({
    sessionDate: todayIso(),
    title: '',
    body: '',
    visibility: 'campaign',
    xpAwards: [],
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (snap: AdventureLogCreate) =>
      api<AdventureLogOut>(`/campaigns/${campaignId}/log`, {
        method: 'POST',
        body: snap,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'log'] });
      setShowCreate(false);
      setDraft({
        sessionDate: todayIso(),
        title: '',
        body: '',
        visibility: 'campaign',
        xpAwards: [],
      });
      setCreateError(null);
    },
    onError: (err) => {
      setCreateError(err instanceof ApiError ? err.message : 'Save failed');
    },
  });

  const counts = useMemo(() => {
    const all = entries.data ?? [];
    return {
      all: all.length,
      shared: all.filter((e) => e.visibility === 'campaign').length,
      private: all.filter((e) => e.visibility === 'private').length,
    };
  }, [entries.data]);

  const visible = useMemo(() => {
    const all = entries.data ?? [];
    if (filter === 'shared') return all.filter((e) => e.visibility === 'campaign');
    if (filter === 'private') return all.filter((e) => e.visibility === 'private');
    return all;
  }, [entries.data, filter]);

  const currentCampaign = useMemo(
    () => campaigns.data?.find((c) => c.id === campaignId) ?? null,
    [campaigns.data, campaignId],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="label-eyebrow">
            Campaign · {currentCampaign?.name ?? 'No campaign selected'}
          </p>
          <h1 className="font-display text-4xl font-semibold leading-none">Adventure Log</h1>
        </div>
        <div className="flex items-center gap-3">
          {campaigns.data && campaigns.data.length > 1 && (
            <select
              className="select select-bordered select-sm"
              value={campaignId ?? ''}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set('campaign', e.target.value);
                setParams(next);
              }}
              aria-label="Select campaign"
            >
              {campaigns.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!campaignId}
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Cancel' : '+ New entry'}
          </button>
        </div>
      </header>

      {!campaigns.isLoading && (campaigns.data?.length ?? 0) === 0 && (
        <div className="card p-card text-center text-muted">
          You don't belong to any campaigns yet. Create one on the Campaign tab to start a log.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`chip ${filter === 'all' ? 'on' : ''}`}
        >
          All <span className="num text-dim ml-1">{counts.all}</span>
        </button>
        <button
          type="button"
          onClick={() => setFilter('shared')}
          className={`chip ${filter === 'shared' ? 'on' : ''}`}
        >
          Shared <span className="num text-dim ml-1">{counts.shared}</span>
        </button>
        <button
          type="button"
          onClick={() => setFilter('private')}
          className={`chip ${filter === 'private' ? 'on' : ''}`}
        >
          Private <span className="num text-dim ml-1">{counts.private}</span>
        </button>
      </div>

      {showCreate && campaignId && (
        <form
          className="card grid gap-3 p-card"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = draft.title.trim();
            if (!trimmed) return;
            create.mutate({ ...draft, title: trimmed });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_8rem]">
            <label className="form-control">
              <span className="label-text">Date</span>
              <input
                type="date"
                className="input input-bordered"
                value={draft.sessionDate}
                onChange={(e) => setDraft({ ...draft, sessionDate: e.target.value })}
                required
              />
            </label>
            <label className="form-control">
              <span className="label-text">Title</span>
              <input
                type="text"
                className="input input-bordered"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Session 13 — The Hollow Beneath Greymoor"
                required
              />
            </label>
            <label className="form-control">
              <span className="label-text">Visibility</span>
              <select
                className="select select-bordered"
                value={draft.visibility}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    visibility: e.target.value as AdventureLogCreate['visibility'],
                  })
                }
              >
                <option value="campaign">Shared</option>
                <option value="private">Private</option>
              </select>
            </label>
          </div>
          <label className="form-control">
            <span className="label-text">Body</span>
            <textarea
              className="textarea textarea-bordered min-h-[10rem]"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="What happened, who acted, what's left to follow up on…"
            />
          </label>
          {createError && <p className="alert alert-error text-sm">{createError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={create.isPending || !draft.title.trim()}
            >
              {create.isPending ? 'Saving…' : 'Save entry'}
            </button>
          </div>
        </form>
      )}

      {entries.isLoading && campaignId && <p className="text-muted">Loading log…</p>}

      {visible.length === 0 && entries.isFetched && campaignId && (
        <p className="text-center text-muted">No entries yet for this filter.</p>
      )}

      <div className="flex flex-col gap-4">
        {visible.map((entry) => (
          <article key={entry.id} className="card p-card">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="num text-xs uppercase tracking-widest text-dim">
                {formatDate(entry.sessionDate)}
              </span>
              {entry.visibility === 'private' && <span className="chip text-[10px]">private</span>}
            </div>
            <h3 className="font-display text-2xl font-semibold leading-tight">{entry.title}</h3>
            <div className="mt-1 mb-3 text-xs text-muted">
              by <span className="text-base-content">{entry.authorDisplayName}</span>
            </div>
            <p className="whitespace-pre-line text-sm leading-relaxed">{entry.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
