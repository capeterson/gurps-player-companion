/**
 * Campaign library viewer and campaign transfer tab. GMs can edit individual
 * entries; members can browse and download the visible library.
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
import { Link } from 'react-router-dom';
import {
  type LibraryGraph,
  libraryEditionDecisions,
  mergeLibraryGraph,
  validateLibraryGraph,
} from '../../../shared/domain/libraryGraph.ts';
import {
  canAdoptLibraryEntry,
  canonicalLibraryKey,
} from '../../../shared/domain/libraryIdentity.ts';
import { libraryEntryKey } from '../../../shared/domain/libraryIdentity.ts';
import type { ImportResult, LibraryYamlDoc } from '../../../shared/schemas/campaignLibrary.ts';
import {
  importSourceReferences,
  previewSourceBooks,
} from '../../../shared/yaml/sourceReferences.ts';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { getLocalDb } from '../../db/dexie.ts';
import { useAppHeaderBottom } from '../../hooks/useAppHeaderBottom.ts';
import { useSelectedCampaignId } from '../../hooks/useSelectedCampaignId.ts';
import { ApiError, api, apiFetch } from '../../lib/api.ts';
import { editingFocusBounds } from '../../lib/editingFocusBounds.ts';
import { readActiveUser } from '../../sync/activeUser.ts';
import { journalCampaignMutation } from '../../sync/onlineMutationLog.ts';
import { getSyncOrchestrator } from '../../sync/orchestrator.ts';
import { LibraryPackageEditor, type PackageReview } from './LibraryPackageEditor.tsx';
import { librarySearchWords } from './librarySearch.ts';
import { ActiveEffectsSection } from './sections/ActiveEffectsSection.tsx';
import { CatalogSection } from './sections/CatalogSection.tsx';
import type { LibrarySectionShellProps } from './sections/CrudLibrarySection.tsx';
import { EnchantmentsSection } from './sections/EnchantmentsSection.tsx';
import { ItemsSection } from './sections/ItemsSection.tsx';
import { LanguagesSection } from './sections/LanguagesSection.tsx';
import { RacesSection } from './sections/RacesSection.tsx';
import { SkillsSection } from './sections/SkillsSection.tsx';
import { SpellsSection } from './sections/SpellsSection.tsx';
import { StylesSection } from './sections/StylesSection.tsx';
import { TechniquesSection } from './sections/TechniquesSection.tsx';
import { TraitsSection } from './sections/TraitsSection.tsx';
import { type LocalLibrary, emptyLibrary, useLocalLibrary } from './useLocalLibrary.ts';

type SectionKey =
  | 'sources'
  | 'modifiers'
  | 'races'
  | 'traits'
  | 'skills'
  | 'spells'
  | 'items'
  | 'languages'
  | 'techniques'
  | 'styles'
  | 'enchantments'
  | 'activeEffects';

const SECTIONS: readonly { key: SectionKey; label: string }[] = [
  { key: 'sources', label: 'Sources' },
  { key: 'modifiers', label: 'Modifiers' },
  { key: 'races', label: 'Races' },
  { key: 'traits', label: 'Traits' },
  { key: 'skills', label: 'Skills' },
  { key: 'spells', label: 'Spells' },
  { key: 'items', label: 'Items' },
  { key: 'languages', label: 'Languages' },
  { key: 'techniques', label: 'Techniques' },
  { key: 'styles', label: 'Styles' },
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
export function LibraryPage({
  campaignId: campaignIdProp,
  transferOnly = false,
}: {
  campaignId?: string;
  transferOnly?: boolean;
} = {}) {
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

  const activeEffectsEnabled = currentCampaign?.experimentalActiveEffects === true;
  const activeEffectsVisible = activeEffectsEnabled || isOwner;
  const requestedSection = parseSection(params.get('section'));
  const section =
    requestedSection === 'activeEffects' && !activeEffectsVisible ? 'traits' : requestedSection;
  const visibleSections = SECTIONS.filter(
    ({ key }) => key !== 'activeEffects' || activeEffectsVisible,
  );
  const [sourceFilter, setSourceFilter] = useState('');
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
  const pageRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [viewportBounds, setViewportBounds] = useState(() => ({
    top: window.visualViewport?.offsetTop ?? 0,
    bottom:
      (window.visualViewport?.offsetTop ?? 0) +
      (window.visualViewport?.height ?? window.innerHeight),
  }));
  useLayoutEffect(() => {
    const measure = () => {
      const top = window.visualViewport?.offsetTop ?? 0;
      const bottom = top + (window.visualViewport?.height ?? window.innerHeight);
      setViewportBounds((previous) =>
        previous.top === top && previous.bottom === bottom ? previous : { top, bottom },
      );
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, []);
  // Preserve the toolbar's document space, but let it scroll when pinning it
  // would leave less than half the visible space below the app header for edits.
  const toolbarPinned =
    toolbarHeight <=
    Math.max(0, viewportBounds.bottom - Math.max(headerBottom, viewportBounds.top)) / 2;
  const scrollOffset = headerBottom + (toolbarPinned ? toolbarHeight : 0) + 8;
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => setToolbarHeight(toolbar.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(toolbar);
    return () => observer?.disconnect();
  }, []);
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    let frame = 0;
    const keepFocusedFieldVisible = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const active = document.activeElement;
          const content = page.querySelector('.library-content');
          if (!(active instanceof HTMLElement) || !content?.contains(active)) return;

          const isEditable =
            active instanceof HTMLButtonElement ||
            active instanceof HTMLAnchorElement ||
            active instanceof HTMLTextAreaElement ||
            active instanceof HTMLSelectElement ||
            active.isContentEditable ||
            (active instanceof HTMLInputElement &&
              ![
                'button',
                'checkbox',
                'color',
                'file',
                'image',
                'radio',
                'range',
                'reset',
                'submit',
              ].includes(active.type));
          if (!isEditable) return;

          const visualViewport = window.visualViewport;
          const viewportTop = visualViewport?.offsetTop ?? 0;
          const labelSpace =
            active instanceof HTMLInputElement || active instanceof HTMLSelectElement ? 24 : 0;
          const top = Math.max(viewportTop + 8, scrollOffset + labelSpace);
          const bottom = viewportTop + (visualViewport?.height ?? window.innerHeight) - 8;
          const left = (visualViewport?.offsetLeft ?? 0) + 8;
          const right = left + (visualViewport?.width ?? window.innerWidth) - 16;
          const bounds = editingFocusBounds(active);
          if (
            bounds.top >= top &&
            bounds.bottom <= bottom &&
            bounds.left >= left &&
            bounds.right <= right
          )
            return;

          // A whole editor can intersect the screen while its caret is clipped.
          // Native scrolling of the editing point can also pan a pinch-zoomed
          // visual viewport when the layout document has no horizontal overflow.
          const marker = document.createElement('span');
          marker.setAttribute('aria-hidden', 'true');
          Object.assign(marker.style, {
            position: 'absolute',
            pointerEvents: 'none',
            visibility: 'hidden',
            left: `${bounds.left + window.scrollX}px`,
            top: `${bounds.top + window.scrollY}px`,
            width: `${Math.max(1, bounds.width)}px`,
            height: `${bounds.height}px`,
            scrollMarginTop: `${Math.max(8, top - viewportTop)}px`,
            scrollMarginBottom: '8px',
            scrollMarginInline: '8px',
          });
          document.body.append(marker);
          try {
            marker.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
          } finally {
            marker.remove();
          }
        });
      });
    };

    document.addEventListener('focusin', keepFocusedFieldVisible);
    page.addEventListener('input', keepFocusedFieldVisible);
    document.addEventListener('selectionchange', keepFocusedFieldVisible);
    window.addEventListener('resize', keepFocusedFieldVisible);
    window.visualViewport?.addEventListener('resize', keepFocusedFieldVisible);
    keepFocusedFieldVisible();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', keepFocusedFieldVisible);
      page.removeEventListener('input', keepFocusedFieldVisible);
      document.removeEventListener('selectionchange', keepFocusedFieldVisible);
      window.removeEventListener('resize', keepFocusedFieldVisible);
      window.visualViewport?.removeEventListener('resize', keepFocusedFieldVisible);
    };
  }, [scrollOffset]);
  const [jumpSlot, setJumpSlot] = useState<HTMLElement | null>(null);

  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [packageOpen, setPackageOpen] = useState(false);
  const [applyCampaignSettings, setApplyCampaignSettings] = useState(false);
  const [fileCandidate, setFileCandidate] = useState<{
    yaml: string;
    fileName: string;
    doc: LibraryYamlDoc;
  } | null>(null);
  const [selectedImportKeys, setSelectedImportKeys] = useState<string[] | null>(null);
  const [selectedExportIds, setSelectedExportIds] = useState<string[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    campaignId: string;
    fileName: string;
    yaml: string;
    mode: 'merge' | 'replace';
    sourceKeys: string[] | null;
    applyCampaignSettings: boolean;
    counts: { label: string; incoming: number; removed: number | null }[];
    blocked: number;
    editionDecisions: ReturnType<typeof libraryEditionDecisions>;
  } | null>(null);

  useEffect(() => {
    setPendingImport((current) => (current?.campaignId === campaignId ? current : null));
  }, [campaignId]);

  const importMutation = useMutation({
    mutationFn: (snap: {
      campaignId: string;
      yaml: string;
      mode: 'merge' | 'replace';
      sourceKeys: string[] | null;
      applyCampaignSettings: boolean;
    }) =>
      journalCampaignMutation(
        {
          entityId: snap.campaignId,
          command: 'patch',
          method: 'POST',
          path: `/campaigns/${snap.campaignId}/library/import`,
          body: {
            yaml: snap.yaml,
            mode: snap.mode,
            ...(snap.sourceKeys ? { sourceKeys: snap.sourceKeys } : {}),
            applyCampaignSettings: snap.applyCampaignSettings,
          },
          source: 'Library import',
          humanName: 'library imported',
          before: { name: campaigns?.find((c) => c.id === snap.campaignId)?.name },
        },
        () =>
          api<ImportResult>(`/campaigns/${snap.campaignId}/library/import`, {
            method: 'POST',
            body: {
              yaml: snap.yaml,
              mode: snap.mode,
              ...(snap.sourceKeys ? { sourceKeys: snap.sourceKeys } : {}),
              applyCampaignSettings: snap.applyCampaignSettings,
            },
          }),
      ),
    onSuccess: (result) => {
      setPendingImport(null);
      setImportError(null);
      setImportMessage(formatImportResult(result));
      setPackageOpen(false);
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
    setFileCandidate(null);
    setPendingImport(null);
    if (file.size > 20 * 1024 * 1024) {
      setImportError('YAML payload is larger than 20 MB');
      return;
    }
    try {
      const yaml = await file.text();
      // Loaded on demand: the YAML parser is only needed for an import.
      const { parseLibraryYaml } = await import('../../../shared/yaml/library.ts');
      if (selectedCampaignId !== currentCampaignId.current) return;
      const parsed = parseLibraryYaml(yaml);
      setFileCandidate({ yaml, fileName: file.name, doc: parsed });
      setSelectedImportKeys(parsed.scope?.sourceKeys ?? null);
      setPendingImport(null);
      setImportError(null);
      setImportMessage(null);
    } catch (error) {
      setFileCandidate(null);
      setPendingImport(null);
      setImportError(error instanceof Error ? error.message : 'Could not read YAML file');
    }
  }

  async function prepareImport(review?: PackageReview) {
    if ((!fileCandidate && !review) || !campaignId) return;
    try {
      const { parseLibraryYaml, sourceScopedLibrary } = await import(
        '../../../shared/yaml/library.ts'
      );
      const candidate = review
        ? { yaml: review.yaml, fileName: 'Library package', doc: parseLibraryYaml(review.yaml) }
        : fileCandidate;
      if (!candidate) return;
      const { yaml, fileName, doc: parsed } = candidate;
      const sourceKeys =
        parsed.scope?.sourceKeys ?? (review ? review.sourceKeys : selectedImportKeys);
      const portableIncoming = sourceKeys
        ? sourceScopedLibrary(parsed.library, sourceKeys)
        : parsed.library;
      if (!localLibrary)
        throw new Error('Wait for the current library before validating an import');
      const incoming = importSourceReferences(
        portableIncoming,
        previewSourceBooks(portableIncoming.sources, localLibrary.sources),
      ) as LibraryGraph;
      const scopedIds = sourceKeys
        ? (incoming.sources ?? []).map((source) => source.id as string)
        : undefined;
      const mode = review?.mode ?? importMode;
      const applySettings = !sourceKeys && (review?.applyCampaignSettings ?? applyCampaignSettings);
      if (mode === 'replace' && !localLibrary) {
        throw new Error('Reload the current library before replacing it');
      }
      const sections = [
        ['Sources', 'sources', (entry: { id?: string | undefined }) => entry.id ?? ''],
        ['Modifiers', 'modifiers', libraryEntryKey],
        ['Traits', 'traits', libraryEntryKey],
        ['Skills', 'skills', libraryEntryKey],
        ['Spells', 'spells', libraryEntryKey],
        ['Items', 'items', libraryEntryKey],
        ['Enchantments', 'enchantments', libraryEntryKey],
        ['Active effects', 'activeEffects', libraryEntryKey],
        ['Races', 'races', libraryEntryKey],
        ['Languages', 'languages', libraryEntryKey],
        ['Techniques', 'techniques', libraryEntryKey],
        ['Styles', 'styles', libraryEntryKey],
      ] as const;
      if (!localLibrary)
        throw new Error('Wait for the current library before validating an import');
      validateLibraryGraph(
        mergeLibraryGraph(localLibrary, incoming as LibraryGraph, mode, scopedIds),
      );
      const blocked = Object.values(incoming)
        .flat()
        .filter((entry) => entry != null && !canAdoptLibraryEntry(entry)).length;
      const selectedSourceIds = scopedIds && new Set(scopedIds);
      const preview = sections.flatMap(([label, key, naturalKey]) => {
        const incomingRows = incoming[key];
        // Omitted optional sections are intentionally untouched by Replace.
        if (!incomingRows) return [];
        const current = localLibrary?.[key];
        const incomingKeys = new Set(incomingRows.map((entry) => naturalKey(entry as never)));
        return [
          {
            label,
            incoming: incomingRows.length,
            removed:
              mode === 'replace' && current
                ? current.filter(
                    (entry) =>
                      (!selectedSourceIds ||
                        (key !== 'sources' &&
                          'sourceId' in entry &&
                          selectedSourceIds.has(String(entry.sourceId)))) &&
                      !incomingKeys.has(naturalKey(entry as never)),
                  ).length
                : null,
          },
        ];
      });
      setImportError(null);
      setImportMessage(null);
      setPendingImport({
        campaignId,
        fileName,
        yaml,
        sourceKeys,
        mode,
        applyCampaignSettings: applySettings,
        counts: preview,
        blocked,
        editionDecisions: libraryEditionDecisions(localLibrary, incoming as LibraryGraph),
      });
    } catch (error) {
      setPendingImport(null);
      setImportError(error instanceof Error ? error.message : 'Could not read YAML file');
    }
  }

  function downloadExport() {
    if (!campaignId) return;
    setExportError(null);
    // Route through `apiFetch` so the export inherits the shared
    // refresh-on-401 retry; a raw `fetch` would 401 the first time
    // after the 15-minute access-token TTL expires.  An anchor-click
    // download would also drop the Authorization header, so we still
    // need to pull the bytes via fetch and synthesize a blob URL.
    void (async () => {
      try {
        const query = selectedExportIds?.length
          ? `?sourceIds=${encodeURIComponent(JSON.stringify(selectedExportIds))}`
          : '';
        const res = await apiFetch(`/campaigns/${campaignId}/library/export${query}`);
        if (!res.ok) {
          setExportError(`Export failed: HTTP ${res.status}`);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slugify(currentCampaign?.name ?? 'library')}-${selectedExportIds ? 'sourcebooks' : 'library'}.yaml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        setExportError(err instanceof Error ? err.message : 'Export failed');
      }
    })();
  }

  const shell = (key: SectionKey): LibrarySectionShellProps => ({
    campaignId: campaignId ?? '',
    library,
    words,
    sourceFilter: key === 'sources' ? '' : sourceFilter,
    active: section === key,
    isOwner,
    expandedId,
    onToggleExpanded,
    jumpSlot,
    revealId,
    onRevealed,
  });

  const pageStyle = {
    '--library-scroll-offset': `${scrollOffset}px`,
  } as CSSProperties;

  if (transferOnly)
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h2 className="font-display text-2xl font-semibold">Import &amp; export</h2>
          <p className="mt-1 text-sm text-base-content/60">
            Move a whole campaign library or selected sourcebooks between campaigns.
          </p>
        </header>
        <section className="card card-border bg-base-100">
          <div className="card-body gap-4">
            <h3 className="card-title">Export YAML</h3>
            <p>Choose sourcebooks for a portable package, or export the entire library.</p>
            <SourcebookSelection
              sources={library.sources.map((source) => ({ ...source, key: source.id }))}
              selected={selectedExportIds}
              onChange={setSelectedExportIds}
              allLabel="Entire library"
            />
            {selectedExportIds !== null && (
              <p className="text-sm text-base-content/60">
                Entries without a sourcebook are excluded from this export.
              </p>
            )}
            {exportError && (
              <p role="alert" className="alert alert-error">
                {exportError}
              </p>
            )}
            <div className="card-actions justify-end">
              <button
                className="btn btn-sm"
                type="button"
                disabled={
                  !campaignId || (selectedExportIds !== null && selectedExportIds.length === 0)
                }
                onClick={downloadExport}
              >
                Export YAML
              </button>
            </div>
          </div>
        </section>
        {isOwner &&
          currentCampaign &&
          localLibrary &&
          (packageOpen ? (
            <LibraryPackageEditor
              key={campaignId}
              campaign={currentCampaign}
              library={localLibrary}
              pending={importMutation.isPending}
              onCancel={() => setPackageOpen(false)}
              onReview={(review) => void prepareImport(review)}
            />
          ) : (
            <section className="card card-border bg-base-100">
              <div className="card-body gap-3">
                <h3 className="card-title">Edit a library package</h3>
                <p>
                  Stage related entries and campaign settings together, then review a merge or
                  replacement.
                </p>
                <div className="card-actions justify-end">
                  <button type="button" className="btn btn-sm" onClick={() => setPackageOpen(true)}>
                    Edit package
                  </button>
                </div>
              </div>
            </section>
          ))}
        {isOwner && (
          <section className="card card-border bg-base-100">
            <div className="card-body gap-4">
              <h3 className="card-title">Import YAML</h3>
              <p>
                Merge adds or updates entries. Replace also removes missing entries within the
                selected scope. Sourcebook imports leave other books and campaign settings alone.
              </p>
              <label className="form-control">
                <span className="label-text">YAML file</span>
                <input
                  type="file"
                  className="file-input file-input-sm"
                  accept=".yaml,.yml,text/yaml,application/yaml,text/plain"
                  disabled={importMutation.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onFileSelected(file);
                    e.target.value = '';
                  }}
                />
              </label>
              {fileCandidate && (
                <>
                  <p className="text-sm">Selected: {fileCandidate.fileName}</p>
                  <SourcebookSelection
                    sources={fileCandidate.doc.library.sources ?? []}
                    selected={selectedImportKeys}
                    onChange={setSelectedImportKeys}
                    allLabel="Entire file"
                    locked={!!fileCandidate.doc.scope}
                  />
                </>
              )}
              <label className="form-control">
                <span className="label-text">Mode</span>
                <select
                  className="select select-sm"
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
                >
                  <option value="merge">Merge (add/update)</option>
                  <option value="replace">Replace selected scope</option>
                </select>
              </label>
              {!selectedImportKeys && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={applyCampaignSettings}
                    onChange={(e) => setApplyCampaignSettings(e.target.checked)}
                  />
                  Apply campaign settings from the file
                </label>
              )}
              {importError && (
                <p role="alert" className="alert alert-error">
                  {importError}
                </p>
              )}
              {importMessage && <output className="alert alert-success">{importMessage}</output>}
              <div className="card-actions justify-end">
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={
                    !fileCandidate ||
                    importMutation.isPending ||
                    (selectedImportKeys !== null && selectedImportKeys.length === 0)
                  }
                  onClick={() => void prepareImport()}
                >
                  Review import
                </button>
              </div>
            </div>
          </section>
        )}
        <ConfirmDialog
          open={pendingImport !== null}
          title={`Import ${pendingImport?.fileName ?? 'YAML'}?`}
          confirmLabel={
            pendingImport?.mode === 'replace' ? 'Replace selected scope' : 'Merge library'
          }
          tone={pendingImport?.mode === 'replace' ? 'error' : 'primary'}
          pending={importMutation.isPending}
          pendingLabel="Importing…"
          onCancel={() => setPendingImport(null)}
          onConfirm={() => {
            if (
              !pendingImport ||
              pendingImport.campaignId !== campaignId ||
              importMutation.isPending
            )
              return;
            importMutation.mutate({
              campaignId: pendingImport.campaignId,
              yaml: pendingImport.yaml,
              mode: pendingImport.mode,
              sourceKeys: pendingImport.sourceKeys,
              applyCampaignSettings: pendingImport.applyCampaignSettings,
            });
          }}
        >
          <p>
            {pendingImport?.sourceKeys
              ? `Selected sourcebooks: ${pendingImport.sourceKeys.join(', ')}. Other sourcebooks remain unchanged.`
              : 'The entire file will be imported.'}
          </p>
          <ul className="mt-2 space-y-1" aria-label="Import preview">
            {pendingImport?.counts.map((row) => (
              <li key={row.label}>
                {row.label}: {row.incoming} in file
                {row.removed !== null && ` · ${row.removed} to remove`}
              </li>
            ))}
          </ul>
          {pendingImport?.blocked ? (
            <p>
              {pendingImport.blocked} incomplete or reference entries cannot be added to characters.
            </p>
          ) : null}
          {pendingImport?.editionDecisions.length ? (
            <p>{pendingImport.editionDecisions.length} edition decisions will be applied.</p>
          ) : null}
          {importError && (
            <p role="alert" className="alert alert-error mt-2">
              {importError}
            </p>
          )}
        </ConfirmDialog>
      </div>
    );

  return (
    <div ref={pageRef} className="mx-auto max-w-5xl space-y-6" style={pageStyle}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {!campaignIdProp && (
            <p className="label-eyebrow">
              Campaign · {currentCampaign?.name ?? 'No campaign selected'}
            </p>
          )}
          {campaignIdProp ? (
            <h2 className="font-display text-2xl font-semibold leading-none">Library</h2>
          ) : (
            <h1 className="font-display text-4xl font-semibold leading-none">Library</h1>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link
            className="link text-sm"
            to={`/help/campaign-library${campaignId ? `?campaign=${encodeURIComponent(campaignId)}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Library guide <span className="sr-only">(opens in a new tab)</span>
            <span aria-hidden="true">↗</span>
          </Link>
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
        </div>
      </header>

      {campaigns !== undefined && !campaignIdProp && campaigns.length === 0 && (
        <div className="card p-card text-center text-muted">
          You don&apos;t belong to any campaigns yet.
        </div>
      )}

      <div
        ref={toolbarRef}
        className="library-toolbar"
        style={{ top: `${headerBottom}px`, position: toolbarPinned ? undefined : 'static' }}
      >
        <div className="flex gap-2 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible">
          {visibleSections.map(({ key, label }) => (
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
        <div className="flex flex-wrap items-end gap-2">
          <label className="shrink-0">
            Source
            <select
              className="select select-sm max-w-40"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="">All sources</option>
              {library.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.abbreviation}
                </option>
              ))}
            </select>
          </label>
          <div className="flex min-w-64 flex-1 items-end gap-2">
            <label className="min-w-36 flex-1">
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
              <button type="button" className="btn btn-sm shrink-0" onClick={() => setSearch('')}>
                Clear search
              </button>
            )}
          </div>
        </div>
        <div ref={setJumpSlot} className="empty:hidden" />
      </div>

      {campaignId && localLibrary === undefined && <p className="text-muted">Loading library…</p>}

      {campaignId && localLibrary && (
        <div className="library-content flex flex-col gap-3">
          <CatalogSection section="sources" {...shell('sources')} />
          <CatalogSection section="modifiers" {...shell('modifiers')} />
          <RacesSection {...shell('races')} />
          <TraitsSection {...shell('traits')} />
          <SkillsSection {...shell('skills')} />
          <SpellsSection {...shell('spells')} />
          <ItemsSection {...shell('items')} />
          <LanguagesSection {...shell('languages')} />
          <TechniquesSection {...shell('techniques')} />
          <StylesSection {...shell('styles')} />
          <EnchantmentsSection {...shell('enchantments')} />
          {activeEffectsVisible && <ActiveEffectsSection {...shell('activeEffects')} />}
        </div>
      )}
    </div>
  );
}

function SourcebookSelection({
  sources,
  selected,
  onChange,
  allLabel,
  locked = false,
}: {
  sources: readonly { key: string; name: string; abbreviation: string }[];
  selected: string[] | null;
  onChange: (keys: string[] | null) => void;
  allLabel: string;
  locked?: boolean;
}) {
  return (
    <fieldset className="fieldset">
      <legend className="font-medium">Scope</legend>
      {!locked && (
        <label className="flex items-center gap-2">
          <input
            className="checkbox checkbox-sm"
            type="checkbox"
            checked={selected === null}
            onChange={() => onChange(null)}
          />
          {allLabel}
        </label>
      )}
      {sources.length === 0 && (
        <p className="text-sm text-base-content/60">No sourcebooks in this file.</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((source) => (
          <label key={source.key} className="flex min-w-0 items-start gap-2">
            <input
              className="checkbox checkbox-sm shrink-0"
              type="checkbox"
              disabled={locked}
              checked={
                selected?.some(
                  (key) => canonicalLibraryKey(key) === canonicalLibraryKey(source.key),
                ) ?? false
              }
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...(selected ?? []), source.key]
                    : (selected ?? []).filter(
                        (key) => canonicalLibraryKey(key) !== canonicalLibraryKey(source.key),
                      ),
                )
              }
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {source.abbreviation}: {source.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function formatImportResult(r: ImportResult): string {
  const totals = (label: SectionKey) => {
    const s = r[label] ?? { created: 0, updated: 0, deleted: 0 };
    return `${label}: +${s.created} · ~${s.updated} · −${s.deleted}`;
  };
  const blockedNote = r.incomplete
    ? `; ${r.incomplete} incomplete/reference entries blocked from adoption`
    : '';
  const settingsNote = r.campaignSettingsApplied ? '; campaign settings applied' : '';
  return `Imported in ${r.mode} mode — ${totals('races')}, ${totals('traits')}, ${totals('skills')}, ${totals('spells')}, ${totals('items')}, ${totals('languages')}, ${totals('techniques')}, ${totals('styles')}, ${totals('enchantments')}, ${totals('sources')}, ${totals('modifiers')}${settingsNote}${blockedNote}`;
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
