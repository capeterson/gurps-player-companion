/**
 * Campaign library viewer + YAML import/export. GMs can edit individual
 * entries; members can browse and download the current library.
 *
 * The library is sync-backed (AGENTS.md S0): entries are read from Dexie and
 * every edit goes through the outbox, so browsing and editing work offline.
 * Only the YAML import — a server-side bulk upsert/prune — stays an online
 * REST call, followed by a cursor pull.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ImportResult } from '../../../shared/schemas/campaignLibrary.ts';
import { parseLibraryYaml } from '../../../shared/yaml/library.ts';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { FoldSection } from '../../components/ui/FoldSection.tsx';
import { getLocalDb } from '../../db/dexie.ts';
import { useAppHeaderBottom } from '../../hooks/useAppHeaderBottom.ts';
import { useSelectedCampaignId } from '../../hooks/useSelectedCampaignId.ts';
import { ApiError, api, apiFetch } from '../../lib/api.ts';
import { readActiveUser } from '../../sync/activeUser.ts';
import { getSyncOrchestrator } from '../../sync/orchestrator.ts';
import { librarySearchWords } from './librarySearch.ts';
import { ActiveEffectsSection } from './sections/ActiveEffectsSection.tsx';
import type { LibrarySectionShellProps } from './sections/CrudLibrarySection.tsx';
import { EnchantmentsSection } from './sections/EnchantmentsSection.tsx';
import { ItemsSection } from './sections/ItemsSection.tsx';
import { SkillsSection } from './sections/SkillsSection.tsx';
import { SpellsSection } from './sections/SpellsSection.tsx';
import { TraitsSection } from './sections/TraitsSection.tsx';
import { type LocalLibrary, emptyLibrary, useLocalLibrary } from './useLocalLibrary.ts';

type SectionKey = 'traits' | 'skills' | 'spells' | 'items' | 'enchantments' | 'activeEffects';

const SECTIONS: readonly { key: SectionKey; label: string }[] = [
  { key: 'traits', label: 'Traits' },
  { key: 'skills', label: 'Skills' },
  { key: 'spells', label: 'Spells' },
  { key: 'items', label: 'Items' },
  { key: 'enchantments', label: 'Enchantments' },
  { key: 'activeEffects', label: 'Active Effects' },
];

function parseSection(value: string | null): SectionKey {
  return SECTIONS.some((section) => section.key === value) ? (value as SectionKey) : 'traits';
}

/**
 * Top-level library page.  Mirrors LogPage: when the parent route
 * passes `campaignId` (e.g. `/campaigns/:id/library`) we use that and
 * skip the URL-sync logic; otherwise pick from `?campaign=` or the
 * first campaign and mirror it back into the query string.
 *
 * `?section=`, `?q=` and `?open=` make a section, a search and an open
 * entry linkable.
 */
