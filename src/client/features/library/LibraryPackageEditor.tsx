import { useMemo, useState } from 'react';
import { stringify } from 'yaml';
import { z } from 'zod';
import { canonicalLibraryKey } from '../../../shared/domain/libraryIdentity.ts';
import { type LibraryYamlDoc, libraryYamlDoc } from '../../../shared/schemas/campaignLibrary.ts';
import {
  LIBRARY_YAML_VERSION,
  parseLibraryYaml,
  sourceScopedLibrary,
} from '../../../shared/yaml/library.ts';
import {
  exportSourceReferences,
  importSourceReferences,
  previewSourceBooks,
  sourceExportKeys,
} from '../../../shared/yaml/sourceReferences.ts';
import type { LocalCampaign } from '../../db/dexie.ts';
import { newClientId } from '../../sync/outbox.ts';
import { LibraryAuthoringContext } from './LibraryAuthoringContext.tsx';
import { LibraryEntryFields } from './LibraryEntryFields.tsx';
import { SourcebooksContext, sourcebookLabel } from './SourcebooksContext.tsx';
import { StructuredFields } from './StructuredFields.tsx';
import { editorLabel, objectShape, seedSchema, unwrapSchema } from './editorSchema.ts';
import {
  type LibraryEditorSection,
  libraryEditorNouns,
  libraryEditorSchemas,
} from './libraryEditorSchemas.ts';
import type { LocalLibrary } from './useLocalLibrary.ts';

type DraftRow = Record<string, unknown> & { id: string };
type DraftLibrary = Record<LibraryEditorSection, DraftRow[]>;
type CampaignDraft = Record<string, unknown>;
const SECTIONS = Object.keys(libraryEditorSchemas) as LibraryEditorSection[];
const REQUIRED_SECTIONS = new Set<LibraryEditorSection>(['traits', 'skills', 'items']);
const campaignSchema = z.object(
  Object.fromEntries(
    Object.entries(objectShape(unwrapSchema(libraryYamlDoc.shape.campaign))).filter(
      ([key]) => key !== 'name',
    ),
  ),
);
const labels: Record<LibraryEditorSection, string> = {
  sources: 'Sources',
  modifiers: 'Modifiers',
  races: 'Races',
  traits: 'Traits',
  skills: 'Skills',
  spells: 'Spells',
  items: 'Items',
  languages: 'Languages',
  techniques: 'Techniques',
  styles: 'Styles',
  enchantments: 'Enchantments',
  activeEffects: 'Active effects',
};

/** Schema paths point into the emitted package, which may have a source-filtered row order. */
function packageIssueLabel(doc: LibraryYamlDoc, path: readonly PropertyKey[]): string {
  const [root, section, index, ...fields] = path;
  const fieldLabel = (parts: readonly PropertyKey[]) =>
    parts
      .map((part) => (typeof part === 'number' ? `Entry ${part + 1}` : editorLabel(String(part))))
      .join(' → ');
  if (
    root === 'library' &&
    typeof section === 'string' &&
    SECTIONS.includes(section as LibraryEditorSection)
  ) {
    const category = section as LibraryEditorSection;
    if (typeof index === 'number') {
      const row = doc.library[category]?.[index];
      const name =
        row && 'name' in row && typeof row.name === 'string' && row.name.trim()
          ? row.name
          : `Entry ${index + 1}`;
      return `${labels[category]}: ${name}${fields.length ? ` — ${fieldLabel(fields)}` : ''}`;
    }
    return labels[category];
  }
  if (root === 'campaign')
    return `Campaign settings${path.length > 1 ? ` — ${fieldLabel(path.slice(1))}` : ''}`;
  return fieldLabel(path) || 'Package';
}

/** Discard row transport fields while preserving every writable definition field. */
export function packageEntryBody(section: LibraryEditorSection, row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.keys(objectShape(libraryEditorSchemas[section]))
      .filter((key) => row[key] !== undefined)
      .map((key) => [key, row[key]]),
  );
}

