/**
 * Campaign library viewer + YAML import/export.  GMs (campaign owners)
 * can add/edit/delete individual entries and replace or merge a library
 * from a YAML file; members can browse and download the current library.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  SKILL_ATTRIBUTES,
  SKILL_DIFFICULTIES,
  SPELL_DIFFICULTIES,
} from '../../../shared/constants/skills.ts';
import {
  MODIFIER_CATEGORIES,
  MODIFIER_COST_TYPES,
  TRAIT_KINDS,
} from '../../../shared/constants/traits.ts';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import type {
  ImportResult,
  LibraryItemCreate,
  LibraryItemOut,
  LibrarySkillCreate,
  LibrarySkillOut,
  LibrarySpellCreate,
  LibrarySpellOut,
  LibraryTraitCreate,
  LibraryTraitOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import type { TraitModifier } from '../../../shared/schemas/trait.ts';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { ApiError, api, apiFetch } from '../../lib/api.ts';

interface LibraryPayload {
  traits: LibraryTraitOut[];
  skills: LibrarySkillOut[];
  spells: LibrarySpellOut[];
  items: LibraryItemOut[];
}

type SectionKey = 'traits' | 'skills' | 'spells' | 'items';

/**
 * Top-level library page.  Mirrors LogPage: when the parent route
 * passes `campaignId` (e.g. `/campaigns/:id/library`) we use that and
 * skip the URL-sync logic; otherwise pick from `?campaign=` or the
 * first campaign and mirror it back into the query string.
 */
