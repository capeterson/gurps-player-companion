/**
 * Campaign library viewer + YAML import/export. GMs can edit individual
 * entries; members can browse and download the current library.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveEffectDefinitionOut } from '../../../shared/schemas/activeEffects.ts';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import type {
  ImportResult,
  LibraryEnchantmentCreate,
  LibraryEnchantmentOut,
  LibraryItemCreate,
  LibraryItemOut,
  LibraryLanguageOut,
  LibrarySkillCreate,
  LibrarySkillOut,
  LibrarySpellCreate,
  LibrarySpellOut,
  LibraryStyleOut,
  LibraryTechniqueOut,
  LibraryTraitCreate,
  LibraryTraitOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { parseLibraryYaml } from '../../../shared/yaml/library.ts';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { FoldSection } from '../../components/ui/FoldSection.tsx';
import { QueryReadError } from '../../components/ui/QueryReadError.tsx';
import { useSelectedCampaignId } from '../../hooks/useSelectedCampaignId.ts';
import { ApiError, api, apiFetch } from '../../lib/api.ts';
import { ActiveEffectLibrary } from './ActiveEffectLibrary.tsx';
import { effectPreview } from './EffectsEditor.tsx';
import { EnchantmentForm } from './EnchantmentForm.tsx';
import { ItemForm } from './ItemForm.tsx';
import { SkillForm } from './SkillForm.tsx';
import { SpellForm } from './SpellForm.tsx';
import { TraitForm } from './TraitForm.tsx';
import { matchesLibrarySearch } from './librarySearch.ts';
import { useLibrarySectionCrud } from './useLibrarySectionCrud.ts';

interface LibraryPayload {
  traits: LibraryTraitOut[];
  skills: LibrarySkillOut[];
  spells: LibrarySpellOut[];
  items: LibraryItemOut[];
  enchantments: LibraryEnchantmentOut[];
  activeEffects?: ActiveEffectDefinitionOut[];
  languages?: LibraryLanguageOut[];
  techniques?: LibraryTechniqueOut[];
  styles?: LibraryStyleOut[];
}

type SectionKey = 'traits' | 'skills' | 'spells' | 'items' | 'enchantments' | 'activeEffects';

/**
 * Top-level library page.  Mirrors LogPage: when the parent route
 * passes `campaignId` (e.g. `/campaigns/:id/library`) we use that and
 * skip the URL-sync logic; otherwise pick from `?campaign=` or the
 * first campaign and mirror it back into the query string.
 */