export function LibraryPage({ campaignId: campaignIdProp }: { campaignId?: string } = {}) {
  const qc = useQueryClient();
  // Campaign rows are synced read-only, so the switcher and the owner check
  // work offline too.
  const campaigns = useLiveQuery(() => getLocalDb().campaigns.toArray(), []);
  const sortedCampaigns = useMemo(
    () => campaigns && [...campaigns].sort((a, b) => a.name.localeCompare(b.name)),
    [campaigns],
  );
  const { campaignId, params, setParams } = useSelectedCampaignId(campaignIdProp, sortedCampaigns);
  const currentCampaignId = useRef(campaignId);
  currentCampaignId.current = campaignId;
  const currentCampaign = useMemo(
    () => campaigns?.find((c) => c.id === campaignId) ?? null,
    [campaigns, campaignId],
  );
  const isOwner =
    currentCampaign !== null &&
    (currentCampaign.viewerRole === 'owner' || currentCampaign.ownerId === readActiveUser());

  const localLibrary = useLocalLibrary(campaignId);
  const library: LocalLibrary = localLibrary ?? emptyLibrary();

  const section = parseSection(params.get('section'));
  const [search, setSearch] = useState(() => params.get('q') ?? '');
  const deferredSearch = useDeferredValue(search);
  const words = useMemo(() => librarySearchWords(deferredSearch), [deferredSearch]);
  const [expandedId, setExpandedId] = useState<string | null>(() => params.get('open'));
  const [revealId, setRevealId] = useState<string | null>(() => params.get('open'));

  const paramsRef = useRef(params);
  paramsRef.current = params;
  const updateParams = useCallback(
    (changes: Record<string, string | null>, replace: boolean) => {
      const next = new URLSearchParams(paramsRef.current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      setParams(next, { replace });
    },
    [setParams],
  );
  // Keep the search linkable without rewriting history on every keystroke.
  useEffect(() => {
    const trimmed = deferredSearch.trim();
    if ((paramsRef.current.get('q') ?? '') === trimmed) return;
    const timer = setTimeout(() => updateParams({ q: trimmed || null }, true), 300);
    return () => clearTimeout(timer);
  }, [deferredSearch, updateParams]);

  const expandedRef = useRef(expandedId);
  expandedRef.current = expandedId;
  const onToggleExpanded = useCallback(
    (id: string) => {
      const next = expandedRef.current === id ? null : id;
      setExpandedId(next);
      updateParams({ open: next }, true);
    },
    [updateParams],
  );
  const onRevealed = useCallback(() => setRevealId(null), []);

  // Sticky toolbar under the app header; rows and group headings scroll to
  // just below it.
  const headerBottom = useAppHeaderBottom();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => setToolbarHeight(toolbar.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(toolbar);
    return () => observer?.disconnect();
  }, []);
  const [jumpSlot, setJumpSlot] = useState<HTMLElement | null>(null);

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
    onSuccess: (result) => {
      setPendingImport(null);
      setImportError(null);
      setImportMessage(formatImportResult(result));
      // The import is a server-side bulk write; pull its rows (and any
      // applied campaign settings) into Dexie right away.
      void getSyncOrchestrator().triggerCursorPull();
      if (result.campaignSettingsApplied) {
        qc.invalidateQueries({ queryKey: ['campaigns'] });
      }
    },
    onError: (err) => {
      setImportMessage(null);
      setImportError(err instanceof ApiError ? err.message : 'Import failed');
    },
  });

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
      if (mode === 'replace' && !localLibrary) {
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
        const current = localLibrary?.[key];
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

  const shell = (key: SectionKey): LibrarySectionShellProps => ({
    campaignId: campaignId ?? '',
    library,
    words,
    active: section === key,
    isOwner,
    expandedId,
    onToggleExpanded,
    jumpSlot,
    revealId,
    onRevealed,
  });

  const pageStyle = {
    '--library-scroll-offset': `${headerBottom + toolbarHeight + 8}px`,
  } as CSSProperties;

  return (
    <div className="mx-auto max-w-5xl space-y-6" style={pageStyle}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-eyebrow">
            Campaign · {currentCampaign?.name ?? 'No campaign selected'}
          </p>
          <h1 className="font-display text-4xl font-semibold leading-none">Library</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Hide campaign switcher when the parent already scoped us to a campaign */}
          {!campaignIdProp && sortedCampaigns && sortedCampaigns.length > 1 && (
            <select
              className="select select-bordered select-sm"
              value={campaignId ?? ''}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set('campaign', e.target.value);
                next.delete('open');
                setParams(next);
              }}
              aria-label="Select campaign"
            >
              {sortedCampaigns.map((c) => (
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

      {campaigns !== undefined && !campaignIdProp && campaigns.length === 0 && (
        <div className="card p-card text-center text-muted">
          You don&apos;t belong to any campaigns yet.
        </div>
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
              not present in the uploaded file. Importing needs a connection.
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
          {pendingImport?.counts.map((row) => (
            <li key={row.label}>
              {row.label}: {row.incoming} in file
              {row.removed !== null && ` · ${row.removed} to remove`}
            </li>
          ))}
        </ul>
        {pendingImport?.mode === 'replace' &&
          pendingImport.counts.some((row) => row.removed === null) && (
            <p className="mt-2 text-warning">
              Some current section counts are unavailable. The server will report final deletion
              counts after import.
            </p>
          )}
        {importError && <p className="alert alert-error mt-2">{importError}</p>}
      </ConfirmDialog>

      <div ref={toolbarRef} className="library-toolbar" style={{ top: `${headerBottom}px` }}>
        <div className="flex gap-2 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible">
          {SECTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => updateParams({ section: key === 'traits' ? null : key }, false)}
              className={`chip shrink-0 ${section === key ? 'on' : ''}`}
              aria-pressed={section === key}
            >
              {label}{' '}
              <span className="num text-dim ml-1">{localLibrary ? library[key].length : '—'}</span>
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="label-eyebrow mb-1 block">Search library</span>
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
        <div ref={setJumpSlot} className="empty:hidden" />
      </div>

      {campaignId && localLibrary === undefined && <p className="text-muted">Loading library…</p>}

      {campaignId && localLibrary && (
        <div className="flex flex-col gap-3">
          <TraitsSection {...shell('traits')} />
          <SkillsSection {...shell('skills')} />
          <SpellsSection {...shell('spells')} />
          <ItemsSection {...shell('items')} />
          <EnchantmentsSection {...shell('enchantments')} />
          <ActiveEffectsSection {...shell('activeEffects')} />
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
