import type { ActiveEffectDefinitionOut } from '../../../shared/schemas/activeEffects.ts';
import { skillProcedures } from '../../../shared/schemas/skillProcedures.ts';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { RichTextEditor } from '../../components/markdown/RichTextEditor.tsx';
import { FoldSection } from '../../components/ui/FoldSection.tsx';
import { QueryReadError } from '../../components/ui/QueryReadError.tsx';
import { ActiveEffectLibrary } from './ActiveEffectLibrary.tsx';
import { matchesLibrarySearch } from './librarySearch.ts';
/**
 * Campaign library viewer + YAML import/export.  GMs (campaign owners)
 * can add/edit/delete individual entries and replace or merge a library
 * from a YAML file; members can browse and download the current library.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  LibraryEnchantmentCreate,
  LibraryEnchantmentOut,
  LibraryItemCreate,
  LibraryItemOut,
  LibraryLanguageOut,
  LibrarySkillCreate,
  LibrarySkillOut,
  LibrarySkillSpecializationPolicy,
  LibrarySpellCreate,
  LibrarySpellOut,
  LibraryStyleOut,
  LibraryTechniqueOut,
  LibraryTraitCreate,
  LibraryTraitOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import type { EnchantmentEffectTarget } from '../../../shared/schemas/inventory.ts';
import type { TraitModifier } from '../../../shared/schemas/trait.ts';
import { parseLibraryYaml } from '../../../shared/yaml/library.ts';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { SkillReferenceCombobox } from '../../components/ui/SkillReferenceCombobox.tsx';
import { useSelectedCampaignId } from '../../hooks/useSelectedCampaignId.ts';
import { ApiError, api, apiFetch } from '../../lib/api.ts';
import { EffectsEditor, effectPreview } from './EffectsEditor.tsx';

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
  const [enchantmentsAddOpen, setEnchantmentsAddOpen] = useState(false);
  const [enchantmentsEditId, setEnchantmentsEditId] = useState<string | null>(null);
  const [enchantmentsDeleteId, setEnchantmentsDeleteId] = useState<string | null>(null);

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

  const createEnchantment = useMutation({
    mutationFn: (body: LibraryEnchantmentCreate) =>
      api<LibraryEnchantmentOut>(`/campaigns/${campaignId}/library/enchantments`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      setEnchantmentsAddOpen(false);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });
  const updateEnchantment = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LibraryEnchantmentCreate }) =>
      api<LibraryEnchantmentOut>(`/campaigns/${campaignId}/library/enchantments/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      setEnchantmentsEditId(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });
  const deleteEnchantment = useMutation({
    mutationFn: (id: string) =>
      api(`/campaigns/${campaignId}/library/enchantments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setEnchantmentsDeleteId(null);
      qc.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    },
  });

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

// ── Trait form ──────────────────────────────────────────────────────────────

interface TraitFormProps {
  campaignId: string | null;
  initial?: LibraryTraitOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryTraitCreate) => void;
  onCancel: () => void;
  libraryItems: readonly LibraryItemOut[];
}

function TraitForm({
  campaignId,
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
  libraryItems,
}: TraitFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<(typeof TRAIT_KINDS)[number]>(initial?.kind ?? 'advantage');
  // Keep as a string draft so typing a leading '-' isn't immediately clobbered.
  const [basePointsDraft, setBasePointsDraft] = useState(String(initial?.basePoints ?? 0));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [modifiers, setModifiers] = useState<TraitModifier[]>(initial?.availableModifiers ?? []);
  const [effects, setEffects] = useState(initial?.effects ?? []);
  const [effectsValid, setEffectsValid] = useState(true);

  function handleSubmit() {
    if (!name.trim()) return;
    const basePoints = Number.parseInt(basePointsDraft, 10);
    onSubmit({
      name: name.trim(),
      kind,
      basePoints: Number.isNaN(basePoints) ? 0 : basePoints,
      pointsPerLevel: initial?.pointsPerLevel ?? null,
      maxLevel: initial?.maxLevel ?? null,
      description: description.trim() || null,
      source: source.trim() || null,
      availableModifiers: modifiers,
      variants: initial?.variants ?? [],
      effects,
      tags: initial?.tags ?? [],
    });
  }

  return (
    <fieldset disabled={isPending} className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control w-full sm:min-w-[12rem] sm:flex-1">
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
      <div className="form-control" inert={isPending}>
        <span className="label-text">Description</span>
        <RichTextEditor
          aria-label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Description (Markdown supported)…"
        />
      </div>
      <ModifierSubEditor modifiers={modifiers} onChange={setModifiers} />
      <EffectsEditor
        campaignId={campaignId}
        effects={effects}
        libraryItems={libraryItems}
        onChange={setEffects}
        onValidityChange={setEffectsValid}
      />
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
          disabled={isPending || !name.trim() || !effectsValid}
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add trait'}
        </button>
      </div>
      {error && <p className="alert alert-error text-sm">{error}</p>}
    </fieldset>
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
  campaignId: string | null;
  initial?: LibrarySkillOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibrarySkillCreate) => void;
  onCancel: () => void;
  libraryItems: readonly LibraryItemOut[];
}

function SkillForm({
  campaignId,
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
  libraryItems,
}: SkillFormProps) {
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
  const [techLevelKind, setTechLevelKind] = useState(
    initial?.techLevelPolicy?.kind ?? (initial?.techLevel != null ? 'fixed' : 'not_applicable'),
  );
  const [prerequisites, setPrerequisites] = useState(initial?.prerequisites ?? '');
  const [prerequisiteRules, setPrerequisiteRules] = useState(
    initial?.prerequisiteRules ? JSON.stringify(initial.prerequisiteRules, null, 2) : '',
  );
  const [defaults, setDefaults] = useState(
    initial?.defaults != null ? JSON.stringify(initial.defaults, null, 2) : '',
  );
  const [groups, setGroups] = useState((initial?.groups ?? []).join(', '));
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [procedures, setProcedures] = useState(
    JSON.stringify(initial?.procedures ?? { modifiers: [], actions: [], benefits: [] }, null, 2),
  );
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [defaultSpecialization, setDefaultSpecialization] = useState(
    initial?.defaultSpecialization ?? '',
  );
  const [specializationKind, setSpecializationKind] = useState<
    LibrarySkillSpecializationPolicy['kind']
  >(initial?.specializationPolicy.kind ?? 'none');
  const [specializations, setSpecializations] = useState(
    initial?.specializationPolicy.kind === 'required_catalog' ||
      initial?.specializationPolicy.kind === 'optional_catalog'
      ? initial.specializationPolicy.options.map((option) => ({
          ...option,
          editorKey: crypto.randomUUID(),
        }))
      : [],
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [effects, setEffects] = useState(initial?.effects ?? []);
  const [effectsValid, setEffectsValid] = useState(true);

  function handleSubmit() {
    if (!name.trim()) return;
    setRulesError(null);
    const tl = techLevel.trim() !== '' ? Number.parseInt(techLevel, 10) : null;
    let structuredPrerequisites: LibrarySkillCreate['prerequisiteRules'];
    let structuredDefaults: LibrarySkillCreate['defaults'];
    let parsedProcedures: LibrarySkillCreate['procedures'];
    try {
      parsedProcedures = skillProcedures.parse(JSON.parse(procedures));
      structuredPrerequisites = prerequisiteRules.trim() ? JSON.parse(prerequisiteRules) : null;
      structuredDefaults = defaults.trim() ? JSON.parse(defaults) : null;
    } catch (error) {
      setRulesError(`Invalid skill rules: ${(error as Error).message}`);
      return;
    }
    const specializationPolicy: LibrarySkillSpecializationPolicy =
      specializationKind === 'required_catalog' || specializationKind === 'optional_catalog'
        ? {
            kind: specializationKind,
            options: specializations.map(({ editorKey: _editorKey, ...option }) => option),
          }
        : { kind: specializationKind };
    const selectedDefault = defaultSpecialization.trim();
    const validDefault =
      specializationKind === 'none'
        ? null
        : specializationKind === 'required_catalog' || specializationKind === 'optional_catalog'
          ? (specializations.find(
              (option) => option.name.trim().toLowerCase() === selectedDefault.toLowerCase(),
            )?.name ?? null)
          : selectedDefault || null;
    onSubmit({
      name: name.trim(),
      attribute,
      difficulty,
      techLevel: tl,
      techLevelPolicy:
        techLevelKind === 'fixed'
          ? { kind: 'fixed', techLevel: tl ?? 0 }
          : techLevelKind === 'required'
            ? { kind: 'required', suggestedFrom: 'campaign' }
            : { kind: 'not_applicable' },
      defaultSpecialization: validDefault,
      specializationPolicy,
      description: description.trim() || null,
      source: source.trim() || null,
      prerequisites: prerequisites.trim() || null,
      prerequisiteRules: structuredPrerequisites,
      defaults: structuredDefaults,
      groups: groups
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      tags: tags
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      procedures: parsedProcedures,
      situationalModifiers: initial?.situationalModifiers ?? [],
      effects,
    });
  }

  return (
    <fieldset disabled={isPending} className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control w-full sm:min-w-[12rem] sm:flex-1">
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
        <label className="form-control w-32">
          <span className="label-text">TL policy</span>
          <select
            className="select select-bordered select-sm"
            value={techLevelKind}
            onChange={(event) =>
              setTechLevelKind(event.target.value as 'not_applicable' | 'required' | 'fixed')
            }
          >
            <option value="not_applicable">N/A</option>
            <option value="required">Required /TL</option>
            <option value="fixed">Fixed</option>
          </select>
        </label>
        <label className="form-control w-16">
          <span className="label-text">TL value</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={techLevel}
            onChange={(e) => setTechLevel(e.target.value)}
            min={0}
            max={12}
            placeholder="—"
            disabled={techLevelKind !== 'fixed'}
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
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text">Specializations</span>
          <select
            className="select select-bordered select-sm"
            value={specializationKind}
            onChange={(event) =>
              setSpecializationKind(event.target.value as LibrarySkillSpecializationPolicy['kind'])
            }
          >
            <option value="none">Not allowed</option>
            <option value="required_freeform">Required, free-form</option>
            <option value="optional_freeform">Optional, free-form</option>
            <option value="required_catalog">Required, from catalog</option>
            <option value="optional_catalog">Optional, from catalog</option>
          </select>
        </label>
        <div className="form-control">
          <span className="label-text">Default specialization</span>
          {specializationKind === 'required_catalog' ||
          specializationKind === 'optional_catalog' ? (
            <select
              className="select select-bordered select-sm"
              aria-label="Default specialization"
              value={defaultSpecialization}
              onChange={(event) => setDefaultSpecialization(event.target.value)}
            >
              <option value="">None</option>
              {specializations.map((option, index) => (
                <option key={`${option.name}-${index}`} value={option.name}>
                  {option.name || `Option ${index + 1}`}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              className="input input-bordered input-sm"
              aria-label="Default specialization"
              value={defaultSpecialization}
              onChange={(event) => setDefaultSpecialization(event.target.value)}
              maxLength={160}
              disabled={specializationKind === 'none'}
              placeholder="e.g. Shortsword"
            />
          )}
        </div>
      </div>
      <details className="rounded border border-base-300 p-3">
        <summary>Modifiers, actions and level benefits</summary>
        <p className="text-xs">
          Define bounded rules using modifiers, actions and benefits. Source text remains alongside
          each rule. Unknown context is always left for the player to choose.
        </p>
        <label className="block">
          Structured skill rules
          <textarea
            aria-label="Structured skill rules"
            className="textarea textarea-bordered w-full font-mono"
            rows={12}
            value={procedures}
            onChange={(e) => setProcedures(e.target.value)}
          />
        </label>
      </details>
      {(specializationKind === 'required_catalog' || specializationKind === 'optional_catalog') && (
        <div className="space-y-2 rounded border border-base-300 p-3">
          <div className="flex items-center justify-between">
            <span className="label-text">Specialization catalog</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() =>
                setSpecializations((current) => [
                  ...current,
                  { name: '', editorKey: crypto.randomUUID() },
                ])
              }
            >
              + Add option
            </button>
          </div>
          {specializations.map((option, index) => (
            <div
              key={option.editorKey}
              className="grid gap-2 rounded bg-base-200/50 p-2 sm:grid-cols-2"
            >
              <input
                aria-label={`Specialization ${index + 1} name`}
                className="input input-bordered input-sm"
                value={option.name}
                maxLength={160}
                placeholder="Name"
                onChange={(event) =>
                  setSpecializations((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="btn btn-ghost btn-xs justify-self-end text-error"
                onClick={() =>
                  setSpecializations((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              >
                Remove
              </button>
              <div inert={isPending}>
                <RichTextEditor
                  aria-label={`Specialization ${index + 1} description`}
                  value={option.description ?? ''}
                  placeholder="Description override (optional)"
                  onChange={(markdown) =>
                    setSpecializations((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, description: markdown || null } : item,
                      ),
                    )
                  }
                />
              </div>
              <textarea
                aria-label={`Specialization ${index + 1} prerequisites`}
                className="textarea textarea-bordered textarea-sm"
                value={option.prerequisites ?? ''}
                placeholder="Prerequisite override (optional)"
                onChange={(event) =>
                  setSpecializations((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, prerequisites: event.target.value || null }
                        : item,
                    ),
                  )
                }
              />
            </div>
          ))}
          {specializations.length === 0 && (
            <p className="text-xs text-error">Catalog policies require at least one option.</p>
          )}
        </div>
      )}
      <EffectsEditor
        campaignId={campaignId}
        effects={effects}
        libraryItems={libraryItems}
        onChange={setEffects}
        onValidityChange={setEffectsValid}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text">Prerequisite source text</span>
          <textarea
            className="textarea textarea-bordered textarea-sm"
            value={prerequisites}
            onChange={(event) => setPrerequisites(event.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text">Structured prerequisites (JSON)</span>
          <textarea
            className="textarea textarea-bordered textarea-sm font-mono text-xs"
            value={prerequisiteRules}
            onChange={(event) => setPrerequisiteRules(event.target.value)}
            placeholder='{"kind":"trait","name":"Magery","minimumLevel":1}'
          />
        </label>
        <label className="form-control">
          <span className="label-text">Default rules (JSON)</span>
          <textarea
            className="textarea textarea-bordered textarea-sm font-mono text-xs"
            value={defaults}
            onChange={(event) => setDefaults(event.target.value)}
            placeholder='[{"kind":"attribute","attribute":"IQ","modifier":-6}]'
          />
        </label>
        <div className="grid gap-2">
          <label className="form-control">
            <span className="label-text">Groups (comma-separated)</span>
            <input
              className="input input-bordered input-sm"
              value={groups}
              onChange={(event) => setGroups(event.target.value)}
            />
          </label>
          <label className="form-control">
            <span className="label-text">Tags (comma-separated)</span>
            <input
              className="input input-bordered input-sm"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="form-control" inert={isPending}>
        <span className="label-text">Description</span>
        <RichTextEditor
          aria-label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Description (Markdown supported)…"
        />
      </div>
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
          disabled={
            isPending ||
            !name.trim() ||
            !effectsValid ||
            ((specializationKind === 'required_catalog' ||
              specializationKind === 'optional_catalog') &&
              (specializations.length === 0 ||
                specializations.some((option) => !option.name.trim())))
          }
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add skill'}
        </button>
      </div>
      {(error || rulesError) && <p className="alert alert-error text-sm">{error || rulesError}</p>}
    </fieldset>
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
        <label className="form-control w-full sm:min-w-[12rem] sm:flex-1">
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
      <div className="form-control" inert={isPending}>
        <span className="label-text">Description</span>
        <RichTextEditor
          aria-label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Description (Markdown supported)…"
        />
      </div>
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
  definitions: readonly LibraryEnchantmentOut[];
}

function ItemForm({ initial, isPending, error, onSubmit, onCancel, definitions }: ItemFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'general');
  const [defaultQuantity, setDefaultQuantity] = useState(initial?.defaultQuantity ?? 1);
  const [weightLbs, setWeightLbs] = useState(initial?.weightLbs ?? 0);
  const [cost, setCost] = useState(initial?.cost ?? 0);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [isContainer, setIsContainer] = useState(initial?.isContainer ?? false);
  const [hideawayCapacityLbs, setHideawayCapacityLbs] = useState(initial?.hideawayCapacityLbs ?? 0);
  const [weightReductionPercent, setWeightReductionPercent] = useState(
    initial?.weightReductionPercent ?? 0,
  );
  const [enchantments, setEnchantments] = useState(initial?.enchantments ?? []);
  const [definitionId, setDefinitionId] = useState('');

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
      isContainer,
      hideawayCapacityLbs: isContainer ? hideawayCapacityLbs : 0,
      weightReductionPercent: isContainer ? weightReductionPercent : 0,
      // Full powerstone / magic-item editors stay YAML-authored for now
      // (same as armor/weapon); pass through so editing name/cost etc.
      // doesn't wipe YAML-authored data.
      powerstoneData: initial?.powerstoneData ?? null,
      magicItemData: initial?.magicItemData ?? null,
      enchantments,
    });
  }

  return (
    <div className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control w-full sm:min-w-[12rem] sm:flex-1">
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
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={isContainer}
            onChange={(e) => setIsContainer(e.target.checked)}
          />
          <span>Container</span>
        </label>
        {isContainer && (
          <>
            <label className="form-control w-32">
              <span className="label-text">Hideaway capacity (lb)</span>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={hideawayCapacityLbs}
                onChange={(e) => setHideawayCapacityLbs(Number.parseFloat(e.target.value) || 0)}
                min={0}
                step={0.1}
              />
            </label>
            <label className="form-control w-28">
              <span className="label-text">Weight reduction %</span>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={weightReductionPercent}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value, 10);
                  setWeightReductionPercent(Number.isNaN(v) ? 0 : Math.max(0, Math.min(100, v)));
                }}
                min={0}
                max={100}
              />
            </label>
          </>
        )}
      </div>
      <div className="space-y-2 rounded-field border border-base-300 p-3">
        <span className="label-text">Enchantments</span>
        {enchantments.map((entry, index) => (
          <div
            key={`${entry.spellName}-${index}`}
            className="flex items-center justify-between gap-2"
          >
            <span className="text-sm">
              {entry.spellName}
              {entry.level ? ` (level ${entry.level})` : ''}
              {!entry.mechanics ? ' · metadata only' : ''}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              onClick={() =>
                setEnchantments(enchantments.filter((_, entryIndex) => entryIndex !== index))
              }
            >
              Remove
            </button>
          </div>
        ))}
        {definitions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <select
              className="select select-bordered select-sm min-w-[12rem] flex-1"
              value={definitionId}
              onChange={(event) => setDefinitionId(event.target.value)}
              aria-label="Enchantment definition"
            >
              <option value="">Select definition…</option>
              {definitions.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!definitionId}
              onClick={() => {
                const definition = definitions.find((entry) => entry.id === definitionId);
                if (!definition) return;
                setEnchantments([
                  ...enchantments,
                  {
                    spellName: definition.name,
                    definitionId: definition.id,
                    definitionRevision: definition.revision,
                    definitionSource: definition.source,
                    mechanics: {
                      applicability: definition.applicability,
                      effects: definition.effects,
                      levels: definition.levels,
                      stackingPolicy: definition.stackingPolicy,
                    },
                  },
                ]);
                setDefinitionId('');
              }}
            >
              Attach
            </button>
          </div>
        )}
      </div>
      {(initial?.powerstoneData || initial?.magicItemData) && (
        <p className="text-xs text-dim">
          {initial?.powerstoneData && 'This item carries powerstone data. '}
          {initial?.magicItemData && 'This item carries magic-item data. '}
          Edit those fields via YAML import/export for now.
        </p>
      )}
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

const ENCHANTMENT_TARGETS: readonly EnchantmentEffectTarget[] = [
  'weapon_attack',
  'weapon_damage',
  'weapon_accuracy',
  'weapon_parry',
  'weapon_block',
  'armor_divisor',
  'dr',
  'db',
  'weight_reduction_percent',
  'skill',
];

function EnchantmentForm({
  campaignId,
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  campaignId: string | null;
  initial?: LibraryEnchantmentOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryEnchantmentCreate) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [applicability, setApplicability] = useState<LibraryEnchantmentCreate['applicability']>(
    initial?.applicability ?? 'any',
  );
  const [stackingKind, setStackingKind] = useState<'stack' | 'highest'>(
    initial?.stackingPolicy.kind ?? 'stack',
  );
  const [stackingKey, setStackingKey] = useState(
    initial?.stackingPolicy.kind === 'highest' ? initial.stackingPolicy.key : '',
  );
  const [effects, setEffects] = useState<LibraryEnchantmentCreate['effects']>(
    initial?.effects ?? [],
  );
  const [levels, setLevels] = useState<LibraryEnchantmentCreate['levels']>(initial?.levels ?? []);
  const valid =
    name.trim() &&
    (stackingKind === 'stack' || stackingKey.trim()) &&
    effects.every((effect) => effect.target !== 'skill' || effect.skillName?.trim()) &&
    new Set(levels.map((entry) => entry.level)).size === levels.length &&
    levels.every((entry) =>
      entry.effects.every((effect) => effect.target !== 'skill' || effect.skillName?.trim()),
    );
  return (
    <div className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control min-w-[12rem] flex-1">
          <span className="label-text">Name *</span>
          <input
            className="input input-bordered input-sm"
            value={name}
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="form-control w-32">
          <span className="label-text">Applies to</span>
          <select
            className="select select-bordered select-sm"
            value={applicability}
            onChange={(event) =>
              setApplicability(event.target.value as LibraryEnchantmentCreate['applicability'])
            }
          >
            {['any', 'weapon', 'armor', 'shield'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control w-28">
          <span className="label-text">Source</span>
          <input
            className="input input-bordered input-sm"
            value={source}
            maxLength={40}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
      </div>
      <label className="form-control">
        <span className="label-text">Description</span>
        <textarea
          className="textarea textarea-bordered textarea-sm"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="form-control">
        <span className="label-text">Tags (comma separated)</span>
        <input
          className="input input-bordered input-sm"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="form-control w-36">
          <span className="label-text">Stacking</span>
          <select
            className="select select-bordered select-sm"
            value={stackingKind}
            onChange={(event) => setStackingKind(event.target.value as 'stack' | 'highest')}
          >
            <option value="stack">Stack all</option>
            <option value="highest">Highest by key</option>
          </select>
        </label>
        {stackingKind === 'highest' && (
          <label className="form-control min-w-[12rem] flex-1">
            <span className="label-text">Combination key *</span>
            <input
              className="input input-bordered input-sm"
              value={stackingKey}
              maxLength={80}
              onChange={(event) => setStackingKey(event.target.value)}
              placeholder="fortify"
            />
          </label>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="label-text">Typed mechanics</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setEffects([...effects, { target: 'weapon_attack', value: 1 }])}
          >
            + Add effect
          </button>
        </div>
        {effects.map((effect, index) => (
          <div key={`${index}-${effect.target}`} className="flex flex-wrap items-end gap-2">
            <label className="form-control min-w-[12rem] flex-1">
              <span className="label-text">Target</span>
              <select
                className="select select-bordered select-sm"
                value={effect.target}
                onChange={(event) => {
                  const target = event.target.value as EnchantmentEffectTarget;
                  setEffects(
                    effects.map((entry, entryIndex) =>
                      entryIndex === index
                        ? {
                            target,
                            value: entry.value,
                            ...(target === 'skill' ? { skillName: '*' } : {}),
                          }
                        : entry,
                    ),
                  );
                }}
              >
                {ENCHANTMENT_TARGETS.map((target) => (
                  <option key={target} value={target}>
                    {target}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control w-24">
              <span className="label-text">Value</span>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={effect.value}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  setEffects(
                    effects.map((entry, entryIndex) =>
                      entryIndex === index
                        ? { ...entry, value: Number.isNaN(value) ? 0 : value }
                        : entry,
                    ),
                  );
                }}
                min={-100}
                max={100}
              />
            </label>
            {effect.target === 'skill' && (
              <div className="form-control min-w-[10rem] flex-1">
                <span className="label-text">Skill</span>
                <SkillReferenceCombobox
                  aria-label="Skill"
                  value={effect.skillName ?? ''}
                  campaignId={campaignId}
                  onChange={(value) =>
                    setEffects(
                      effects.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, skillName: value } : entry,
                      ),
                    )
                  }
                />
              </div>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm text-error"
              onClick={() => setEffects(effects.filter((_, entryIndex) => entryIndex !== index))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t border-base-300/60 pt-3">
        <div className="flex items-center justify-between">
          <span className="label-text">Optional levels</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() =>
              setLevels([
                ...levels,
                {
                  level: Math.max(0, ...levels.map((entry) => entry.level)) + 1,
                  effects: [],
                },
              ])
            }
          >
            + Add level
          </button>
        </div>
        {levels.map((level, levelIndex) => (
          <fieldset
            key={`${levelIndex}-${level.level}`}
            className="rounded-lg border p-3 space-y-2"
          >
            <legend className="px-2 text-xs">Level {levelIndex + 1}</legend>
            <div className="flex flex-wrap items-end gap-2">
              <label className="form-control w-24">
                <span className="label-text">Level *</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input input-bordered input-sm"
                  value={level.level}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    setLevels(
                      levels.map((entry, index) =>
                        index === levelIndex
                          ? { ...entry, level: Number.isNaN(value) ? 1 : value }
                          : entry,
                      ),
                    );
                  }}
                />
              </label>
              <label className="form-control min-w-[10rem] flex-1">
                <span className="label-text">Label</span>
                <input
                  className="input input-bordered input-sm"
                  value={level.label ?? ''}
                  onChange={(event) =>
                    setLevels(
                      levels.map((entry, index) =>
                        index === levelIndex
                          ? { ...entry, label: event.target.value || undefined }
                          : entry,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() =>
                  setLevels(
                    levels.map((entry, index) =>
                      index === levelIndex
                        ? {
                            ...entry,
                            effects: [...entry.effects, { target: 'dr', value: 1 }],
                          }
                        : entry,
                    ),
                  )
                }
              >
                + Effect
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs text-error"
                onClick={() =>
                  setLevels(levels.filter((_, entryIndex) => entryIndex !== levelIndex))
                }
              >
                Remove level
              </button>
            </div>
            {level.effects.map((effect, effectIndex) => (
              <div
                key={`${effectIndex}-${effect.target}`}
                className="flex flex-wrap items-end gap-2 pl-3"
              >
                <label className="form-control min-w-[11rem] flex-1">
                  <span className="label-text">Target</span>
                  <select
                    className="select select-bordered select-sm"
                    value={effect.target}
                    onChange={(event) => {
                      const target = event.target.value as EnchantmentEffectTarget;
                      setLevels(
                        levels.map((entry, index) =>
                          index === levelIndex
                            ? {
                                ...entry,
                                effects: entry.effects.map((candidate, candidateIndex) =>
                                  candidateIndex === effectIndex
                                    ? {
                                        target,
                                        value: candidate.value,
                                        ...(target === 'skill' ? { skillName: '*' } : {}),
                                      }
                                    : candidate,
                                ),
                              }
                            : entry,
                        ),
                      );
                    }}
                  >
                    {ENCHANTMENT_TARGETS.map((target) => (
                      <option key={target} value={target}>
                        {target}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-control w-24">
                  <span className="label-text">Value</span>
                  <input
                    type="number"
                    min={-100}
                    max={100}
                    className="input input-bordered input-sm"
                    value={effect.value}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10);
                      setLevels(
                        levels.map((entry, index) =>
                          index === levelIndex
                            ? {
                                ...entry,
                                effects: entry.effects.map((candidate, candidateIndex) =>
                                  candidateIndex === effectIndex
                                    ? { ...candidate, value: Number.isNaN(value) ? 0 : value }
                                    : candidate,
                                ),
                              }
                            : entry,
                        ),
                      );
                    }}
                  />
                </label>
                {effect.target === 'skill' && (
                  <div className="form-control min-w-[10rem] flex-1">
                    <span className="label-text">Skill</span>
                    <SkillReferenceCombobox
                      aria-label="Skill"
                      value={effect.skillName ?? ''}
                      campaignId={campaignId}
                      onChange={(value) =>
                        setLevels(
                          levels.map((entry, index) =>
                            index === levelIndex
                              ? {
                                  ...entry,
                                  effects: entry.effects.map((candidate, candidateIndex) =>
                                    candidateIndex === effectIndex
                                      ? { ...candidate, skillName: value }
                                      : candidate,
                                  ),
                                }
                              : entry,
                          ),
                        )
                      }
                    />
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() =>
                    setLevels(
                      levels.map((entry, index) =>
                        index === levelIndex
                          ? {
                              ...entry,
                              effects: entry.effects.filter(
                                (_, candidateIndex) => candidateIndex !== effectIndex,
                              ),
                            }
                          : entry,
                      ),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={isPending || !valid}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              description: description.trim() || null,
              source: source.trim() || null,
              tags: tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
              applicability,
              effects,
              levels,
              stackingPolicy:
                stackingKind === 'highest'
                  ? { kind: 'highest', key: stackingKey.trim() }
                  : { kind: 'stack' },
            })
          }
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add enchantment'}
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