export function LibraryPage({ campaignId: campaignIdProp }: { campaignId?: string } = {}) {
  const qc = useQueryClient();
  // Always fetch campaigns — needed for isOwner check and campaign name
  // even when the parent passes campaignId directly.
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<CampaignOut[]>('/campaigns'),
  });

  const { campaignId, params, setParams } = useSelectedCampaignId(campaignIdProp, campaigns.data);
  const currentCampaignId = useRef(campaignId);
  currentCampaignId.current = campaignId;

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
  const [search, setSearch] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [applyCampaignSettings, setApplyCampaignSettings] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    campaignId: string;
    fileName: string;
    yaml: string;
    mode: 'merge' | 'replace';
    applyCampaignSettings: boolean;
    counts: { label: string; incoming: number; removed: number | null }[];
  } | null>(null);

  useEffect(() => {
    setPendingImport((current) => (current?.campaignId === campaignId ? current : null));
  }, [campaignId]);

  const {
    addOpen: traitsAddOpen,
    setAddOpen: setTraitsAddOpen,
    editId: traitsEditId,
    setEditId: setTraitsEditId,
    deleteId: traitsDeleteId,
    setDeleteId: setTraitsDeleteId,
    create: createTrait,
    update: updateTrait,
    remove: deleteTrait,
  } = useLibrarySectionCrud<LibraryTraitCreate, LibraryTraitOut>(campaignId, 'traits');

  const {
    addOpen: skillsAddOpen,
    setAddOpen: setSkillsAddOpen,
    editId: skillsEditId,
    setEditId: setSkillsEditId,
    deleteId: skillsDeleteId,
    setDeleteId: setSkillsDeleteId,
    create: createSkill,
    update: updateSkill,
    remove: deleteSkill,
  } = useLibrarySectionCrud<LibrarySkillCreate, LibrarySkillOut>(campaignId, 'skills');

  const {
    addOpen: spellsAddOpen,
    setAddOpen: setSpellsAddOpen,
    editId: spellsEditId,
    setEditId: setSpellsEditId,
    deleteId: spellsDeleteId,
    setDeleteId: setSpellsDeleteId,
    create: createSpell,
    update: updateSpell,
    remove: deleteSpell,
  } = useLibrarySectionCrud<LibrarySpellCreate, LibrarySpellOut>(campaignId, 'spells');

  const {
    addOpen: itemsAddOpen,
    setAddOpen: setItemsAddOpen,
    editId: itemsEditId,
    setEditId: setItemsEditId,
    deleteId: itemsDeleteId,
    setDeleteId: setItemsDeleteId,
    create: createItem,
    update: updateItem,
    remove: deleteItem,
  } = useLibrarySectionCrud<LibraryItemCreate, LibraryItemOut>(campaignId, 'items');

  const {
    addOpen: enchantmentsAddOpen,
    setAddOpen: setEnchantmentsAddOpen,
    editId: enchantmentsEditId,
    setEditId: setEnchantmentsEditId,
    deleteId: enchantmentsDeleteId,
    setDeleteId: setEnchantmentsDeleteId,
    create: createEnchantment,
    update: updateEnchantment,
    remove: deleteEnchantment,
  } = useLibrarySectionCrud<LibraryEnchantmentCreate, LibraryEnchantmentOut>(
    campaignId,
    'enchantments',
  );

  const importMutation = useMutation({
    mutationFn: (snap: {
      campaignId: string;
      yaml: string;
      mode: 'merge' | 'replace';
      applyCampaignSettings: boolean;
    }) =>
      api<ImportResult>(`/campaigns/${snap.campaignId}/library/import`, {
        method: 'POST',
        body: {
          yaml: snap.yaml,
          mode: snap.mode,
          applyCampaignSettings: snap.applyCampaignSettings,
        },
      }),
    onSuccess: (result, variables) => {
      setPendingImport(null);
      setImportError(null);
      setImportMessage(formatImportResult(result));
      qc.invalidateQueries({ queryKey: ['campaigns', variables.campaignId, 'library'] });
      // Campaign settings live in the top-level campaigns list query, not
      // the library query — refresh it too so a manaLevel/pointTarget
      // change from an applied import shows up without a manual reload.
      if (result.campaignSettingsApplied) {
        qc.invalidateQueries({ queryKey: ['campaigns'] });
      }
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
      enchantments: lib?.enchantments.length ?? 0,
      activeEffects: lib?.activeEffects?.length ?? 0,
    };
  }, [library.data]);

  const currentCampaign = useMemo(
    () => campaigns.data?.find((c) => c.id === campaignId) ?? null,
    [campaigns.data, campaignId],
  );

  async function onFileSelected(file: File) {
    const selectedCampaignId = campaignId;
    if (!selectedCampaignId) return;
    if (file.size > 20 * 1024 * 1024) {
      setImportError('YAML payload is larger than 20 MB');
      return;
    }
    try {
      const yaml = await file.text();
      if (selectedCampaignId !== currentCampaignId.current) return;
      const parsed = parseLibraryYaml(yaml);
      const mode = importMode;
      const applySettings = applyCampaignSettings;
      if (mode === 'replace' && (!library.data || library.isError)) {
        throw new Error('Reload the current library before replacing it');
      }
      const sections = [
        [
          'Traits',
          'traits',
          (entry: { name: string; kind: string }) => `${entry.kind}:${entry.name.toLowerCase()}`,
        ],
        ['Skills', 'skills', (entry: { name: string }) => entry.name.toLowerCase()],
        ['Spells', 'spells', (entry: { name: string }) => entry.name.toLowerCase()],
        ['Items', 'items', (entry: { name: string }) => entry.name.toLowerCase()],
        ['Enchantments', 'enchantments', (entry: { name: string }) => entry.name.toLowerCase()],
        ['Active effects', 'activeEffects', (entry: { name: string }) => entry.name.toLowerCase()],
        ['Languages', 'languages', (entry: { name: string }) => entry.name.toLowerCase()],
        ['Techniques', 'techniques', (entry: { name: string }) => entry.name.toLowerCase()],
        ['Styles', 'styles', (entry: { name: string }) => entry.name.toLowerCase()],
      ] as const;
      const preview = sections.flatMap(([label, key, naturalKey]) => {
        const incoming = parsed.library[key];
        // Omitted optional sections are intentionally untouched by Replace.
        if (!incoming) return [];
        const current = library.data?.[key];
        const incomingKeys = new Set(incoming.map((entry) => naturalKey(entry as never)));
        return [
          {
            label,
            incoming: incoming.length,
            removed:
              mode === 'replace' && current
                ? current.filter((entry) => !incomingKeys.has(naturalKey(entry as never))).length
                : null,
          },
        ];
      });
      setImportError(null);
      setImportMessage(null);
      setPendingImport({
        campaignId: selectedCampaignId,
        fileName: file.name,
        yaml,
        mode,
        applyCampaignSettings: applySettings,
        counts: preview,
      });
    } catch (error) {
      setPendingImport(null);
      setImportError(error instanceof Error ? error.message : 'Could not read YAML file');
    }
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
  const enchantmentToDelete = library.data?.enchantments.find(
    (entry) => entry.id === enchantmentsDeleteId,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
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

      {campaigns.isError && !campaignIdProp && (
        <QueryReadError
          label="campaigns"
          error={campaigns.error}
          onRetry={() => void campaigns.refetch()}
        />
      )}
      {!campaigns.isLoading &&
        !campaigns.isError &&
        !campaignIdProp &&
        (campaigns.data?.length ?? 0) === 0 && (
          <div className="card p-card text-center text-muted">
            You don&apos;t belong to any campaigns yet.
          </div>
        )}

      {campaignId && library.isError && (
        <QueryReadError
          label="library"
          error={library.error}
          onRetry={() => void library.refetch()}
        />
      )}

      {campaignId && isOwner && (
        <FoldSection
          preferenceKey={`${campaignId}:library-import`}
          title="Import YAML"
          defaultOpen={false}
        >
          <div className="space-y-3">
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
              <label className="flex items-center gap-2 self-end pb-1.5">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={applyCampaignSettings}
                  onChange={(e) => setApplyCampaignSettings(e.target.checked)}
                />
                <span className="label-text">
                  Apply campaign settings from the file (description, point target, caps, mana level
                  — never the name)
                </span>
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
          </div>
        </FoldSection>
      )}
      <ConfirmDialog
        open={pendingImport !== null}
        title={`Import ${pendingImport?.fileName ?? 'YAML'}?`}
        confirmLabel={pendingImport?.mode === 'replace' ? 'Replace library' : 'Merge library'}
        tone={pendingImport?.mode === 'replace' ? 'error' : 'primary'}
        pending={importMutation.isPending}
        pendingLabel="Importing…"
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          if (!pendingImport || pendingImport.campaignId !== campaignId || importMutation.isPending)
            return;
          importMutation.mutate({
            campaignId: pendingImport.campaignId,
            yaml: pendingImport.yaml,
            mode: pendingImport.mode,
            applyCampaignSettings: pendingImport.applyCampaignSettings,
          });
        }}
      >
        <p>
          {pendingImport?.mode === 'replace'
            ? 'Replace will remove existing entries missing from this file.'
            : 'Merge will add or update entries without deleting existing entries.'}
          {pendingImport?.applyCampaignSettings &&
            ' Campaign settings in the file will also be applied.'}
        </p>
        <ul className="mt-2 space-y-1" aria-label="Import preview">
          {pendingImport?.counts.map((section) => (
            <li key={section.label}>
              {section.label}: {section.incoming} in file
              {section.removed !== null && ` · ${section.removed} to remove`}
            </li>
          ))}
        </ul>
        {pendingImport?.mode === 'replace' &&
          pendingImport.counts.some((section) => section.removed === null) && (
            <p className="mt-2 text-warning">
              Some current section counts are unavailable. The server will report final deletion
              counts after import.
            </p>
          )}
        {importError && <p className="alert alert-error mt-2">{importError}</p>}
      </ConfirmDialog>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSection('traits')}
          className={`chip ${section === 'traits' ? 'on' : ''}`}
        >
          Traits <span className="num text-dim ml-1">{library.data ? counts.traits : '—'}</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('skills')}
          className={`chip ${section === 'skills' ? 'on' : ''}`}
        >
          Skills <span className="num text-dim ml-1">{library.data ? counts.skills : '—'}</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('spells')}
          className={`chip ${section === 'spells' ? 'on' : ''}`}
        >
          Spells <span className="num text-dim ml-1">{library.data ? counts.spells : '—'}</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('items')}
          className={`chip ${section === 'items' ? 'on' : ''}`}
        >
          Items <span className="num text-dim ml-1">{library.data ? counts.items : '—'}</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('enchantments')}
          className={`chip ${section === 'enchantments' ? 'on' : ''}`}
        >
          Enchantments{' '}
          <span className="num text-dim ml-1">{library.data ? counts.enchantments : '—'}</span>
        </button>
        <button
          type="button"
          className={`chip ${section === 'activeEffects' ? 'on' : ''}`}
          onClick={() => setSection('activeEffects')}
        >
          Active Effects <span className="num">{library.data ? counts.activeEffects : '—'}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-0">
          <span className="label-eyebrow block mb-1">Search library</span>
          <input
            type="search"
            className="input input-bordered input-sm w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, description, source, college…"
          />
        </label>
        {search && (
          <button type="button" className="btn btn-sm" onClick={() => setSearch('')}>
            Clear search
          </button>
        )}
      </div>
      {library.data && (
        <output className="text-xs text-muted">
          {
            (library.data[section] ?? []).filter((entry) => matchesLibrarySearch(entry, search))
              .length
          }{' '}
          of {counts[section]} {section}
          {search.trim() ? ' match' : ''}. {search.trim() && 'Entries being edited stay visible.'}
        </output>
      )}
      {library.data &&
        counts[section] > 0 &&
        !(library.data[section] ?? []).some((entry) => matchesLibrarySearch(entry, search)) && (
          <p className="text-sm text-muted">No matches. Try another search or category.</p>
        )}

      {library.isLoading && campaignId && <p className="text-muted">Loading library…</p>}

      {library.data && (
        <div className="flex flex-col gap-3">
          {/* ── Traits ── */}
          <div hidden={section !== 'traits'} className="space-y-3">
            {(library.data.traits ?? [])
              .filter(
                (entry) =>
                  entry.id === traitsEditId ||
                  (section === 'traits' && matchesLibrarySearch(entry, search)),
              )
              .map((t) =>
                traitsEditId === t.id ? (
                  <TraitForm
                    key={t.id}
                    campaignId={campaignId}
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
                    libraryItems={library.data.items}
                  />
                ) : (
                  <article key={t.id} className="card p-card">
                    <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <span className="min-w-0 break-words font-display text-lg font-semibold">
                        {t.name}
                      </span>
                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
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
                    {t.description && (
                      <Markdown source={t.description} className="text-sm text-muted" />
                    )}
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
                    {t.effects.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-base-content/70">
                        {t.effects.map((effect, index) => (
                          <li key={`${effect.target}-${index}`}>• {effectPreview(effect)}</li>
                        ))}
                      </ul>
                    )}
                  </article>
                ),
              )}
            {isOwner && traitsAddOpen && (
              <TraitForm
                campaignId={campaignId}
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
                libraryItems={library.data.items}
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
          </div>

          {/* ── Skills ── */}
          <div hidden={section !== 'skills'} className="space-y-3">
            {(library.data.skills ?? [])
              .filter(
                (entry) =>
                  entry.id === skillsEditId ||
                  (section === 'skills' && matchesLibrarySearch(entry, search)),
              )
              .map((s) =>
                skillsEditId === s.id ? (
                  <SkillForm
                    key={s.id}
                    campaignId={campaignId}
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
                    libraryItems={library.data.items}
                  />
                ) : (
                  <article key={s.id} className="card p-card">
                    <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <span className="font-display text-lg font-semibold">{s.name}</span>
                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                        <span className="num text-xs uppercase tracking-widest text-dim">
                          {s.attribute}/{s.difficulty}
                          {s.techLevelPolicy?.kind === 'required'
                            ? ' · /TL'
                            : s.techLevel != null
                              ? ` · TL${s.techLevel}`
                              : ''}
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
                    {s.description && (
                      <Markdown source={s.description} className="text-sm text-muted" />
                    )}
                    {s.specializationPolicy.kind !== 'none' && (
                      <p className="text-xs text-dim">
                        Specialization ·{' '}
                        {s.specializationPolicy.kind.startsWith('required')
                          ? 'required'
                          : 'optional'}
                        {(s.specializationPolicy.kind === 'required_catalog' ||
                          s.specializationPolicy.kind === 'optional_catalog') &&
                          ` · ${s.specializationPolicy.options.map((option) => option.name).join(', ')}`}
                      </p>
                    )}
                    {s.source && <p className="text-xs text-dim">Source · {s.source}</p>}
                    {s.prerequisites && (
                      <p className="text-xs text-dim">Prerequisites · {s.prerequisites}</p>
                    )}
                    {s.prerequisiteRules && (
                      <p className="text-xs text-warning">Structured prerequisite rules active</p>
                    )}
                    {s.defaults?.some((rule) => (rule.conditions?.length ?? 0) > 0) && (
                      <p className="text-xs text-info">Includes conditional default candidates</p>
                    )}
                    {s.effects.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-base-content/70">
                        {s.effects.map((effect, index) => (
                          <li key={`${effect.target}-${index}`}>• {effectPreview(effect)}</li>
                        ))}
                      </ul>
                    )}
                  </article>
                ),
              )}
            {isOwner && skillsAddOpen && (
              <SkillForm
                campaignId={campaignId}
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
                libraryItems={library.data.items}
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
          </div>

          {/* ── Spells ── */}
          <div hidden={section !== 'spells'} className="space-y-3">
            {(library.data.spells ?? [])
              .filter(
                (entry) =>
                  entry.id === spellsEditId ||
                  (section === 'spells' && matchesLibrarySearch(entry, search)),
              )
              .map((s) =>
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
                    <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <span className="font-display text-lg font-semibold">{s.name}</span>
                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
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
                    {s.description && (
                      <Markdown source={s.description} className="text-sm text-muted" />
                    )}
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
          </div>

          {/* ── Items ── */}
          <div hidden={section !== 'items'} className="space-y-3">
            {(library.data.items ?? [])
              .filter(
                (entry) =>
                  entry.id === itemsEditId ||
                  (section === 'items' && matchesLibrarySearch(entry, search)),
              )
              .map((i) =>
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
                    definitions={library.data.enchantments}
                  />
                ) : (
                  <article key={i.id} className="card p-card">
                    <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <span className="font-display text-lg font-semibold">{i.name}</span>
                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
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
                definitions={library.data.enchantments}
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
          </div>

          {/* ── Enchantments ── */}
          <div hidden={section !== 'activeEffects'}>
            <ActiveEffectLibrary
              campaignId={campaignId ?? ''}
              entries={library.data.activeEffects ?? []}
              isOwner={isOwner}
              search={search}
            />
          </div>
          <div hidden={section !== 'enchantments'} className="space-y-3">
            {(library.data.enchantments ?? [])
              .filter(
                (entry) =>
                  entry.id === enchantmentsEditId ||
                  (section === 'enchantments' && matchesLibrarySearch(entry, search)),
              )
              .map((entry) =>
                enchantmentsEditId === entry.id ? (
                  <EnchantmentForm
                    campaignId={campaignId}
                    key={entry.id}
                    initial={entry}
                    isPending={updateEnchantment.isPending}
                    error={
                      updateEnchantment.error instanceof ApiError
                        ? updateEnchantment.error.message
                        : updateEnchantment.error
                          ? 'Save failed'
                          : null
                    }
                    onSubmit={(body) => updateEnchantment.mutate({ id: entry.id, body })}
                    onCancel={() => setEnchantmentsEditId(null)}
                  />
                ) : (
                  <article key={entry.id} className="card p-card">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <div>
                        <span className="font-display text-lg font-semibold">{entry.name}</span>
                        <p className="text-xs text-dim">
                          {entry.applicability} · {entry.stackingPolicy.kind}
                          {entry.stackingPolicy.kind === 'highest'
                            ? ` (${entry.stackingPolicy.key})`
                            : ''}
                        </p>
                      </div>
                      {isOwner && (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => {
                              setEnchantmentsEditId(entry.id);
                              setEnchantmentsAddOpen(false);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-error"
                            onClick={() => setEnchantmentsDeleteId(entry.id)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    {entry.description && <p className="text-sm text-muted">{entry.description}</p>}
                    {entry.effects.length > 0 && (
                      <p className="text-xs text-base-content/70">
                        {entry.effects
                          .map(
                            (effect) =>
                              `${effect.target} ${effect.value >= 0 ? '+' : ''}${effect.value}`,
                          )
                          .join(' · ')}
                      </p>
                    )}
                    {entry.source && <p className="text-xs text-dim">Source · {entry.source}</p>}
                  </article>
                ),
              )}
            {isOwner && enchantmentsAddOpen && (
              <EnchantmentForm
                campaignId={campaignId}
                isPending={createEnchantment.isPending}
                error={
                  createEnchantment.error instanceof ApiError
                    ? createEnchantment.error.message
                    : createEnchantment.error
                      ? 'Save failed'
                      : null
                }
                onSubmit={(body) => createEnchantment.mutate(body)}
                onCancel={() => setEnchantmentsAddOpen(false)}
              />
            )}
            {counts.enchantments === 0 && !enchantmentsAddOpen && (
              <p className="text-center text-muted">No enchantment definitions yet.</p>
            )}
            {isOwner && !enchantmentsAddOpen && (
              <button
                type="button"
                className="btn btn-ghost btn-sm self-start"
                onClick={() => {
                  setEnchantmentsAddOpen(true);
                  setEnchantmentsEditId(null);
                }}
              >
                + Add enchantment
              </button>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmations */}
      <ConfirmDialog
        open={!!traitsDeleteId}
        title="Delete library trait"
        confirmLabel="Delete"
        tone="error"
        pending={deleteTrait.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => {
          if (traitsDeleteId && !deleteTrait.isPending) deleteTrait.mutate(traitsDeleteId);
        }}
        onCancel={() => setTraitsDeleteId(null)}
      >
        Delete <strong>{traitToDelete?.name}</strong> from the library? Existing characters that use
        this trait are not affected.
        {deleteTrait.isError && (
          <p role="alert" className="text-error">
            {deleteTrait.error instanceof Error ? deleteTrait.error.message : 'Delete failed'}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!skillsDeleteId}
        title="Delete library skill"
        confirmLabel="Delete"
        tone="error"
        pending={deleteSkill.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => {
          if (skillsDeleteId && !deleteSkill.isPending) deleteSkill.mutate(skillsDeleteId);
        }}
        onCancel={() => setSkillsDeleteId(null)}
      >
        Delete <strong>{skillToDelete?.name}</strong> from the library? Existing characters that use
        this skill are not affected.
        {deleteSkill.isError && (
          <p role="alert" className="text-error">
            {deleteSkill.error instanceof Error ? deleteSkill.error.message : 'Delete failed'}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!spellsDeleteId}
        title="Delete library spell"
        confirmLabel="Delete"
        tone="error"
        pending={deleteSpell.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => {
          if (spellsDeleteId && !deleteSpell.isPending) deleteSpell.mutate(spellsDeleteId);
        }}
        onCancel={() => setSpellsDeleteId(null)}
      >
        Delete <strong>{spellToDelete?.name}</strong> from the library? Existing characters that
        know this spell are not affected.
        {deleteSpell.isError && (
          <p role="alert" className="text-error">
            {deleteSpell.error instanceof Error ? deleteSpell.error.message : 'Delete failed'}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!itemsDeleteId}
        title="Delete library item"
        confirmLabel="Delete"
        tone="error"
        pending={deleteItem.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => {
          if (itemsDeleteId && !deleteItem.isPending) deleteItem.mutate(itemsDeleteId);
        }}
        onCancel={() => setItemsDeleteId(null)}
      >
        Delete <strong>{itemToDelete?.name}</strong> from the library? Existing characters that have
        this item are not affected.
        {deleteItem.isError && (
          <p role="alert" className="text-error">
            {deleteItem.error instanceof Error ? deleteItem.error.message : 'Delete failed'}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!enchantmentsDeleteId}
        title="Delete enchantment definition"
        confirmLabel="Delete"
        tone="error"
        pending={deleteEnchantment.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => {
          if (enchantmentsDeleteId && !deleteEnchantment.isPending)
            deleteEnchantment.mutate(enchantmentsDeleteId);
        }}
        onCancel={() => setEnchantmentsDeleteId(null)}
      >
        Delete <strong>{enchantmentToDelete?.name}</strong>? Existing item snapshots keep their
        mechanics and become detached.
        {deleteEnchantment.isError && (
          <p role="alert" className="text-error">
            {deleteEnchantment.error instanceof Error
              ? deleteEnchantment.error.message
              : 'Delete failed'}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

function formatImportResult(r: ImportResult): string {
  const totals = (label: SectionKey) => {
    const s = r[label];
    return `${label}: +${s.created} · ~${s.updated} · −${s.deleted}`;
  };
  const settingsNote = r.campaignSettingsApplied ? '; campaign settings applied' : '';
  return `Imported in ${r.mode} mode — ${totals('traits')}, ${totals('skills')}, ${totals('spells')}, ${totals('items')}, ${totals('enchantments')}${settingsNote}`;
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
