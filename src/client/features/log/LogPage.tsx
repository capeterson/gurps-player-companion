import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type {
  AdventureLogCreate,
  AdventureLogOut,
  AdventureLogUpdate,
  XpAward,
} from '../../../shared/schemas/adventureLog.ts';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { RichTextEditor } from '../../components/markdown/RichTextEditor.tsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { InfoTooltip } from '../../components/ui/InfoTooltip.tsx';
import { QueryReadError } from '../../components/ui/QueryReadError.tsx';
import { useSelectedCampaignId } from '../../hooks/useSelectedCampaignId.ts';
import { ApiError, api } from '../../lib/api.ts';
import { getSyncOrchestrator } from '../../sync/orchestrator.ts';
import { useCampaignCharactersList, useCharactersList } from '../characters/useCharacterDetail.ts';

type FilterKind = 'all' | 'shared' | 'private';

/** Snapshot of the draftable fields at submit time. We compare the
 * just-settled mutation's `variables` against the CURRENT draft to
 * decide whether the editor still corresponds to this save (safe to
 * collapse) or the user has typed further since (kept open, untouched).
 * Title is trimmed at submit, so we compare against the trimmed value
 * rather than `draft.title`. */
interface DraftSnapshot {
  sessionDate: string;
  sessionNumber: number | null;
  title: string;
  location: string;
  body: string;
  visibility: AdventureLogCreate['visibility'];
  characterId: string | null;
  xpAwards: XpAward[];
  pointsGained: number | null;
  awardCharacterIds: string[] | null;
}

function snapshotOf(
  draft: AdventureLogCreate,
  trimmedTitle: string,
  trimmedLocation: string,
): DraftSnapshot {
  return {
    sessionDate: draft.sessionDate,
    sessionNumber: draft.sessionNumber ?? null,
    title: trimmedTitle,
    location: trimmedLocation,
    body: draft.body,
    visibility: draft.visibility,
    characterId: draft.characterId ?? null,
    xpAwards: draft.xpAwards,
    pointsGained: draft.pointsGained ?? null,
    awardCharacterIds: draft.awardCharacterIds ?? null,
  };
}

/** Shallow structural equality on a draft snapshot. Sufficient because
 * every field is a primitive or short flat array of primitives — the
 * zod schema forbids nested objects in `xpAwards` beyond
 * `{ characterId, amount }`, which are themselves primitive
 * (string + number) */