export function packageLibraryDraft(library: LocalLibrary): DraftLibrary {
  return Object.fromEntries(
    SECTIONS.map((section) => [
      section,
      library[section].map((row) => ({
        ...packageEntryBody(section, row as unknown as Record<string, unknown>),
        id: row.id,
      })),
    ]),
  ) as DraftLibrary;
}

export interface PackageReview {
  yaml: string;
  mode: 'merge' | 'replace';
  sourceKeys: string[] | null;
  applyCampaignSettings: boolean;
}

function comparableEntry(section: LibraryEditorSection, row: DraftRow): string {
  const body = packageEntryBody(section, row);
  const parsed = libraryEditorSchemas[section].safeParse(body);
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .filter(([, child]) => child !== undefined)
          .map(([key, child]) => [key, stable(child)]),
      );
    return value;
  };
  return JSON.stringify(stable(parsed.success ? parsed.data : body));
}

/** A source-scoped package must not silently filter away the author's changes. */
function assertPackageScopeEdits(
  draft: DraftLibrary,
  baseline: DraftLibrary,
  included: ReadonlySet<LibraryEditorSection>,
  sourceIds: readonly string[],
) {
  const selected = new Set(sourceIds);
  for (const category of SECTIONS) {
    if (!included.has(category) && category !== 'sources') continue;
    const oldRows = new Map(baseline[category].map((row) => [row.id, row]));
    const newRows = new Map(draft[category].map((row) => [row.id, row]));
    const inScope = (row: DraftRow) =>
      selected.has(category === 'sources' ? row.id : String(row.sourceId ?? ''));
    for (const id of new Set([...oldRows.keys(), ...newRows.keys()])) {
      const before = oldRows.get(id);
      const after = newRows.get(id);
      if (before && after && comparableEntry(category, before) === comparableEntry(category, after))
        continue;
      if ((!before || inScope(before)) && (!after || inScope(after))) continue;
      const name = String(after?.name ?? before?.name ?? libraryEditorNouns[category]);
      if (after && category !== 'sources' && !after.sourceId)
        throw new Error(
          `“${name}” has no selected sourcebook. Choose a sourcebook for it or choose Entire library before reviewing.`,
        );
      throw new Error(
        `“${name}” has changes outside the selected sourcebooks. Include its sourcebook, choose Entire library, or undo these changes before reviewing.`,
      );
    }
  }
}

/** Kept separate from rendering so category omission and source boundaries are explicit. */
export function buildLibraryPackage({
  draft,
  baseline,
  included,
  campaign,
  selectedSourceIds,
  validate = true,
}: {
  draft: DraftLibrary;
  baseline: DraftLibrary;
  included: ReadonlySet<LibraryEditorSection>;
  campaign?: CampaignDraft;
  selectedSourceIds: readonly string[] | null;
  /** Partial typed drafts remain visible in the raw disclosure before validation. */
  validate?: boolean;
}): LibraryYamlDoc {
  if (validate && selectedSourceIds !== null)
    assertPackageScopeEdits(draft, baseline, included, selectedSourceIds);
  const books = draft.sources as unknown as LocalLibrary['sources'];
  const sourceKeys = sourceExportKeys(books);
  const live = Object.fromEntries(
    SECTIONS.flatMap((section) => {
      // Required YAML categories default to [] when absent. Retain their baseline
      // when excluded so a Replace package cannot unexpectedly prune them.
      if (!included.has(section) && !REQUIRED_SECTIONS.has(section) && section !== 'sources')
        return [];
      const rows =
        included.has(section) || section === 'sources' ? draft[section] : baseline[section];
      return [
        [
          section,
          rows.map((row) =>
            section === 'sources'
              ? { ...packageEntryBody(section, row), key: sourceKeys.get(row.id) }
              : packageEntryBody(section, row),
          ),
        ],
      ];
    }),
  );
  // This package edits its current campaign. Keep attachment definitionId and
  // owned snapshots so an unrelated package edit cannot detach a live link.
  // The separate download export still strips campaign-specific attachment IDs.
  const portable = exportSourceReferences(live, books) as LibraryYamlDoc['library'];
  const keys = selectedSourceIds?.map((id) => {
    const key = sourceKeys.get(id);
    if (!key) throw new Error('A selected sourcebook was removed; choose its scope again.');
    return key;
  });
  const doc = {
    version: LIBRARY_YAML_VERSION,
    ...(keys ? { scope: { kind: 'sources', sourceKeys: keys } } : {}),
    ...(!keys && campaign ? { campaign } : {}),
    library: keys ? sourceScopedLibrary(portable, keys) : portable,
  };
  return validate ? libraryYamlDoc.parse(doc) : (doc as LibraryYamlDoc);
}

