import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  AdventureLogCreate,
  AdventureLogOut,
  AdventureLogUpdate,
  XpAward,
} from '../../../shared/schemas/adventureLog.ts';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { RichTextEditor } from '../../components/markdown/RichTextEditor.tsx';
import { ApiError, api } from '../../lib/api.ts';

type FilterKind = 'all' | 'shared' | 'private';

/** Snapshot of the draftable fields at submit time. We compare the
 * just-settled mutation's `variables` against the CURRENT draft to
 * decide whether the editor still corresponds to this save (safe to
 * collapse) or the user has typed further since (kept open, untouched).
 * Title is trimmed at submit, so we compare against the trimmed value
 * rather than `draft.title`. */
interface DraftSnapshot {
  sessionDate: string;
  title: string;
  body: string;
  visibility: AdventureLogCreate['visibility'];
  xpAwards: XpAward[];
}

function snapshotOf(draft: AdventureLogCreate, trimmedTitle: string): DraftSnapshot {
  return {
    sessionDate: draft.sessionDate,
    title: trimmedTitle,
    body: draft.body,
    visibility: draft.visibility,
    xpAwards: draft.xpAwards,
  };
}

/** Shallow structural equality on a draft snapshot. Sufficient because
 * every field is a primitive or short flat array of primitives — the
 * zod schema forbids nested objects in `xpAwards` beyond
 * `{ characterId, amount }`, which are themselves primitive
 * (string + number) */
function snapshotMatches(a: DraftSnapshot, b: DraftSnapshot): boolean {
  if (a.sessionDate !== b.sessionDate) return false;
  if (a.title !== b.title) return false;
  if (a.body !== b.body) return false;
  if (a.visibility !== b.visibility) return false;
  if (a.xpAwards.length !== b.xpAwards.length) return false;
  return a.xpAwards.every(
    (award, i) =>
      award.characterId === b.xpAwards[i]?.characterId && award.amount === b.xpAwards[i]?.amount,
  );
}

type EditorState = { kind: 'hidden' } | { kind: 'create' } | { kind: 'edit'; entryId: string };

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

function emptyDraft(): AdventureLogCreate {
  return {
    sessionDate: todayIso(),
    title: '',
    body: '',
    visibility: 'campaign',
    xpAwards: [],
  };
}

function draftFromEntry(entry: AdventureLogOut): AdventureLogCreate {
  return {
    sessionDate: entry.sessionDate,
    title: entry.title,
    body: entry.body,
    visibility: entry.visibility,
    xpAwards: entry.xpAwards,
  };
}

