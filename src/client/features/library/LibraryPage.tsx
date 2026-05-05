/**
 * Campaign library viewer + YAML import/export.  GMs (campaign owners)
 * can replace or merge a library from a YAML file; members can browse
 * and download the current library.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import type {
  ImportResult,
  LibraryItemOut,
  LibrarySkillOut,
  LibraryTraitOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { ApiError, api, apiFetch } from '../../lib/api.ts';

interface LibraryPayload {
  traits: LibraryTraitOut[];
  skills: LibrarySkillOut[];
  items: LibraryItemOut[];
}

type SectionKey = 'traits' | 'skills' | 'items';

export function LibraryPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<CampaignOut[]>('/campaigns'),
  });

  const urlCampaign = params.get('campaign');
  const campaignId = useMemo(() => {
    if (urlCampaign && campaigns.data?.some((c) => c.id === urlCampaign)) return urlCampaign;
    return campaigns.data?.[0]?.id ?? null;
  }, [urlCampaign, campaigns.data]);

  useEffect(() => {
    if (campaignId && urlCampaign !== campaignId) {
      const next = new URLSearchParams(params);
      next.set('campaign', campaignId);
      setParams(next, { replace: true });
    }
  }, [campaignId, urlCampaign, params, setParams]);

  const library = useQuery({
    queryKey: ['campaigns', campaignId, 'library'],
    queryFn: () => api<LibraryPayload>(`/campaigns/${campaignId}/library`),
    enabled: !!campaignId,
  });

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<{ id: string }>('/auth/me'),
  });
  const isOwner = useMemo(() => {
    if (!campaignId || !me.data) return false;
    const c = campaigns.data?.find((c) => c.id === campaignId);
    return c?.ownerId === me.data.id;
  }, [campaignId, campaigns.data, me.data]);

  const [section, setSection] = useState<SectionKey>('traits');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: (snap: { yaml: string; mode: 'merge' | 'replace' }) =>
      api<ImportResult>(`/campaigns/${campaignId}/library/import`, {
        method: 'POST',
        body: snap,
      }),
    onSuccess: (result) => {
      setImportError(null);
      setImportMessage(formatImportResult(result));
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
    onError: (err) => {
      setImportMessage(null);
      setImportError(err instanceof ApiError ? err.message : 'Import failed');
    },
  });

  const counts = useMemo(() => {
    const lib = library.data;
    return {
      traits: lib?.traits.length ?? 0,
      skills: lib?.skills.length ?? 0,
      items: lib?.items.length ?? 0,
    };
  }, [library.data]);

  const currentCampaign = useMemo(
    () => campaigns.data?.find((c) => c.id === campaignId) ?? null,
    [campaigns.data, campaignId],
  );

  async function onFileSelected(file: File) {
    if (file.size > 20 * 1024 * 1024) {
      setImportError('YAML payload is larger than 20 MB');
      return;
    }
    const text = await file.text();
    importMutation.mutate({ yaml: text, mode: importMode });
  }

  function downloadExport() {
    if (!campaignId) return;
    // Route through `apiFetch` so the export inherits the shared
    // refresh-on-401 retry; a raw `fetch` would 401 the first time
    // after the 15-minute access-token TTL expires.  An anchor-click
    // download would also drop the Authorization header, so we still
    // need to pull the bytes via fetch and synthesize a blob URL.
    void (async () => {
      try {
        const res = await apiFetch(`/campaigns/${campaignId}/library/export`);
        if (!res.ok) {
          setImportError(`Export failed: HTTP ${res.status}`);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slugify(currentCampaign?.name ?? 'library')}-library.yaml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Export failed');
      }
    })();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="label-eyebrow">
            Campaign · {currentCampaign?.name ?? 'No campaign selected'}
          </p>
          <h1 className="font-display text-4xl font-semibold leading-none">Library</h1>
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
            className="btn btn-ghost btn-sm"
            disabled={!campaignId}
            onClick={downloadExport}
          >
            Export YAML
          </button>
        </div>
      </header>

      {!campaigns.isLoading && (campaigns.data?.length ?? 0) === 0 && (
        <div className="card p-card text-center text-muted">
          You don't belong to any campaigns yet.
        </div>
      )}

      {campaignId && isOwner && (
        <section className="card grid gap-3 p-card">
          <h2 className="font-display text-xl font-semibold">Import YAML</h2>
          <p className="text-sm text-muted">
            Upload a campaign-library YAML document. <strong>Merge</strong> upserts entries by
            natural key (kind+name for traits, name for skills/items) and never deletes;{' '}
            <strong>Replace</strong> performs the same upserts and then deletes any existing entry
            not present in the uploaded file.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="form-control">
              <span className="label-text">Mode</span>
              <select
                className="select select-bordered select-sm"
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
              >
                <option value="merge">Merge (additive)</option>
                <option value="replace">Replace (sync exact)</option>
              </select>
            </label>
            <label className="form-control">
              <span className="label-text">YAML file</span>
              <input
                type="file"
                className="file-input file-input-bordered file-input-sm"
                accept=".yaml,.yml,text/yaml,application/yaml,text/plain"
                disabled={importMutation.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFileSelected(file);
                  e.target.value = '';
                }}
              />
            </label>
            {importMutation.isPending && <span className="text-sm text-muted">Importing…</span>}
          </div>
          {importError && <p className="alert alert-error text-sm">{importError}</p>}
          {importMessage && <p className="alert alert-success text-sm">{importMessage}</p>}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSection('traits')}
          className={`chip ${section === 'traits' ? 'on' : ''}`}
        >
          Traits <span className="num text-dim ml-1">{counts.traits}</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('skills')}
          className={`chip ${section === 'skills' ? 'on' : ''}`}
        >
          Skills <span className="num text-dim ml-1">{counts.skills}</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('items')}
          className={`chip ${section === 'items' ? 'on' : ''}`}
        >
          Items <span className="num text-dim ml-1">{counts.items}</span>
        </button>
      </div>

      {library.isLoading && campaignId && <p className="text-muted">Loading library…</p>}

      {library.data && (
        <div className="flex flex-col gap-3">
          {section === 'traits' &&
            library.data.traits.map((t) => (
              <article key={t.id} className="card p-card">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-display text-lg font-semibold">{t.name}</span>
                  <span className="num text-xs uppercase tracking-widest text-dim">
                    {t.kind} · {t.basePoints} pt
                  </span>
                </div>
                {t.description && <p className="text-sm text-muted">{t.description}</p>}
                {t.source && <p className="text-xs text-dim">Source · {t.source}</p>}
              </article>
            ))}
          {section === 'skills' &&
            library.data.skills.map((s) => (
              <article key={s.id} className="card p-card">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-display text-lg font-semibold">{s.name}</span>
                  <span className="num text-xs uppercase tracking-widest text-dim">
                    {s.attribute}/{s.difficulty}
                    {s.techLevel != null ? ` · TL${s.techLevel}` : ''}
                  </span>
                </div>
                {s.description && <p className="text-sm text-muted">{s.description}</p>}
                {s.source && <p className="text-xs text-dim">Source · {s.source}</p>}
              </article>
            ))}
          {section === 'items' &&
            library.data.items.map((i) => (
              <article key={i.id} className="card p-card">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-display text-lg font-semibold">{i.name}</span>
                  <span className="num text-xs uppercase tracking-widest text-dim">
                    {i.category} · {i.weightLbs} lb · ${i.cost}
                  </span>
                </div>
                {i.description && <p className="text-sm text-muted">{i.description}</p>}
                {i.source && <p className="text-xs text-dim">Source · {i.source}</p>}
              </article>
            ))}
          {library.data && counts[section] === 0 && (
            <p className="text-center text-muted">No {section} in the library yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

function formatImportResult(r: ImportResult): string {
  const totals = (label: SectionKey) => {
    const s = r[label];
    return `${label}: +${s.created} · ~${s.updated} · −${s.deleted}`;
  };
  return `Imported in ${r.mode} mode — ${totals('traits')}, ${totals('skills')}, ${totals('items')}`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'library'
  );
}