/** A staged package uses the existing online bulk import and confirmation path. */
export function LibraryPackageEditor({
  campaign,
  library,
  pending = false,
  onReview,
  onCancel,
}: {
  campaign: LocalCampaign;
  library: LocalLibrary;
  pending?: boolean;
  onReview: (review: PackageReview) => void;
  onCancel: () => void;
}) {
  const [baseline] = useState(() => packageLibraryDraft(library));
  const [draft, setDraft] = useState<DraftLibrary>(() => structuredClone(baseline));
  const [included, setIncluded] = useState(() => new Set(SECTIONS));
  const [section, setSection] = useState<LibraryEditorSection>('traits');
  const [openId, setOpenId] = useState<string | null>(null);
  const [visitedCategories, setVisitedCategories] = useState<ReadonlySet<LibraryEditorSection>>(
    new Set(['traits']),
  );
  const [visitedEntries, setVisitedEntries] = useState<ReadonlySet<string>>(new Set());
  const [editorRevision, setEditorRevision] = useState(0);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [sourceIds, setSourceIds] = useState<string[] | null>(null);
  const [applySettings, setApplySettings] = useState(false);
  const [campaignDraft, setCampaignDraft] = useState<CampaignDraft>(() =>
    Object.fromEntries(
      Object.keys(objectShape(campaignSchema))
        .filter((key) => campaign[key as keyof LocalCampaign] !== undefined)
        .map((key) => [key, campaign[key as keyof LocalCampaign]]),
    ),
  );
  const [rawDraft, setRawDraft] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalidEntries, setInvalidEntries] = useState<ReadonlySet<string>>(new Set());
  const generated = useMemo(() => {
    try {
      const doc = buildLibraryPackage({
        draft,
        baseline,
        included,
        ...(applySettings ? { campaign: campaignDraft } : {}),
        selectedSourceIds: sourceIds,
        validate: false,
      });
      const yaml = stringify(doc, { lineWidth: 100 });
      const validated = libraryYamlDoc.safeParse(doc);
      return {
        yaml,
        error: validated.success
          ? null
          : validated.error.issues
              .map((issue) => `${packageIssueLabel(doc, issue.path)}: ${issue.message}`)
              .join('; '),
      };
    } catch (cause) {
      return { yaml: '', error: cause instanceof Error ? cause.message : 'Invalid package' };
    }
  }, [draft, baseline, included, applySettings, campaignDraft, sourceIds]);
  const sourcebooks = draft.sources as unknown as LocalLibrary['sources'];
  const authoring = useMemo(
    () => ({ campaignId: campaign.id, library: draft as unknown as LocalLibrary }),
    [campaign.id, draft],
  );
  const invalidEntryLabels = SECTIONS.flatMap((section) =>
    draft[section]
      .filter((row) => invalidEntries.has(row.id))
      .map(
        (row) => `${labels[section]}: ${String(row.name || `New ${libraryEditorNouns[section]}`)}`,
      ),
  );
  const includedInvalidEntryLabels = SECTIONS.filter((section) => included.has(section)).flatMap(
    (section) =>
      draft[section]
        .filter((row) => invalidEntries.has(row.id))
        .map(
          (row) =>
            `${labels[section]}: ${String(row.name || `New ${libraryEditorNouns[section]}`)}`,
        ),
  );
  const invalidReviewMessage = includedInvalidEntryLabels.length
    ? `Correct invalid fields before reviewing this package: ${includedInvalidEntryLabels.join('; ')}.`
    : null;
  const validationMessage =
    [invalidReviewMessage, generated.error].filter(Boolean).join(' ') || null;

  function changeDraft(next: DraftLibrary) {
    setDraft(next);
    setRawDraft(null);
    setRawError(null);
    setError(null);
  }

  function readRaw(text: string) {
    setRawDraft(text);
    try {
      const parsed = parseLibraryYaml(text);
      const books = previewSourceBooks(parsed.library.sources, sourcebooks);
      const live = importSourceReferences(parsed.library, books) as Record<
        string,
        Record<string, unknown>[]
      >;
      const importedKeys = new Map(
        (parsed.library.sources ?? []).map((book, index) => [
          canonicalLibraryKey(book.key),
          String(live.sources?.[index]?.id ?? ''),
        ]),
      );
      const selectedSources = parsed.scope
        ? parsed.scope.sourceKeys.map((key) => {
            const found = importedKeys.get(canonicalLibraryKey(key));
            if (!found) throw new Error(`Unknown package sourcebook: ${key}`);
            return found;
          })
        : null;
      const scopedSourceIds = new Set(selectedSources ?? []);
      const next = structuredClone(baseline);
      const identity = (row: Record<string, unknown>) =>
        JSON.stringify([
          String(row.kind ?? ''),
          canonicalLibraryKey(String(row.key || row.name || '')),
          row.sourceId ?? '',
        ]);
      for (const key of SECTIONS) {
        if (!live[key]) continue;
        const incomingRows = live[key].map((row) => {
          const previous = [...draft[key], ...baseline[key]].find(
            (entry) => identity(entry) === identity(row),
          );
          return {
            ...row,
            id: typeof row.id === 'string' ? row.id : (previous?.id ?? newClientId()),
          };
        });
        const incomingIds = new Set(incomingRows.map((row) => row.id));
        // Scope omission preserves other books, including their editor identity.
        // Explicit out-of-scope rows remain in the draft for Review to flag edits.
        next[key] = parsed.scope
          ? [
              ...baseline[key].filter(
                (row) =>
                  !incomingIds.has(row.id) &&
                  !scopedSourceIds.has(key === 'sources' ? row.id : String(row.sourceId ?? '')),
              ),
              ...incomingRows,
            ]
          : incomingRows;
      }
      // A readable raw replacement explicitly supersedes the prior editor views.
      // Resolve every reference before committing any part of that replacement.
      setDraft(next);
      setIncluded(new Set(SECTIONS.filter((key) => parsed.library[key] !== undefined)));
      setSourceIds(selectedSources);
      if (parsed.campaign) setCampaignDraft(parsed.campaign);
      setApplySettings(parsed.campaign !== undefined && !parsed.scope);
      setEditorRevision((previous) => previous + 1);
      setInvalidEntries(new Set());
      setError(null);
      setRawError(null);
    } catch (cause) {
      setRawError(cause instanceof Error ? cause.message : 'Invalid YAML');
    }
  }

  function review() {
    try {
      if (rawError) throw new Error(rawError);
      if (invalidReviewMessage) throw new Error(invalidReviewMessage);
      buildLibraryPackage({
        draft,
        baseline,
        included,
        ...(applySettings ? { campaign: campaignDraft } : {}),
        selectedSourceIds: sourceIds,
      });
      const yaml = rawDraft ?? generated.yaml;
      if (!yaml) throw new Error(generated.error ?? 'Complete the package first.');
      const parsed = parseLibraryYaml(yaml);
      onReview({
        yaml,
        mode,
        sourceKeys: parsed.scope?.sourceKeys ?? null,
        applyCampaignSettings: applySettings && sourceIds === null,
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not review package');
    }
  }

  return (
    <section className="card card-border bg-base-100" aria-label="Library package editor">
      <div className="card-body min-w-0 gap-5">
        <div>
          <h3 className="card-title">Edit a library package</h3>
        </div>
        <fieldset disabled={pending} className="fieldset min-w-0 space-y-4">
          <fieldset disabled={rawError !== null} className="fieldset min-w-0 space-y-4">
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="form-control min-w-0 text-sm">
                Package mode
                <select
                  className="select select-sm w-full"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as 'merge' | 'replace')}
                >
                  <option value="merge">Merge — add or update</option>
                  <option value="replace">Replace — also remove missing entries</option>
                </select>
              </label>
              <label className="form-control min-w-0 text-sm">
                Package scope
                <select
                  className="select select-sm w-full"
                  value={sourceIds === null ? 'all' : 'books'}
                  onChange={(event) => {
                    setSourceIds(event.target.value === 'all' ? null : []);
                    setRawDraft(null);
                  }}
                >
                  <option value="all">Entire library</option>
                  <option value="books">Selected sourcebooks</option>
                </select>
              </label>
            </div>
            {sourceIds !== null && (
              <fieldset className="fieldset">
                <legend className="fieldset-legend">Sourcebooks in this package</legend>
                {sourcebooks.map((book) => (
                  <label key={book.id} className="flex min-w-0 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={sourceIds.includes(book.id)}
                      onChange={(event) => {
                        setSourceIds(
                          event.target.checked
                            ? [...sourceIds, book.id]
                            : sourceIds.filter((id) => id !== book.id),
                        );
                        setRawDraft(null);
                      }}
                    />
                    <span className="break-words">{sourcebookLabel(book)}</span>
                  </label>
                ))}
                <p className="text-sm text-base-content/60">
                  Entries without a selected sourcebook stay outside this package.
                </p>
              </fieldset>
            )}
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Categories to edit</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {SECTIONS.filter((key) => key !== 'sources').map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={included.has(key)}
                      onChange={(event) => {
                        setIncluded((previous) => {
                          const next = new Set(previous);
                          if (event.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        });
                        setRawDraft(null);
                      }}
                    />
                    {labels[key]}
                  </label>
                ))}
              </div>
              <p className="text-sm text-base-content/60">
                Excluded categories retain their current entries. Sourcebook records travel with
                their definitions.
              </p>
            </fieldset>
            {sourceIds === null && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={applySettings}
                    onChange={(event) => {
                      setApplySettings(event.target.checked);
                      setRawDraft(null);
                    }}
                  />
                  Include campaign settings
                </label>
                {applySettings && (
                  <StructuredFields
                    schema={campaignSchema}
                    value={campaignDraft}
                    label="Campaign settings"
                    onChange={(next) => {
                      setCampaignDraft(next as CampaignDraft);
                      setRawDraft(null);
                    }}
                  />
                )}
              </>
            )}
            <label className="form-control min-w-0 text-sm">
              Edit category
              <select
                className="select select-sm w-full"
                value={section}
                onChange={(event) => {
                  const next = event.target.value as LibraryEditorSection;
                  setSection(next);
                  setVisitedCategories((previous) => new Set([...previous, next]));
                }}
              >
                {SECTIONS.filter((key) => included.has(key) || key === 'sources').map((key) => (
                  <option key={key} value={key}>
                    {labels[key]}
                  </option>
                ))}
                {!included.has(section) && section !== 'sources' && (
                  <option value={section}>{labels[section]} — excluded</option>
                )}
              </select>
            </label>
            <SourcebooksContext.Provider value={sourcebooks}>
              {section === 'sources' && (
                <p className="text-sm text-base-content/70">
                  Changing a publication’s title, abbreviation or edition imports a different
                  sourcebook. Use the Sources editor to rename the existing book.
                </p>
              )}
              <LibraryAuthoringContext.Provider value={authoring}>
                {SECTIONS.filter((key) => visitedCategories.has(key)).map((category) => (
                  <div
                    key={category}
                    className="space-y-3"
                    hidden={
                      section !== category || (!included.has(category) && category !== 'sources')
                    }
                  >
                    {draft[category].map((row) => (
                      <div key={row.id} className="rounded-box border border-base-300 p-3">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm h-auto min-h-8 max-w-full break-words text-left"
                            aria-expanded={openId === row.id}
                            onClick={() => {
                              setOpenId(openId === row.id ? null : row.id);
                              setVisitedEntries((previous) => new Set([...previous, row.id]));
                            }}
                          >
                            {String(row.name || `New ${libraryEditorNouns[category]}`)}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            aria-label={`Remove ${String(row.name || libraryEditorNouns[category])} from package`}
                            onClick={() => {
                              changeDraft({
                                ...draft,
                                [category]: draft[category].filter((entry) => entry.id !== row.id),
                              });
                              setInvalidEntries((previous) => {
                                const next = new Set(previous);
                                next.delete(row.id);
                                return next;
                              });
                              setVisitedEntries((previous) => {
                                const next = new Set(previous);
                                next.delete(row.id);
                                return next;
                              });
                              if (openId === row.id) setOpenId(null);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                        {visitedEntries.has(row.id) && (
                          <div hidden={openId !== row.id} className="mt-3 min-w-0">
                            <LibraryEntryFields
                              key={editorRevision}
                              section={category}
                              value={packageEntryBody(category, row)}
                              onValidityChange={(valid) =>
                                setInvalidEntries((previous) => {
                                  if (previous.has(row.id) === !valid) return previous;
                                  const next = new Set(previous);
                                  if (valid) next.delete(row.id);
                                  else next.add(row.id);
                                  return next;
                                })
                              }
                              onChange={(next) =>
                                changeDraft({
                                  ...draft,
                                  [category]: draft[category].map((entry) =>
                                    entry.id === row.id ? { ...next, id: row.id } : entry,
                                  ),
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const id = newClientId();
                        const row = {
                          ...(seedSchema(libraryEditorSchemas[category]) as Record<
                            string,
                            unknown
                          >),
                          id,
                          ...(category !== 'sources' && sourceIds?.length === 1
                            ? { sourceId: sourceIds[0] }
                            : {}),
                        };
                        changeDraft({ ...draft, [category]: [...draft[category], row] });
                        setVisitedEntries((previous) => new Set([...previous, id]));
                        setOpenId(id);
                      }}
                    >
                      Add {libraryEditorNouns[category]} to package
                    </button>
                  </div>
                ))}
              </LibraryAuthoringContext.Provider>
            </SourcebooksContext.Provider>
            {mode === 'replace' && (
              <p className="text-sm text-warning">
                Removing an entry here removes it from the selected library scope when you apply
                this package.
              </p>
            )}
          </fieldset>
          <details className="min-w-0 text-sm">
            <summary className="cursor-pointer text-base-content/60">Raw YAML</summary>
            <label className="form-control mt-3 min-w-0">
              Package YAML
              <textarea
                className="textarea w-full min-w-0 font-mono text-xs"
                rows={16}
                spellCheck={false}
                readOnly={invalidEntries.size > 0}
                value={rawDraft ?? generated.yaml}
                onChange={(event) => readRaw(event.target.value)}
              />
            </label>
            {invalidEntries.size > 0 && (
              <p className="mt-2 break-words text-sm text-warning">
                Correct invalid fields before editing YAML: {invalidEntryLabels.join('; ')}.
              </p>
            )}
            {rawError && (
              <p role="alert" className="mt-2 break-words text-error">
                {rawError} Correct the YAML to continue editing the package.
              </p>
            )}
          </details>
          {(error || validationMessage) && (
            <p role="alert" className="break-words text-error">
              {error ?? validationMessage}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel package
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={rawError !== null || (!!generated.error && rawDraft === null)}
              onClick={review}
            >
              Review package
            </button>
          </div>
        </fieldset>
      </div>
    </section>
  );
}