export function LibraryPage({ campaignId: campaignIdProp }: { campaignId?: string } = {}) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  // Always fetch campaigns — needed for isOwner check and campaign name
  // even when the parent passes campaignId directly.
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<CampaignOut[]>('/campaigns'),
  });

  const urlCampaign = params.get('campaign');
  const campaignId = useMemo(() => {
    if (campaignIdProp) return campaignIdProp;
    if (urlCampaign && campaigns.data?.some((c) => c.id === urlCampaign)) return urlCampaign;
    return campaigns.data?.[0]?.id ?? null;
  }, [campaignIdProp, urlCampaign, campaigns.data]);

  useEffect(() => {
    if (campaignIdProp) return;
    if (campaignId && urlCampaign !== campaignId) {
      const next = new URLSearchParams(params);
      next.set('campaign', campaignId);
      setParams(next, { replace: true });
    }
  }, [campaignIdProp, campaignId, urlCampaign, params, setParams]);

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

  // Per-section CRUD state
  const [traitsAddOpen, setTraitsAddOpen] = useState(false);
  const [traitsEditId, setTraitsEditId] = useState<string | null>(null);
  const [traitsDeleteId, setTraitsDeleteId] = useState<string | null>(null);
  const [skillsAddOpen, setSkillsAddOpen] = useState(false);
  const [skillsEditId, setSkillsEditId] = useState<string | null>(null);
  const [skillsDeleteId, setSkillsDeleteId] = useState<string | null>(null);
  const [spellsAddOpen, setSpellsAddOpen] = useState(false);
  const [spellsEditId, setSpellsEditId] = useState<string | null>(null);
  const [spellsDeleteId, setSpellsDeleteId] = useState<string | null>(null);
  const [itemsAddOpen, setItemsAddOpen] = useState(false);
  const [itemsEditId, setItemsEditId] = useState<string | null>(null);
  const [itemsDeleteId, setItemsDeleteId] = useState<string | null>(null);

  // Trait mutations
  const createTrait = useMutation({
    mutationFn: (body: LibraryTraitCreate) =>
      api<LibraryTraitOut>(`/campaigns/${campaignId}/library/traits`, { method: 'POST', body }),
    onSuccess: () => {
      setTraitsAddOpen(false);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });
  const updateTrait = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LibraryTraitCreate }) =>
      api<LibraryTraitOut>(`/campaigns/${campaignId}/library/traits/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      setTraitsEditId(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });
  const deleteTrait = useMutation({
    mutationFn: (id: string) =>
      api(`/campaigns/${campaignId}/library/traits/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setTraitsDeleteId(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });

  // Skill mutations
  const createSkill = useMutation({
    mutationFn: (body: LibrarySkillCreate) =>
      api<LibrarySkillOut>(`/campaigns/${campaignId}/library/skills`, { method: 'POST', body }),
    onSuccess: () => {
      setSkillsAddOpen(false);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });
  const updateSkill = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LibrarySkillCreate }) =>
      api<LibrarySkillOut>(`/campaigns/${campaignId}/library/skills/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      setSkillsEditId(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });
  const deleteSkill = useMutation({
    mutationFn: (id: string) =>
      api(`/campaigns/${campaignId}/library/skills/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSkillsDeleteId(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });

  // Spell mutations
  const createSpell = useMutation({
    mutationFn: (body: LibrarySpellCreate) =>
      api<LibrarySpellOut>(`/campaigns/${campaignId}/library/spells`, { method: 'POST', body }),
    onSuccess: () => {
      setSpellsAddOpen(false);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });
  const updateSpell = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LibrarySpellCreate }) =>
      api<LibrarySpellOut>(`/campaigns/${campaignId}/library/spells/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      setSpellsEditId(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });
  const deleteSpell = useMutation({
    mutationFn: (id: string) =>
      api(`/campaigns/${campaignId}/library/spells/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSpellsDeleteId(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });

  // Item mutations
  const createItem = useMutation({
    mutationFn: (body: LibraryItemCreate) =>
      api<LibraryItemOut>(`/campaigns/${campaignId}/library/items`, { method: 'POST', body }),
    onSuccess: () => {
      setItemsAddOpen(false);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });
  const updateItem = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LibraryItemCreate }) =>
      api<LibraryItemOut>(`/campaigns/${campaignId}/library/items/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      setItemsEditId(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });
  const deleteItem = useMutation({
    mutationFn: (id: string) =>
      api(`/campaigns/${campaignId}/library/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setItemsDeleteId(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });

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
      spells: lib?.spells?.length ?? 0,
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

  const traitToDelete = library.data?.traits.find((t) => t.id === traitsDeleteId);
  const skillToDelete = library.data?.skills.find((s) => s.id === skillsDeleteId);
  const spellToDelete = library.data?.spells?.find((s) => s.id === spellsDeleteId);
  const itemToDelete = library.data?.items.find((i) => i.id === itemsDeleteId);

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
          {/* Hide campaign switcher when the parent already scoped us to a campaign */}
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

      {!campaigns.isLoading && !campaignIdProp && (campaigns.data?.length ?? 0) === 0 && (
        <div className="card p-card text-center text-muted">
          You don&apos;t belong to any campaigns yet.
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
          onClick={() => setSection('spells')}
          className={`chip ${section === 'spells' ? 'on' : ''}`}
        >
          Spells <span className="num text-dim ml-1">{counts.spells}</span>
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
          {/* ── Traits ── */}
          {section === 'traits' && (
            <>
              {library.data.traits.map((t) =>
                traitsEditId === t.id ? (
                  <TraitForm
                    key={t.id}
                    initial={t}
                    isPending={updateTrait.isPending}
                    error={
                      updateTrait.error instanceof ApiError
                        ? updateTrait.error.message
                        : updateTrait.error
                          ? 'Save failed'
                          : null
                    }
                    onSubmit={(body) => updateTrait.mutate({ id: t.id, body })}
                    onCancel={() => setTraitsEditId(null)}
                  />
                ) : (
                  <article key={t.id} className="card p-card">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="font-display text-lg font-semibold">{t.name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="num text-xs uppercase tracking-widest text-dim">
                          {t.kind} · {t.basePoints} pt
                        </span>
                        {isOwner && (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => {
                                setTraitsEditId(t.id);
                                setTraitsAddOpen(false);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-error"
                              onClick={() => setTraitsDeleteId(t.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {t.description && <p className="text-sm text-muted">{t.description}</p>}
                    {t.source && <p className="text-xs text-dim">Source · {t.source}</p>}
                    {t.availableModifiers.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {t.availableModifiers.map((m) => (
                          <span key={`${m.name}-${m.costValue}`} className="chip text-xs">
                            {m.name}{' '}
                            {m.costType === 'percent'
                              ? `${m.costValue > 0 ? '+' : ''}${m.costValue}%`
                              : `${m.costValue > 0 ? '+' : ''}${m.costValue} pts`}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                ),
              )}
              {isOwner && traitsAddOpen && (
                <TraitForm
                  isPending={createTrait.isPending}
                  error={
                    createTrait.error instanceof ApiError
                      ? createTrait.error.message
                      : createTrait.error
                        ? 'Save failed'
                        : null
                  }
                  onSubmit={(body) => createTrait.mutate(body)}
                  onCancel={() => setTraitsAddOpen(false)}
                />
              )}
              {counts.traits === 0 && !traitsAddOpen && (
                <p className="text-center text-muted">No traits in the library yet.</p>
              )}
              {isOwner && !traitsAddOpen && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm self-start"
                  onClick={() => {
                    setTraitsAddOpen(true);
                    setTraitsEditId(null);
                  }}
                >
                  + Add trait
                </button>
              )}
            </>
          )}

          {/* ── Skills ── */}
          {section === 'skills' && (
            <>
              {library.data.skills.map((s) =>
                skillsEditId === s.id ? (
                  <SkillForm
                    key={s.id}
                    initial={s}
                    isPending={updateSkill.isPending}
                    error={
                      updateSkill.error instanceof ApiError
                        ? updateSkill.error.message
                        : updateSkill.error
                          ? 'Save failed'
                          : null
                    }
                    onSubmit={(body) => updateSkill.mutate({ id: s.id, body })}
                    onCancel={() => setSkillsEditId(null)}
                  />
                ) : (
                  <article key={s.id} className="card p-card">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="font-display text-lg font-semibold">{s.name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="num text-xs uppercase tracking-widest text-dim">
                          {s.attribute}/{s.difficulty}
                          {s.techLevel != null ? ` · TL${s.techLevel}` : ''}
                        </span>
                        {isOwner && (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => {
                                setSkillsEditId(s.id);
                                setSkillsAddOpen(false);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-error"
                              onClick={() => setSkillsDeleteId(s.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {s.description && <p className="text-sm text-muted">{s.description}</p>}
                    {s.source && <p className="text-xs text-dim">Source · {s.source}</p>}
                  </article>
                ),
              )}
              {isOwner && skillsAddOpen && (
                <SkillForm
                  isPending={createSkill.isPending}
                  error={
                    createSkill.error instanceof ApiError
                      ? createSkill.error.message
                      : createSkill.error
                        ? 'Save failed'
                        : null
                  }
                  onSubmit={(body) => createSkill.mutate(body)}
                  onCancel={() => setSkillsAddOpen(false)}
                />
              )}
              {counts.skills === 0 && !skillsAddOpen && (
                <p className="text-center text-muted">No skills in the library yet.</p>
              )}
              {isOwner && !skillsAddOpen && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm self-start"
                  onClick={() => {
                    setSkillsAddOpen(true);
                    setSkillsEditId(null);
                  }}
                >
                  + Add skill
                </button>
              )}
            </>
          )}

          {/* ── Spells ── */}
          {section === 'spells' && (
            <>
              {(library.data.spells ?? []).map((s) =>
                spellsEditId === s.id ? (
                  <SpellForm
                    key={s.id}
                    initial={s}
                    isPending={updateSpell.isPending}
                    error={
                      updateSpell.error instanceof ApiError
                        ? updateSpell.error.message
                        : updateSpell.error
                          ? 'Save failed'
                          : null
                    }
                    onSubmit={(body) => updateSpell.mutate({ id: s.id, body })}
                    onCancel={() => setSpellsEditId(null)}
                  />
                ) : (
                  <article key={s.id} className="card p-card">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="font-display text-lg font-semibold">{s.name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="num text-xs uppercase tracking-widest text-dim">
                          {s.college ? `${s.college} · ` : ''}IQ/{s.difficulty} · {s.baseEnergyCost}{' '}
                          FP
                          {s.maintenanceCost != null ? ` · upkeep ${s.maintenanceCost}` : ''}
                        </span>
                        {isOwner && (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => {
                                setSpellsEditId(s.id);
                                setSpellsAddOpen(false);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-error"
                              onClick={() => setSpellsDeleteId(s.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {(s.castingTime || s.duration) && (
                      <p className="text-xs text-dim">
                        {s.castingTime ? `Cast in ${s.castingTime}` : ''}
                        {s.castingTime && s.duration ? ' · ' : ''}
                        {s.duration ? `Lasts ${s.duration}` : ''}
                      </p>
                    )}
                    {s.prerequisites && (
                      <p className="text-xs text-dim">Prerequisites · {s.prerequisites}</p>
                    )}
                    {s.description && <p className="text-sm text-muted">{s.description}</p>}
                    {s.source && <p className="text-xs text-dim">Source · {s.source}</p>}
                  </article>
                ),
              )}
              {isOwner && spellsAddOpen && (
                <SpellForm
                  isPending={createSpell.isPending}
                  error={
                    createSpell.error instanceof ApiError
                      ? createSpell.error.message
                      : createSpell.error
                        ? 'Save failed'
                        : null
                  }
                  onSubmit={(body) => createSpell.mutate(body)}
                  onCancel={() => setSpellsAddOpen(false)}
                />
              )}
              {counts.spells === 0 && !spellsAddOpen && (
                <p className="text-center text-muted">No spells in the library yet.</p>
              )}
              {isOwner && !spellsAddOpen && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm self-start"
                  onClick={() => {
                    setSpellsAddOpen(true);
                    setSpellsEditId(null);
                  }}
                >
                  + Add spell
                </button>
              )}
            </>
          )}

          {/* ── Items ── */}
          {section === 'items' && (
            <>
              {library.data.items.map((i) =>
                itemsEditId === i.id ? (
                  <ItemForm
                    key={i.id}
                    initial={i}
                    isPending={updateItem.isPending}
                    error={
                      updateItem.error instanceof ApiError
                        ? updateItem.error.message
                        : updateItem.error
                          ? 'Save failed'
                          : null
                    }
                    onSubmit={(body) => updateItem.mutate({ id: i.id, body })}
                    onCancel={() => setItemsEditId(null)}
                  />
                ) : (
                  <article key={i.id} className="card p-card">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="font-display text-lg font-semibold">{i.name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="num text-xs uppercase tracking-widest text-dim">
                          {i.category} · {i.weightLbs} lb · ${i.cost}
                        </span>
                        {isOwner && (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => {
                                setItemsEditId(i.id);
                                setItemsAddOpen(false);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-error"
                              onClick={() => setItemsDeleteId(i.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {i.description && <p className="text-sm text-muted">{i.description}</p>}
                    {i.source && <p className="text-xs text-dim">Source · {i.source}</p>}
                  </article>
                ),
              )}
              {isOwner && itemsAddOpen && (
                <ItemForm
                  isPending={createItem.isPending}
                  error={
                    createItem.error instanceof ApiError
                      ? createItem.error.message
                      : createItem.error
                        ? 'Save failed'
                        : null
                  }
                  onSubmit={(body) => createItem.mutate(body)}
                  onCancel={() => setItemsAddOpen(false)}
                />
              )}
              {counts.items === 0 && !itemsAddOpen && (
                <p className="text-center text-muted">No items in the library yet.</p>
              )}
              {isOwner && !itemsAddOpen && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm self-start"
                  onClick={() => {
                    setItemsAddOpen(true);
                    setItemsEditId(null);
                  }}
                >
                  + Add item
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Delete confirmations */}
      <ConfirmDialog
        open={!!traitsDeleteId}
        title="Delete library trait"
        confirmLabel="Delete"
        tone="error"
        onConfirm={() => {
          if (traitsDeleteId) deleteTrait.mutate(traitsDeleteId);
        }}
        onCancel={() => setTraitsDeleteId(null)}
      >
        Delete <strong>{traitToDelete?.name}</strong> from the library? Existing characters that use
        this trait are not affected.
      </ConfirmDialog>

      <ConfirmDialog
        open={!!skillsDeleteId}
        title="Delete library skill"
        confirmLabel="Delete"
        tone="error"
        onConfirm={() => {
          if (skillsDeleteId) deleteSkill.mutate(skillsDeleteId);
        }}
        onCancel={() => setSkillsDeleteId(null)}
      >
        Delete <strong>{skillToDelete?.name}</strong> from the library? Existing characters that use
        this skill are not affected.
      </ConfirmDialog>

      <ConfirmDialog
        open={!!spellsDeleteId}
        title="Delete library spell"
        confirmLabel="Delete"
        tone="error"
        onConfirm={() => {
          if (spellsDeleteId) deleteSpell.mutate(spellsDeleteId);
        }}
        onCancel={() => setSpellsDeleteId(null)}
      >
        Delete <strong>{spellToDelete?.name}</strong> from the library? Existing characters that
        know this spell are not affected.
      </ConfirmDialog>

      <ConfirmDialog
        open={!!itemsDeleteId}
        title="Delete library item"
        confirmLabel="Delete"
        tone="error"
        onConfirm={() => {
          if (itemsDeleteId) deleteItem.mutate(itemsDeleteId);
        }}
        onCancel={() => setItemsDeleteId(null)}
      >
        Delete <strong>{itemToDelete?.name}</strong> from the library? Existing characters that have
        this item are not affected.
      </ConfirmDialog>
    </div>
  );
}

// ── Trait form ──────────────────────────────────────────────────────────────

interface TraitFormProps {
  initial?: LibraryTraitOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryTraitCreate) => void;
  onCancel: () => void;
}

function TraitForm({ initial, isPending, error, onSubmit, onCancel }: TraitFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<(typeof TRAIT_KINDS)[number]>(initial?.kind ?? 'advantage');
  // Keep as a string draft so typing a leading '-' isn't immediately clobbered.
  const [basePointsDraft, setBasePointsDraft] = useState(String(initial?.basePoints ?? 0));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [modifiers, setModifiers] = useState<TraitModifier[]>(initial?.availableModifiers ?? []);

  function handleSubmit() {
    if (!name.trim()) return;
    const basePoints = Number.parseInt(basePointsDraft, 10);
    onSubmit({
      name: name.trim(),
      kind,
      basePoints: Number.isNaN(basePoints) ? 0 : basePoints,
      description: description.trim() || null,
      source: source.trim() || null,
      availableModifiers: modifiers,
      tags: initial?.tags ?? [],
    });
  }

  return (
    <div className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control min-w-[10rem] flex-1">
          <span className="label-text">Name *</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
        </label>
        <label className="form-control">
          <span className="label-text">Kind</span>
          <select
            className="select select-bordered select-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {TRAIT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control w-24">
          <span className="label-text">Base pts</span>
          <input
            type="text"
            inputMode="numeric"
            className="input input-bordered input-sm"
            value={basePointsDraft}
            onChange={(e) => setBasePointsDraft(e.target.value)}
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">Source</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={40}
            placeholder="B102"
          />
        </label>
      </div>
      <label className="form-control">
        <span className="label-text">Description</span>
        <textarea
          className="textarea textarea-bordered textarea-sm"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <ModifierSubEditor modifiers={modifiers} onChange={setModifiers} />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={isPending || !name.trim()}
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add trait'}
        </button>
      </div>
      {error && <p className="alert alert-error text-sm">{error}</p>}
    </div>
  );
}

// ── Modifier sub-editor ─────────────────────────────────────────────────────

function ModifierSubEditor({
  modifiers,
  onChange,
}: {
  modifiers: TraitModifier[];
  onChange: (m: TraitModifier[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newMod, setNewMod] = useState<Omit<TraitModifier, 'costValue'>>({
    name: '',
    category: 'enhancement',
    costType: 'percent',
  });
  // String draft so typing a leading '-' isn't clobbered on each keystroke.
  const [costValueDraft, setCostValueDraft] = useState('0');

  function commitModifier() {
    if (!newMod.name.trim()) return;
    const costValue = Number.parseInt(costValueDraft, 10);
    onChange([
      ...modifiers,
      { ...newMod, name: newMod.name.trim(), costValue: Number.isNaN(costValue) ? 0 : costValue },
    ]);
    setNewMod({ name: '', category: 'enhancement', costType: 'percent' });
    setCostValueDraft('0');
    setAdding(false);
  }

  return (
    <div className="space-y-2">
      <span className="label-text">Modifiers</span>
      {modifiers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {modifiers.map((m, i) => (
            <span key={`${m.name}-${m.costValue}`} className="chip flex items-center gap-1 text-xs">
              {m.name}{' '}
              {m.costType === 'percent'
                ? `${m.costValue > 0 ? '+' : ''}${m.costValue}%`
                : `${m.costValue > 0 ? '+' : ''}${m.costValue} pts`}
              <button
                type="button"
                className="ml-1 text-error"
                onClick={() => onChange(modifiers.filter((_, j) => j !== i))}
                aria-label={`Remove ${m.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {adding ? (
        <div className="flex flex-wrap items-end gap-2 rounded-field border border-base-300 p-2">
          <label className="form-control min-w-[8rem] flex-1">
            <span className="label-text text-xs">Name</span>
            <input
              type="text"
              className="input input-bordered input-xs"
              value={newMod.name}
              onChange={(e) => setNewMod((m) => ({ ...m, name: e.target.value }))}
              maxLength={160}
              placeholder="Aspected"
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Category</span>
            <select
              className="select select-bordered select-xs"
              value={newMod.category}
              onChange={(e) =>
                setNewMod((m) => ({ ...m, category: e.target.value as typeof m.category }))
              }
            >
              {MODIFIER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Cost type</span>
            <select
              className="select select-bordered select-xs"
              value={newMod.costType}
              onChange={(e) =>
                setNewMod((m) => ({ ...m, costType: e.target.value as typeof m.costType }))
              }
            >
              {MODIFIER_COST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control w-20">
            <span className="label-text text-xs">Value</span>
            <input
              type="text"
              inputMode="numeric"
              className="input input-bordered input-xs"
              value={costValueDraft}
              onChange={(e) => setCostValueDraft(e.target.value)}
            />
          </label>
          <label className="form-control min-w-[8rem] flex-1">
            <span className="label-text text-xs">Description (optional)</span>
            <input
              type="text"
              className="input input-bordered input-xs"
              value={newMod.description ?? ''}
              onChange={(e) =>
                setNewMod((m) => ({ ...m, description: e.target.value || undefined }))
              }
              maxLength={2000}
            />
          </label>
          <label className="form-control w-28">
            <span className="label-text text-xs">Group (optional)</span>
            <input
              type="text"
              className="input input-bordered input-xs"
              value={newMod.group ?? ''}
              onChange={(e) => setNewMod((m) => ({ ...m, group: e.target.value || undefined }))}
              maxLength={80}
              placeholder="aspect"
            />
          </label>
          <div className="flex gap-1 self-end">
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={commitModifier}
              disabled={!newMod.name.trim()}
            >
              Add
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAdding(true)}>
          + Add modifier
        </button>
      )}
    </div>
  );
}

// ── Skill form ──────────────────────────────────────────────────────────────

interface SkillFormProps {
  initial?: LibrarySkillOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibrarySkillCreate) => void;
  onCancel: () => void;
}

function SkillForm({ initial, isPending, error, onSubmit, onCancel }: SkillFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [attribute, setAttribute] = useState<(typeof SKILL_ATTRIBUTES)[number]>(
    initial?.attribute ?? 'IQ',
  );
  const [difficulty, setDifficulty] = useState<(typeof SKILL_DIFFICULTIES)[number]>(
    initial?.difficulty ?? 'A',
  );
  const [techLevel, setTechLevel] = useState(
    initial?.techLevel != null ? String(initial.techLevel) : '',
  );
  const [defaultSpecialization, setDefaultSpecialization] = useState(
    initial?.defaultSpecialization ?? '',
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');

  function handleSubmit() {
    if (!name.trim()) return;
    const tl = techLevel.trim() !== '' ? Number.parseInt(techLevel, 10) : null;
    onSubmit({
      name: name.trim(),
      attribute,
      difficulty,
      techLevel: tl,
      defaultSpecialization: defaultSpecialization.trim() || null,
      description: description.trim() || null,
      source: source.trim() || null,
      situationalModifiers: initial?.situationalModifiers ?? [],
    });
  }

  return (
    <div className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control min-w-[10rem] flex-1">
          <span className="label-text">Name *</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
        </label>
        <label className="form-control">
          <span className="label-text">Attribute</span>
          <select
            className="select select-bordered select-sm"
            value={attribute}
            onChange={(e) => setAttribute(e.target.value as typeof attribute)}
          >
            {SKILL_ATTRIBUTES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control">
          <span className="label-text">Difficulty</span>
          <select
            className="select select-bordered select-sm"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
          >
            {SKILL_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control w-16">
          <span className="label-text">TL</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={techLevel}
            onChange={(e) => setTechLevel(e.target.value)}
            min={0}
            max={12}
            placeholder="—"
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">Source</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={40}
            placeholder="B200"
          />
        </label>
      </div>
      <label className="form-control">
        <span className="label-text">Default specialization</span>
        <input
          type="text"
          className="input input-bordered input-sm"
          value={defaultSpecialization}
          onChange={(e) => setDefaultSpecialization(e.target.value)}
          maxLength={160}
          placeholder="e.g. Shortsword"
        />
      </label>
      <label className="form-control">
        <span className="label-text">Description</span>
        <textarea
          className="textarea textarea-bordered textarea-sm"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={isPending || !name.trim()}
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add skill'}
        </button>
      </div>
      {error && <p className="alert alert-error text-sm">{error}</p>}
    </div>
  );
}

// ── Spell form ──────────────────────────────────────────────────────────────

interface SpellFormProps {
  initial?: LibrarySpellOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibrarySpellCreate) => void;
  onCancel: () => void;
}

function SpellForm({ initial, isPending, error, onSubmit, onCancel }: SpellFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [college, setCollege] = useState(initial?.college ?? '');
  const [difficulty, setDifficulty] = useState<(typeof SPELL_DIFFICULTIES)[number]>(
    initial?.difficulty ?? 'H',
  );
  const [baseEnergyCost, setBaseEnergyCost] = useState(String(initial?.baseEnergyCost ?? 1));
  const [maintenanceCost, setMaintenanceCost] = useState(
    initial?.maintenanceCost != null ? String(initial.maintenanceCost) : '',
  );
  const [castingTime, setCastingTime] = useState(initial?.castingTime ?? '');
  const [duration, setDuration] = useState(initial?.duration ?? '');
  const [prerequisites, setPrerequisites] = useState(initial?.prerequisites ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');

  function handleSubmit() {
    if (!name.trim()) return;
    const cost = Number.parseInt(baseEnergyCost, 10);
    const upkeep = maintenanceCost.trim() !== '' ? Number.parseInt(maintenanceCost, 10) : null;
    onSubmit({
      name: name.trim(),
      college: college.trim() || null,
      difficulty,
      baseEnergyCost: Number.isNaN(cost) ? 1 : cost,
      maintenanceCost: upkeep != null && Number.isNaN(upkeep) ? null : upkeep,
      castingTime: castingTime.trim() || null,
      duration: duration.trim() || null,
      prerequisites: prerequisites.trim() || null,
      description: description.trim() || null,
      source: source.trim() || null,
    });
  }

  return (
    <div className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control min-w-[10rem] flex-1">
          <span className="label-text">Name *</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">College</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={college}
            onChange={(e) => setCollege(e.target.value)}
            maxLength={80}
            placeholder="Fire"
          />
        </label>
        <label className="form-control">
          <span className="label-text">Difficulty</span>
          <select
            className="select select-bordered select-sm"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
          >
            {SPELL_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control w-20">
          <span className="label-text">Cost</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={baseEnergyCost}
            onChange={(e) => setBaseEnergyCost(e.target.value)}
            min={0}
            max={99}
          />
        </label>
        <label className="form-control w-20">
          <span className="label-text">Upkeep</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={maintenanceCost}
            onChange={(e) => setMaintenanceCost(e.target.value)}
            min={0}
            max={99}
            placeholder="—"
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">Source</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={40}
            placeholder="M-110"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="form-control w-40">
          <span className="label-text">Casting time</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={castingTime}
            onChange={(e) => setCastingTime(e.target.value)}
            maxLength={40}
            placeholder="1 second"
          />
        </label>
        <label className="form-control w-40">
          <span className="label-text">Duration</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            maxLength={40}
            placeholder="1 minute"
          />
        </label>
        <label className="form-control min-w-[12rem] flex-1">
          <span className="label-text">Prerequisites</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={prerequisites}
            onChange={(e) => setPrerequisites(e.target.value)}
            placeholder="Magery 1, Ignite Fire"
          />
        </label>
      </div>
      <label className="form-control">
        <span className="label-text">Description</span>
        <textarea
          className="textarea textarea-bordered textarea-sm"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={isPending || !name.trim()}
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add spell'}
        </button>
      </div>
      {error && <p className="alert alert-error text-sm">{error}</p>}
    </div>
  );
}

// ── Item form ───────────────────────────────────────────────────────────────

interface ItemFormProps {
  initial?: LibraryItemOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryItemCreate) => void;
  onCancel: () => void;
}

function ItemForm({ initial, isPending, error, onSubmit, onCancel }: ItemFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'general');
  const [defaultQuantity, setDefaultQuantity] = useState(initial?.defaultQuantity ?? 1);
  const [weightLbs, setWeightLbs] = useState(initial?.weightLbs ?? 0);
  const [cost, setCost] = useState(initial?.cost ?? 0);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      category: category.trim() || 'general',
      defaultQuantity,
      weightLbs,
      cost,
      description: description.trim() || null,
      source: source.trim() || null,
      isArmor: initial?.isArmor ?? false,
      armor: initial?.armor ?? null,
      weaponData: initial?.weaponData ?? null,
    });
  }

  return (
    <div className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control min-w-[10rem] flex-1">
          <span className="label-text">Name *</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">Category</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={40}
            placeholder="general"
          />
        </label>
        <label className="form-control w-20">
          <span className="label-text">Qty</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={defaultQuantity}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              setDefaultQuantity(Number.isNaN(v) ? 1 : v);
            }}
            min={0}
          />
        </label>
        <label className="form-control w-24">
          <span className="label-text">Weight (lb)</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={weightLbs}
            onChange={(e) => setWeightLbs(Number.parseFloat(e.target.value) || 0)}
            min={0}
            step={0.1}
          />
        </label>
        <label className="form-control w-24">
          <span className="label-text">Cost ($)</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={cost}
            onChange={(e) => setCost(Number.parseFloat(e.target.value) || 0)}
            min={0}
            step={0.01}
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">Source</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={40}
            placeholder="B288"
          />
        </label>
      </div>
      <label className="form-control">
        <span className="label-text">Description</span>
        <textarea
          className="textarea textarea-bordered textarea-sm"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={isPending || !name.trim()}
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add item'}
        </button>
      </div>
      {error && <p className="alert alert-error text-sm">{error}</p>}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatImportResult(r: ImportResult): string {
  const totals = (label: SectionKey) => {
    const s = r[label];
    return `${label}: +${s.created} · ~${s.updated} · −${s.deleted}`;
  };
  return `Imported in ${r.mode} mode — ${totals('traits')}, ${totals('skills')}, ${totals('spells')}, ${totals('items')}`;
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