/**
 * Top-level adventure-log page.  When `campaignId` is omitted the
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

  // Current user + campaign metadata — used to decide which entries
  // the viewer may edit/delete (author or campaign owner).
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<{ id: string }>('/auth/me'),
  });
  const campaignQuery = useQuery({
    queryKey: ['campaigns', campaignId],
    queryFn: () => api<CampaignOut>(`/campaigns/${campaignId}`),
    enabled: !!campaignId,
  });

  const [filter, setFilter] = useState<FilterKind>('all');
  const [editor, setEditor] = useState<EditorState>({ kind: 'hidden' });
  const [draft, setDraft] = useState<AdventureLogCreate>(emptyDraft());
  const [saveError, setSaveError] = useState<string | null>(null);

  // Collapse the editor whenever the campaign changes so a stale
  // draft from another campaign can't be committed by accident.
  useEffect(() => {
    setEditor({ kind: 'hidden' });
    setDraft(emptyDraft());
    setSaveError(null);
  }, [campaignId]);

  const create = useMutation({
    mutationFn: (args: { snapshot: DraftSnapshot; payload: AdventureLogCreate }) =>
      api<AdventureLogOut>(`/campaigns/${campaignId}/log`, {
        method: 'POST',
        body: args.payload,
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'log'] });
      // Only collapse the editor if it still corresponds to this save.
      // If the user has already opened a follow-up draft while this
      // request was in flight, leave their newer draft alone — clearing
      // it would silently throw away what they're typing.
      if (
        editor.kind === 'create' &&
        snapshotMatches(snapshotOf(draft, draft.title.trim()), variables.snapshot)
      ) {
        setEditor({ kind: 'hidden' });
        setDraft(emptyDraft());
        setSaveError(null);
      }
    },
    onError: (err) => {
      setSaveError(err instanceof ApiError ? err.message : 'Save failed');
    },
  });

  const update = useMutation({
    mutationFn: (args: {
      entryId: string;
      snapshot: DraftSnapshot;
      patch: AdventureLogUpdate;
    }) =>
      api<AdventureLogOut>(`/campaigns/${campaignId}/log/${args.entryId}`, {
        method: 'PATCH',
        body: args.patch,
      }),
    onSuccess: (_, { entryId, snapshot }) => {
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'log'] });
      // Same guard as create — only clear the editor if no newer draft
      // is waiting in it. Also verifies we're still editing the entry
      // this save targeted (the user may have cancelled and started a
      // different entry's edit in the meantime).
      if (
        editor.kind === 'edit' &&
        editor.entryId === entryId &&
        snapshotMatches(snapshotOf(draft, draft.title.trim()), snapshot)
      ) {
        setEditor({ kind: 'hidden' });
        setDraft(emptyDraft());
        setSaveError(null);
      }
    },
    onError: (err) => {
      setSaveError(err instanceof ApiError ? err.message : 'Save failed');
    },
  });

  const remove = useMutation({
    mutationFn: (entryId: string) =>
      api<void>(`/campaigns/${campaignId}/log/${entryId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'log'] });
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

  const canModify = (entry: AdventureLogOut): boolean => {
    const meId = me.data?.id;
    if (!meId) return false;
    if (entry.authorId === meId) return true;
    return campaignQuery.data?.ownerId === meId;
  };

  const openCreate = () => {
    setDraft(emptyDraft());
    setSaveError(null);
    setEditor({ kind: 'create' });
  };

  const openEdit = (entry: AdventureLogOut) => {
    setDraft(draftFromEntry(entry));
    setSaveError(null);
    setEditor({ kind: 'edit', entryId: entry.id });
  };

  const cancelEditor = () => {
    setEditor({ kind: 'hidden' });
    setDraft(emptyDraft());
    setSaveError(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.title.trim();
    if (!trimmed) return;
    // Snapshot the draft at submit time so the mutation's `onSuccess`
    // can tell whether the editor still corresponds to this save or
    // whether the user has typed further since (in which case we keep
    // the newer draft rather than silently wiping it).
    const snapshot = snapshotOf(draft, trimmed);
    if (editor.kind === 'edit') {
      update.mutate({
        entryId: editor.entryId,
        snapshot,
        patch: { ...draft, title: trimmed },
      });
    } else {
      create.mutate({ snapshot, payload: { ...draft, title: trimmed } });
    }
  };

  const deleting = remove.isPending
    ? (entries.data?.find((e) => e.id === (remove.variables ?? ''))?.id ?? null)
    : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        {campaignIdProp ? (
          <h2 className="font-display text-xl font-semibold leading-none">Adventure Log</h2>
        ) : (
          <div className="min-w-0">
            <p className="label-eyebrow">
              Campaign ·{' '}
              {currentCampaign?.name ?? campaignQuery.data?.name ?? 'No campaign selected'}
            </p>
            <h1 className="font-display text-3xl font-semibold leading-none">Adventure Log</h1>
          </div>
        )}
        <div className="flex items-center gap-2">
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
          {editor.kind === 'hidden' ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!campaignId}
              onClick={openCreate}
            >
              + New entry
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEditor}>
              Cancel
            </button>
          )}
        </div>
      </header>

      {!campaigns.isLoading && (campaigns.data?.length ?? 0) === 0 && !campaignIdProp && (
        <div className="card p-card text-center text-muted">
          You don't belong to any campaigns yet. Create one on the Campaign tab to start a log.
        </div>
      )}

      {campaignId && (
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
      )}

      {editor.kind !== 'hidden' && campaignId && (
        <form className="card space-y-4 p-card" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-[7rem_1fr_7rem]">
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

          <div className="form-control">
            <span className="label-text">Body</span>
            <RichTextEditor
              value={draft.body}
              onChange={(md) => setDraft((d) => ({ ...d, body: md }))}
            />
          </div>

          {saveError && <p className="alert alert-error text-sm">{saveError}</p>}

          <div className="flex justify-end">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={create.isPending || update.isPending || !draft.title.trim()}
            >
              {editor.kind === 'edit'
                ? update.isPending
                  ? 'Saving…'
                  : 'Save changes'
                : create.isPending
                  ? 'Saving…'
                  : 'Save entry'}
            </button>
          </div>
        </form>
      )}

      {entries.isLoading && campaignId && <p className="text-muted">Loading log…</p>}

      {visible.length === 0 && entries.isFetched && campaignId && (
        <p className="text-center text-muted">No entries yet for this filter.</p>
      )}

      <div className="flex flex-col gap-4">
        {visible.map((entry) => {
          const modifiable = canModify(entry);
          // Row edit/delete controls are only rendered when the editor is
          // fully hidden. While a create or edit draft is open elsewhere,
          // clicking Edit here would call `openEdit(entry)` and silently
          // replace the in-progress draft, so we suppress the controls
          // entirely rather than confirming on click.
          const canShowRowActions = modifiable && editor.kind === 'hidden';
          return (
            <article key={entry.id} className="card p-card">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="num text-xs uppercase tracking-widest text-dim">
                  {formatDate(entry.sessionDate)}
                  <span className="ml-2 normal-case tracking-normal text-muted">
                    by <span className="text-base-content">{entry.authorDisplayName}</span>
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {entry.visibility === 'private' && (
                    <span className="chip text-[10px]">private</span>
                  )}
                  {canShowRowActions && (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => openEdit(entry)}
                        aria-label={`Edit ${entry.title}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-error"
                        onClick={() => {
                          if (window.confirm(`Delete "${entry.title}"? This can't be undone.`)) {
                            remove.mutate(entry.id);
                          }
                        }}
                        aria-label={`Delete ${entry.title}`}
                        disabled={deleting === entry.id}
                      >
                        {deleting === entry.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <h3 className="font-display text-2xl font-semibold leading-tight">{entry.title}</h3>
              <div className="log-entry-body mt-3">
                <Markdown source={entry.body} className="text-sm leading-relaxed" />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