function snapshotMatches(a: DraftSnapshot, b: DraftSnapshot): boolean {
  if (a.sessionDate !== b.sessionDate) return false;
  if (a.sessionNumber !== b.sessionNumber) return false;
  if (a.title !== b.title) return false;
  if (a.location !== b.location) return false;
  if (a.body !== b.body) return false;
  if (a.visibility !== b.visibility) return false;
  if (a.characterId !== b.characterId) return false;
  if (a.pointsGained !== b.pointsGained) return false;
  if (JSON.stringify(a.awardCharacterIds) !== JSON.stringify(b.awardCharacterIds)) return false;
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

function emptyDraft(sessionNumber: number | null = null): AdventureLogCreate {
  return {
    sessionDate: todayIso(),
    sessionNumber,
    title: '',
    location: '',
    body: '',
    visibility: 'campaign',
    characterId: null,
    xpAwards: [],
    pointsGained: null,
    awardCharacterIds: null,
  };
}

/** The first campaign session is zero; after that, suggest one beyond the
 * greatest posted session number. Null-numbered notes do not affect the
 * sequence, and the suggestion remains fully editable in the form. */
export function nextSessionNumber(entries: readonly AdventureLogOut[]): number {
  return (
    entries.reduce(
      (greatest, entry) =>
        entry.sessionNumber === null ? greatest : Math.max(greatest, entry.sessionNumber),
      -1,
    ) + 1
  );
}

function pointsForEntry(entry: AdventureLogOut): number | null {
  if (entry.pointsGained != null) return entry.pointsGained;
  const first = entry.xpAwards[0];
  return first &&
    first.amount >= 0 &&
    entry.xpAwards.every((award) => award.amount === first.amount)
    ? first.amount
    : null;
}

function draftFromEntry(entry: AdventureLogOut): AdventureLogCreate {
  return {
    sessionDate: entry.sessionDate,
    sessionNumber: entry.sessionNumber,
    title: entry.title,
    location: entry.location ?? '',
    body: entry.body,
    visibility: entry.visibility,
    characterId: entry.characterId ?? undefined,
    xpAwards: entry.xpAwards,
    pointsGained: pointsForEntry(entry),
    awardCharacterIds: [...new Set(entry.xpAwards.map((award) => award.characterId))],
  };
}

/**
 * Top-level adventure-log page.  When `campaignId` is omitted the
 * page picks a campaign from the `?campaign=` query string (or the
 * first one available) and mirrors the selection back into the URL —
 * the legacy /log behaviour.  When a parent route passes the id
 * directly (e.g. /campaigns/:id/log), the URL-sync logic is skipped and
 * the page just renders the log for that campaign.
 */
export function LogPage({ campaignId: campaignIdProp }: { campaignId?: string } = {}) {
  const qc = useQueryClient();
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<CampaignOut[]>('/campaigns'),
    enabled: !campaignIdProp,
  });

  const { campaignId, params, setParams } = useSelectedCampaignId(campaignIdProp, campaigns.data);

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

  const characters = useCharactersList();
  const ownedCharacters = (characters ?? []).filter(
    (character) => character.ownerId === me.data?.id,
  );
  const roster = useCampaignCharactersList(campaignId ?? undefined);
  const [recipientDialog, setRecipientDialog] = useState(false);
  const [recipientSelection, setRecipientSelection] = useState<string[]>([]);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [editor, setEditor] = useState<EditorState>({ kind: 'hidden' });
  const [draft, setDraft] = useState<AdventureLogCreate>(emptyDraft());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [entryToDelete, setEntryToDelete] = useState<AdventureLogOut | null>(null);

  // Collapse the editor whenever the campaign changes so a stale
  // draft from another campaign can't be committed by accident.
  useEffect(() => {
    void campaignId;
    setEditor({ kind: 'hidden' });
    setDraft(emptyDraft());
    setSaveError(null);
    setEntryToDelete(null);
    setRecipientDialog(false);
  }, [campaignId]);

  const create = useMutation({
    mutationFn: (args: { snapshot: DraftSnapshot; payload: AdventureLogCreate }) =>
      api<AdventureLogOut>(`/campaigns/${campaignId}/log`, {
        method: 'POST',
        body: args.payload,
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'log'] });
      void getSyncOrchestrator()
        .triggerCursorPull()
        .catch(() => undefined);
      // Only collapse the editor if it still corresponds to this save.
      // If the user has already opened a follow-up draft while this
      // request was in flight, leave their newer draft alone — clearing
      // it would silently throw away what they're typing.
      if (
        editor.kind === 'create' &&
        snapshotMatches(
          snapshotOf(draft, draft.title.trim(), (draft.location ?? '').trim()),
          variables.snapshot,
        )
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
      void getSyncOrchestrator()
        .triggerCursorPull()
        .catch(() => undefined);
      // Same guard as create — only clear the editor if no newer draft
      // is waiting in it. Also verifies we're still editing the entry
      // this save targeted (the user may have cancelled and started a
      // different entry's edit in the meantime).
      if (
        editor.kind === 'edit' &&
        editor.entryId === entryId &&
        snapshotMatches(
          snapshotOf(draft, draft.title.trim(), (draft.location ?? '').trim()),
          snapshot,
        )
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
      setEntryToDelete(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'log'] });
      void getSyncOrchestrator()
        .triggerCursorPull()
        .catch(() => undefined);
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
    const next = emptyDraft(nextSessionNumber(entries.data ?? []));
    if (campaignQuery.data?.ownerId !== me.data?.id) {
      next.awardCharacterIds = (roster ?? [])
        .filter((character) => character.ownerId === me.data?.id)
        .map((character) => character.id);
    }
    setDraft(next);
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
    const trimmedLocation = (draft.location ?? '').trim();
    // Explicit null (not undefined) so an emptied box clears the stored
    // value on PATCH — buildPatchSet treats undefined as "field omitted".
    const location = trimmedLocation === '' ? null : trimmedLocation;
    const sessionNumber = draft.sessionNumber ?? null;
    // Snapshot the draft at submit time so the mutation's `onSuccess`
    // can tell whether the editor still corresponds to this save or
    // whether the user has typed further since (in which case we keep
    // the newer draft rather than silently wiping it).
    const snapshot = snapshotOf(draft, trimmed, trimmedLocation);
    if (editor.kind === 'edit') {
      const original = entries.data?.find((entry) => entry.id === editor.entryId);
      const originalDraft = original ? draftFromEntry(original) : null;
      const unchangedAwards =
        originalDraft &&
        draft.pointsGained === originalDraft.pointsGained &&
        JSON.stringify(draft.awardCharacterIds) === JSON.stringify(originalDraft.awardCharacterIds);
      update.mutate({
        entryId: editor.entryId,
        snapshot,
        patch: {
          ...draft,
          ...((draft.characterId ?? null) === (original?.characterId ?? null) &&
          draft.visibility === original?.visibility
            ? { characterId: undefined, visibility: undefined }
            : {}),
          title: trimmed,
          location,
          sessionNumber,
          // Leave historical concrete awards alone for ordinary text edits,
          // including legacy entries with duplicate recipient rows.
          xpAwards: undefined,
          ...(unchangedAwards ? { pointsGained: undefined, awardCharacterIds: undefined } : {}),
          // Heterogeneous legacy awards have no single amount to display; keep
          // their concrete list when the optional amount is left blank.
          ...(draft.pointsGained == null && original && pointsForEntry(original) === null
            ? { pointsGained: undefined }
            : {}),
        },
      });
    } else {
      create.mutate({ snapshot, payload: { ...draft, title: trimmed, location, sessionNumber } });
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
          {!campaignIdProp && campaigns.data && campaigns.data.length > 1 && (
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
              disabled={!campaignId || entries.isLoading}
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

      {campaigns.isError && !campaignIdProp && (
        <QueryReadError
          label="campaigns"
          error={campaigns.error}
          onRetry={() => void campaigns.refetch()}
        />
      )}
      {!campaigns.isLoading &&
        !campaigns.isError &&
        (campaigns.data?.length ?? 0) === 0 &&
        !campaignIdProp && (
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
            All <span className="num text-dim ml-1">{entries.data ? counts.all : '—'}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('shared')}
            className={`chip ${filter === 'shared' ? 'on' : ''}`}
          >
            Shared <span className="num text-dim ml-1">{entries.data ? counts.shared : '—'}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('private')}
            className={`chip ${filter === 'private' ? 'on' : ''}`}
          >
            Private <span className="num text-dim ml-1">{entries.data ? counts.private : '—'}</span>
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
            <div className="form-control min-w-0">
              <div className="flex items-baseline gap-2">
                <label htmlFor="log-attachment" className="label-text">
                  Attached to
                </label>
                <InfoTooltip
                  ariaLabel="About log attachments"
                  side="bottom"
                  contentClassName="w-64 max-h-[calc(100dvh-2rem)] overflow-y-auto"
                  content="Campaign entries are shared with all campaign members. Select one of your characters to make a private entry visible only to you. Point recipients are chosen separately."
                >
                  ?
                </InfoTooltip>
              </div>
              <select
                id="log-attachment"
                className="select w-full min-w-0"
                value={
                  draft.characterId ?? (draft.visibility === 'private' ? 'legacy-private' : '')
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    characterId: e.target.value || null,
                    visibility: e.target.value ? 'private' : 'campaign',
                  })
                }
              >
                <option value="">Campaign</option>
                {draft.visibility === 'private' && !draft.characterId && (
                  <option value="legacy-private" disabled>
                    Private (no character attached)
                  </option>
                )}
                {draft.characterId &&
                  !ownedCharacters.some((character) => character.id === draft.characterId) && (
                    <option value={draft.characterId} disabled>
                      Private (character unavailable)
                    </option>
                  )}
                {ownedCharacters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
            <label className="form-control">
              <span className="label-text">Session #</span>
              <input
                type="number"
                min={0}
                className="input input-bordered"
                value={draft.sessionNumber ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    sessionNumber: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                placeholder="13"
                aria-label="Session number"
              />
            </label>
            <label className="form-control">
              <span className="label-text">Location</span>
              <input
                type="text"
                className="input input-bordered"
                value={draft.location ?? ''}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                placeholder="The Hollow Beneath Greymoor"
                aria-label="Location"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="form-control w-40">
              <span className="label-text">Points gained (optional)</span>
              <input
                type="number"
                className="input input-bordered"
                min={0}
                max={1000}
                step={1}
                value={draft.pointsGained ?? ''}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    pointsGained: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </label>
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-muted">
                {draft.awardCharacterIds == null
                  ? 'Applies to all current campaign characters'
                  : `Applies to ${draft.awardCharacterIds.length} selected character${draft.awardCharacterIds.length === 1 ? '' : 's'}`}
              </p>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => {
                  setRecipientSelection(
                    draft.awardCharacterIds ?? (roster ?? []).map((character) => character.id),
                  );
                  setRecipientDialog(true);
                }}
              >
                Choose characters
              </button>
            </div>
          </div>
          <p className="text-xs text-muted">
            Points increase each recipient’s character point cap. Editing or deleting an award
            adjusts that credit. The campaign’s starting point target stays the same.
          </p>

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
      {entries.isError && campaignId && (
        <QueryReadError
          label="adventure log"
          error={entries.error}
          onRetry={() => void entries.refetch()}
        />
      )}

      {visible.length === 0 && entries.isFetched && !entries.isError && campaignId && (
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
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
                <span className="num text-xs uppercase tracking-widest text-dim">
                  {formatDate(entry.sessionDate)}
                  {entry.sessionNumber !== null && <span> · Session {entry.sessionNumber}</span>}
                  <span className="ml-2 normal-case tracking-normal text-muted">
                    by <span className="text-base-content">{entry.authorDisplayName}</span>
                  </span>
                </span>
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                  {entry.visibility === 'private' && (
                    <span className="chip max-w-full whitespace-normal text-[10px] [overflow-wrap:anywhere]">
                      private
                      {entry.characterId
                        ? ` · ${ownedCharacters.find((character) => character.id === entry.characterId)?.name ?? 'Character unavailable'}`
                        : ''}
                    </span>
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
                        onClick={() => setEntryToDelete(entry)}
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
              {(entry.pointsGained != null || entry.xpAwards.length > 0) && (
                <p className="mt-2 text-sm text-secondary">
                  {entry.pointsGained != null
                    ? `${entry.pointsGained} points gained · `
                    : 'Point awards · '}
                  {entry.xpAwards.length} character{entry.xpAwards.length === 1 ? '' : 's'}
                </p>
              )}
              {entry.location && <p className="mt-1 text-sm text-muted">{entry.location}</p>}
              <div className="log-entry-body mt-3">
                <Markdown source={entry.body} className="text-sm leading-relaxed" />
              </div>
            </article>
          );
        })}
      </div>
      <ConfirmDialog
        open={recipientDialog}
        title="Apply points to characters"
        confirmLabel="Use selected characters"
        onCancel={() => setRecipientDialog(false)}
        onConfirm={() => {
          setDraft({ ...draft, awardCharacterIds: recipientSelection });
          setRecipientDialog(false);
        }}
      >
        <p className="mb-3 text-muted">
          Leave out characters whose players missed the session or did not earn points.
        </p>
        <div className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {(roster ?? []).map((character) => (
            <label
              key={character.id}
              className="flex items-center gap-3 rounded-field bg-base-200 p-3"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={recipientSelection.includes(character.id)}
                disabled={
                  campaignQuery.data?.ownerId !== me.data?.id && character.ownerId !== me.data?.id
                }
                onChange={(event) =>
                  setRecipientSelection((selected) =>
                    event.target.checked
                      ? [...selected, character.id]
                      : selected.filter((id) => id !== character.id),
                  )
                }
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{character.name}</span>
            </label>
          ))}
          {(roster ?? []).length === 0 && <p>No campaign characters yet.</p>}
        </div>
        {campaignQuery.data?.ownerId === me.data?.id && (
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-3"
            onClick={() => setRecipientSelection((roster ?? []).map((character) => character.id))}
          >
            Select all characters
          </button>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={entryToDelete !== null}
        title={`Delete ${entryToDelete?.title ?? 'entry'}?`}
        confirmLabel="Delete entry"
        tone="error"
        pending={remove.isPending}
        pendingLabel="Deleting…"
        onCancel={() => setEntryToDelete(null)}
        onConfirm={() => {
          if (entryToDelete && !remove.isPending) remove.mutate(entryToDelete.id);
        }}
      >
        This adventure log entry cannot be restored. Any points it awarded will be removed from the
        recipients’ point caps.
        {remove.isError && (
          <p className="alert alert-error mt-2">
            {remove.error instanceof Error ? remove.error.message : 'Delete failed'}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
