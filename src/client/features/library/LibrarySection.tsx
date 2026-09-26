/**
 * Generic list for one campaign-library section: a compact sortable table,
 * light category groups that fold, and rows that expand in place to show
 * the full entry. Built for libraries with hundreds of entries:
 *
 * - filtering, sorting and grouping run once per (entries, query, sort);
 * - rows are memoized and only the expanded row mounts its Markdown;
 * - collapsed groups render no rows at all (except an entry being edited,
 *   which stays mounted — hidden — so its draft survives).
 */
import {
  Fragment,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { LibraryEntityClass } from '../../../shared/schemas/sync.ts';
import { AppIcon } from '../../components/ui/AppIcon.tsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { DRAFT_FIELD_CLASS } from '../../hooks/useDraftField.ts';
import { useFieldFlash } from '../../hooks/useFieldFlash.ts';
import { useFlashState } from '../../hooks/useFlashState.ts';
import { makeFlashKey } from '../../sync/flashBus.ts';
import type { TablePreferences } from '../characters/sections/tablePreferences.ts';
import {
  SortableHeader,
  compareTableText,
} from '../characters/sections/useSortableCharacterRows.tsx';
import { matchesLibrarySearch } from './librarySearch.ts';
import {
  type LibrarySort,
  readLibraryTablePreferences,
  saveLibraryTablePreferences,
} from './libraryTablePreferences.ts';
import { useLibraryGroupFolds } from './useLibraryGroupFolds.ts';
import type { LibrarySectionKey } from './useLocalLibrary.ts';

export interface LibraryListRow {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null | undefined;
}

export interface LibraryColumn<R> {
  readonly sort: Exclude<LibrarySort, 'name'>;
  readonly label: string;
  readonly shortLabel?: string;
  /**
   * Width and alignment shared by the header and cells. For `hideOnMobile`
   * columns give `sm:`-prefixed widths: below `sm` the column collapses to
   * zero width (never `display:none`, which would desync the detail row's
   * colSpan from the visible column count).
   */
  readonly className: string;
  /** Below `sm` the value moves into the row's meta line instead. */
  readonly hideOnMobile?: boolean;
  readonly compare: (a: R, b: R) => number;
  readonly cell: (row: R) => ReactNode;
}

export interface LibrarySectionConfig<R extends LibraryListRow> {
  readonly key: LibrarySectionKey;
  readonly entityClass: LibraryEntityClass;
  readonly noun: string;
  readonly plural: string;
  readonly columns: readonly LibraryColumn<R>[];
  readonly group: (row: R) => string;
  /** Known group order; unknown groups follow alphabetically. */
  readonly groupOrder?: readonly string[];
  /** One-line summary: shown under the name on phones and atop the details. */
  readonly meta: (row: R) => string;
  readonly detail: (row: R) => ReactNode;
  readonly deleteTitle: string;
  readonly deleteNote: string;
}

export interface LibrarySectionProps<R extends LibraryListRow> {
  readonly config: LibrarySectionConfig<R>;
  readonly campaignId: string;
  readonly entries: readonly R[];
  /** Normalized, deferred search words. */
  readonly words: readonly string[];
  readonly active: boolean;
  readonly isOwner: boolean;
  readonly expandedId: string | null;
  readonly onToggleExpanded: (id: string) => void;
  readonly editId: string | null;
  readonly onEdit: (id: string) => void;
  readonly addOpen: boolean;
  readonly onAdd: () => void;
  /** The edit form for `row`, or the add form for `null`. */
  readonly renderForm: (row: R | null) => ReactNode;
  readonly onDeleteRequest: (id: string) => void;
  /** Slot in the sticky toolbar that receives this section's group jump links. */
  readonly jumpSlot: HTMLElement | null;
  /** A deep-linked entry to reveal once, then report through `onRevealed`. */
  readonly revealId: string | null;
  readonly onRevealed: () => void;
}

interface Group<R> {
  readonly label: string;
  readonly domId: string;
  readonly rows: R[];
}

/** Zero-width below `sm`; the column keeps its slot so colSpans stay aligned. */
const COLLAPSED_ON_MOBILE = 'w-0 overflow-hidden p-0 sm:px-2';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'group';
}

/** First line of a Markdown description as plain text, for the collapsed row. */
export function plainExcerpt(markdown: string | null | undefined): string {
  if (!markdown) return '';
  return markdown
    .slice(0, 300)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~#>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function usePreferences(
  campaignId: string,
  section: LibrarySectionKey,
  allowed: readonly string[],
) {
  const key = `${campaignId}:${section}`;
  const read = () => {
    const stored = readLibraryTablePreferences(key);
    return allowed.includes(stored.sort) ? stored : { ...stored, sort: 'name' as const };
  };
  const [state, setState] = useState(() => ({ key, preferences: read() }));
  const preferences = state.key === key ? state.preferences : read();
  const sortBy = useCallback(
    (sort: LibrarySort) => {
      const next: TablePreferences<LibrarySort> = {
        order: [],
        sort,
        descending: preferences.sort === sort ? !preferences.descending : false,
      };
      setState({ key, preferences: next });
      saveLibraryTablePreferences(key, next);
    },
    [key, preferences],
  );
  return { preferences, sortBy };
}

export function LibrarySection<R extends LibraryListRow>({
  config,
  campaignId,
  entries,
  words,
  active,
  isOwner,
  expandedId,
  onToggleExpanded,
  editId,
  onEdit,
  addOpen,
  onAdd,
  renderForm,
  onDeleteRequest,
  jumpSlot,
  revealId,
  onRevealed,
}: LibrarySectionProps<R>) {
  const allowedSorts = useMemo(
    () => ['name', ...config.columns.map((column) => column.sort)],
    [config.columns],
  );
  const { preferences, sortBy } = usePreferences(campaignId, config.key, allowedSorts);
  const folds = useLibraryGroupFolds(`${campaignId}:library:${config.key}`);
  const searching = words.length > 0;

  // Inactive sections keep only an entry being edited mounted (hidden), so a
  // draft survives switching categories without paying for the whole list.
  const { groups, matchCount } = useMemo(() => {
    const matching = active ? entries.filter((row) => matchesLibrarySearch(row, words)) : [];
    const visible =
      editId && !matching.some((row) => row.id === editId)
        ? [...matching, ...entries.filter((row) => row.id === editId)]
        : matching;
    const column = config.columns.find((candidate) => candidate.sort === preferences.sort);
    const direction = preferences.descending ? -1 : 1;
    const sorted = [...visible].sort(
      (a, b) =>
        direction * (column ? column.compare(a, b) : compareTableText(a.name, b.name)) ||
        compareTableText(a.name, b.name),
    );
    const byGroup = new Map<string, R[]>();
    for (const row of sorted) {
      const label = config.group(row);
      const bucket = byGroup.get(label);
      if (bucket) bucket.push(row);
      else byGroup.set(label, [row]);
    }
    const rank = (label: string) => {
      const index = config.groupOrder?.indexOf(label) ?? -1;
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    const ordered: Group<R>[] = [...byGroup.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || compareTableText(a, b))
      .map(([label, rows]) => ({
        label,
        rows,
        domId: `library-group-${config.key}-${slug(label)}`,
      }));
    return { groups: ordered, matchCount: matching.length };
  }, [active, entries, words, editId, config, preferences]);

  const colSpan = 1 + config.columns.length + (isOwner ? 1 : 0);

  // Reveal a deep-linked entry once its section is showing.
  useEffect(() => {
    if (!active || !revealId) return;
    const row = entries.find((entry) => entry.id === revealId);
    if (!row) return;
    folds.open(config.group(row));
    requestAnimationFrame(() => {
      document.getElementById(`library-entry-${revealId}`)?.scrollIntoView({ block: 'start' });
      onRevealed();
    });
  }, [active, revealId, entries, config, folds, onRevealed]);

  const jumpTo = useCallback(
    (group: Group<R>) => {
      folds.open(group.label);
      requestAnimationFrame(() =>
        document.getElementById(group.domId)?.scrollIntoView({ block: 'start' }),
      );
    },
    [folds],
  );

  const createFlash = useFieldFlash(makeFlashKey(config.entityClass, campaignId, 'create'));

  return (
    <div hidden={!active} className="space-y-3">
      {active && jumpSlot && groups.length > 1
        ? createPortal(
            <nav aria-label={`Jump to ${config.noun} group`} className="library-jump-strip">
              {groups.map((group) => (
                <button
                  key={group.domId}
                  type="button"
                  className="btn btn-ghost btn-xs shrink-0 whitespace-nowrap font-normal"
                  onClick={() => jumpTo(group)}
                >
                  {group.label} <span className="num text-dim">{group.rows.length}</span>
                </button>
              ))}
            </nav>,
            jumpSlot,
          )
        : null}

      {active && (
        <output className="block text-xs text-muted">
          {matchCount} of {entries.length} {config.plural}
          {searching ? ' match' : ''}. {searching && 'Entries being edited stay visible.'}
        </output>
      )}
      {active && entries.length > 0 && searching && matchCount === 0 && (
        <p className="text-sm text-muted">No matches. Try another search or category.</p>
      )}

      {groups.length > 0 && (
        <div className="card overflow-hidden p-0">
          <table className="table table-sm w-full table-fixed" aria-label={config.plural}>
            <caption className="sr-only">
              Campaign library {config.plural}, grouped. Sort with the column headings; open an
              entry to read it.
            </caption>
            <thead>
              <tr>
                <SortableHeader<LibrarySort>
                  label={config.noun[0]?.toUpperCase() + config.noun.slice(1)}
                  sort="name"
                  preferences={preferences}
                  onSort={sortBy}
                />
                {config.columns.map((column) => (
                  <SortableHeader<LibrarySort>
                    key={column.sort}
                    label={column.label}
                    sort={column.sort}
                    preferences={preferences}
                    onSort={sortBy}
                    headerClassName={`${column.className}${column.hideOnMobile ? ` ${COLLAPSED_ON_MOBILE}` : ''}`}
                    hideButtonOnMobile={column.hideOnMobile ?? false}
                    {...(column.shortLabel ? { shortLabel: column.shortLabel } : {})}
                  />
                ))}
                {isOwner && (
                  <th scope="col" className="w-16 px-1 sm:w-20">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            {groups.map((group) => {
              const open = searching || folds.isOpen(group.label);
              return (
                <Fragment key={group.domId}>
                  <tbody>
                    <tr>
                      <th
                        id={group.domId}
                        scope="colgroup"
                        colSpan={colSpan}
                        className="library-group-heading"
                      >
                        {searching ? (
                          <span className="flex items-center gap-2 px-1 py-1">
                            <span className="label-eyebrow">{group.label}</span>{' '}
                            <span className="num text-xs text-dim">{group.rows.length}</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-1 py-1 text-left"
                            aria-expanded={open}
                            onClick={() => folds.toggle(group.label)}
                          >
                            <AppIcon
                              name={open ? 'chevronDown' : 'chevronRight'}
                              size={14}
                              className="text-muted"
                            />
                            <span className="label-eyebrow">{group.label}</span>{' '}
                            <span className="num text-xs text-dim">{group.rows.length}</span>
                          </button>
                        )}
                      </th>
                    </tr>
                  </tbody>
                  {group.rows.map((row) =>
                    open || row.id === editId ? (
                      <LibraryRow
                        key={row.id}
                        row={row}
                        config={config}
                        colSpan={colSpan}
                        hidden={!open}
                        expanded={expandedId === row.id}
                        editing={editId === row.id}
                        isOwner={isOwner}
                        onToggle={onToggleExpanded}
                        onEdit={onEdit}
                        onDelete={onDeleteRequest}
                        form={editId === row.id ? renderForm(row) : undefined}
                      />
                    ) : null,
                  )}
                </Fragment>
              );
            })}
          </table>
        </div>
      )}

      {isOwner && addOpen && renderForm(null)}
      {active && entries.length === 0 && !addOpen && (
        <p className="text-center text-muted">No {config.plural} in the library yet.</p>
      )}
      {active && isOwner && !addOpen && (
        <button
          type="button"
          className={`btn btn-ghost btn-sm self-start ${DRAFT_FIELD_CLASS}`}
          data-flashing={createFlash['data-flashing']}
          data-flash-parity={createFlash['data-flash-parity']}
          onClick={onAdd}
        >
          + Add {config.noun}
        </button>
      )}
    </div>
  );
}

interface LibraryRowProps<R extends LibraryListRow> {
  readonly row: R;
  readonly config: LibrarySectionConfig<R>;
  readonly colSpan: number;
  readonly hidden: boolean;
  readonly expanded: boolean;
  readonly editing: boolean;
  readonly isOwner: boolean;
  readonly onToggle: (id: string) => void;
  readonly onEdit: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly form: ReactNode;
}

function LibraryRowImpl<R extends LibraryListRow>({
  row,
  config,
  colSpan,
  hidden,
  expanded,
  editing,
  isOwner,
  onToggle,
  onEdit,
  onDelete,
  form,
}: LibraryRowProps<R>) {
  const detailId = useId();
  // Any rejected edit or delete of this entry pulses its name cell (S5).
  const { flashProps } = useFlashState(undefined, undefined, `${config.entityClass}:${row.id}:`);
  const meta = config.meta(row);
  const excerpt = expanded || editing ? '' : plainExcerpt(row.description);
  return (
    <tbody hidden={hidden}>
      <tr
        id={`library-entry-${row.id}`}
        className={`library-entry-row${expanded || editing ? ' bg-primary/5' : ''}`}
      >
        <td className={`min-w-0 py-1.5 pr-1 pl-2 ${DRAFT_FIELD_CLASS}`} {...flashProps}>
          <button
            type="button"
            className="flex w-full min-w-0 items-start gap-1 text-left"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => onToggle(row.id)}
          >
            <AppIcon
              name={expanded ? 'chevronDown' : 'chevronRight'}
              size={14}
              className="mt-1 text-muted"
            />
            <span className="min-w-0 break-words font-medium">{row.name}</span>
          </button>
          {meta && (
            <span className="block pl-5 text-[10px] uppercase tracking-wider text-base-content/60 sm:hidden">
              {meta}
            </span>
          )}
          {excerpt && (
            <span className="block truncate pl-5 text-xs text-base-content/60">{excerpt}</span>
          )}
        </td>
        {config.columns.map((column) => (
          <td
            key={column.sort}
            className={`num whitespace-nowrap text-xs text-base-content/70 ${column.className}${column.hideOnMobile ? ` ${COLLAPSED_ON_MOBILE}` : ''}`}
          >
            {column.hideOnMobile ? (
              <span className="hidden sm:inline">{column.cell(row)}</span>
            ) : (
              column.cell(row)
            )}
          </td>
        ))}
        {isOwner && (
          <td className="w-16 px-1 sm:w-20">
            <div className="flex justify-end gap-0.5">
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square"
                aria-label={`Edit ${row.name}`}
                onClick={() => onEdit(row.id)}
              >
                <AppIcon name="edit" size={14} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square text-error"
                aria-label={`Delete ${row.name}`}
                onClick={() => onDelete(row.id)}
              >
                <AppIcon name="trash" size={14} />
              </button>
            </div>
          </td>
        )}
      </tr>
      {(expanded || editing) && (
        <tr>
          <td
            id={detailId}
            colSpan={colSpan}
            className="border-b border-base-300 bg-base-200 px-3 py-3 sm:px-5"
          >
            {editing ? (
              form
            ) : (
              <div className="space-y-1">
                {meta && (
                  <p className="hidden text-xs uppercase tracking-widest text-dim sm:block">
                    {meta}
                  </p>
                )}
                {config.detail(row)}
              </div>
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}

const LibraryRow = memo(LibraryRowImpl) as typeof LibraryRowImpl;

/** Delete confirmation for one section, worded by its config. */
export function LibraryDeleteDialog({
  open,
  title,
  name,
  note,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  name: string | undefined;
  note: string;
  pending: boolean;
  error: Error | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      confirmLabel="Delete"
      tone="error"
      pending={pending}
      pendingLabel="Deleting…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      Delete <strong>{name}</strong> from the library? {note}
      {error && (
        <p role="alert" className="text-error">
          {error.message}
        </p>
      )}
    </ConfirmDialog>
  );
}
