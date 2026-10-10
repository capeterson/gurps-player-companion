/** Shared table filtering. Presentation preferences never enter the API/outbox. */
import {
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  VIEWPORT_OVERLAY_SHIFT_PROPERTY,
  horizontalViewportShift,
  useViewportBoundedOverlay,
} from '../../hooks/useViewportBoundedOverlay.ts';

export type TableValues = Readonly<Record<string, string | number | null | readonly string[]>>;
/** Inclusive numeric bounds; `null` leaves that end open so new extremes stay visible. */
export interface TableRangeFilter {
  min: number | null;
  max: number | null;
}
type ColumnFilter = string[] | TableRangeFilter;
type Filters = Record<string, ColumnFilter>;
const isRangeFilter = (filter: ColumnFilter): filter is TableRangeFilter => !Array.isArray(filter);
const isBound = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));
const PREFIX = 'gpc:table-filters:v1:';
const valuesFor = (value: TableValues[string] | undefined): readonly string[] =>
  Array.isArray(value) ? value : [value == null ? '—' : String(value)];

function readFilters(key: string): Filters {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PREFIX + key) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, ColumnFilter] => {
        const value: unknown = entry[1];
        if (Array.isArray(value)) {
          return value.length > 0 && value.every((item: unknown) => typeof item === 'string');
        }
        if (!value || typeof value !== 'object') return false;
        const { min, max } = value as Record<string, unknown>;
        return isBound(min) && isBound(max) && (min !== null || max !== null);
      }),
    );
  } catch {
    return {};
  }
}

export function clearAllTableFilters() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {}
}

interface TableState {
  enabled: boolean;
  filters: Filters;
  rows: readonly TableValues[];
  setColumnEnabled: (column: string, enabled: boolean) => void;
  register: (id: string, values: TableValues | null) => void;
  open: (key: string, label: string, trigger: HTMLElement, rangeStep?: number) => void;
}
const TableContext = createContext<TableState | null>(null);
const skipRegistration = () => {};

export interface TableProps extends ComponentProps<'table'> {
  /** Stable per-table/entity identity for device-only persistence. */
  preferenceKey: string;
  /** Filtering is on by default. */
  filterable?: boolean;
  /** Supply all source rows when search, pagination or folding limits mounted rows. */
  filterRows?: readonly TableValues[];
}

export function Table({ preferenceKey, ...props }: TableProps) {
  // Remount preference state if the owning character/campaign/table changes.
  return <TableImpl key={preferenceKey} preferenceKey={preferenceKey} {...props} />;
}

function TableImpl({
  preferenceKey,
  filterable = true,
  filterRows,
  children,
  ...props
}: TableProps) {
  const [filters, setFilters] = useState(() => readFilters(preferenceKey));
  const [registered, setRegistered] = useState<Record<string, TableValues>>({});
  const [menu, setMenu] = useState<{
    key: string;
    label: string;
    trigger: HTMLElement;
    rangeStep?: number;
  } | null>(null);
  const [disabledColumns, setDisabledColumns] = useState<readonly string[]>([]);
  const setColumnEnabled = useCallback((column: string, enabled: boolean) => {
    setDisabledColumns((current) => {
      if (enabled)
        return current.includes(column) ? current.filter((key) => key !== column) : current;
      return current.includes(column) ? current : [...current, column];
    });
  }, []);
  const effectiveFilters = Object.fromEntries(
    Object.entries(filters).filter(([key]) => !disabledColumns.includes(key)),
  );
  const [saveFailed, setSaveFailed] = useState(false);
  const register = useMemo(
    () => (id: string, values: TableValues | null) => {
      setRegistered((current) => {
        const next = { ...current };
        if (values) next[id] = values;
        else delete next[id];
        return next;
      });
    },
    [],
  );
  function save(next: Filters) {
    setFilters(next);
    try {
      localStorage.setItem(PREFIX + preferenceKey, JSON.stringify(next));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }
  const state: TableState = {
    enabled: filterable,
    filters: effectiveFilters,
    setColumnEnabled,
    rows: filterRows ?? Object.values(registered),
    register: filterRows ? skipRegistration : register,
    open: (key, label, trigger, rangeStep) =>
      setMenu({ key, label, trigger, ...(rangeStep ? { rangeStep } : {}) }),
  };
  const closeMenu = useCallback(() => {
    setMenu(null);
    menu?.trigger.focus();
  }, [menu]);
  const activeCount = filterable ? Object.keys(effectiveFilters).length : 0;
  return (
    <TableContext.Provider value={state}>
      {activeCount > 0 && (
        <output className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
          <span>
            {activeCount} column {activeCount === 1 ? 'filter' : 'filters'} active
          </span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => save({})}>
            Clear all filters
          </button>
        </output>
      )}
      {saveFailed && (
        <output className="block px-3 text-xs text-warning">
          This browser could not remember table filters. They will reset when you leave.
        </output>
      )}
      <table {...props}>{children}</table>
      {activeCount > 0 &&
        state.rows.length > 0 &&
        !state.rows.some((row) => rowMatchesFilters(row, effectiveFilters)) && (
          <output className="block px-3 py-4 text-sm text-base-content/60">
            No rows match the column filters.
          </output>
        )}
      {filterable && menu?.rangeStep && (
        <ColumnRangeMenu
          key={menu.key}
          label={menu.label}
          trigger={menu.trigger}
          step={menu.rangeStep}
          values={state.rows.flatMap((row) => numericValue(row[menu.key]) ?? [])}
          selected={rangeFilterFor(filters[menu.key])}
          onChange={(range) => {
            const next = { ...filters };
            if (range.min !== null || range.max !== null) next[menu.key] = range;
            else delete next[menu.key];
            save(next);
          }}
          onClose={closeMenu}
        />
      )}
      {filterable && menu && !menu.rangeStep && (
        <ColumnFilterMenu
          key={menu.key}
          label={menu.label}
          trigger={menu.trigger}
          values={[
            ...new Set([
              ...state.rows.flatMap((row) => valuesFor(row[menu.key])),
              ...valueFilterFor(filters[menu.key]),
            ]),
          ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))}
          selected={valueFilterFor(filters[menu.key])}
          onChange={(selected) => {
            const next = { ...filters };
            if (selected.length) next[menu.key] = selected;
            else delete next[menu.key];
            save(next);
          }}
          onClose={closeMenu}
        />
      )}
    </TableContext.Provider>
  );
}

/** Extend existing sort buttons; plain headers open filters on click as well. */
export function TableHeader({
  column,
  label,
  filterLabel = label,
  rangeStep,
  filterable = true,
  indicatorClassName = '',
  children,
  ...props
}: ComponentProps<'th'> & {
  column: string;
  label: string;
  /** Names what the filter selects when it differs from the heading, e.g. "Item type". */
  filterLabel?: string;
  /** Filter this numeric column with a range slider in steps of this size. */
  rangeStep?: number;
  filterable?: boolean;
  indicatorClassName?: string;
}) {
  const table = useContext(TableContext);
  const setEnabled = table?.setColumnEnabled;
  useLayoutEffect(() => {
    setEnabled?.(column, filterable);
    return () => setEnabled?.(column, true);
  }, [column, filterable, setEnabled]);
  const enabled = filterable && table?.enabled;
  const active = enabled && column in table.filters;
  const open = (element: HTMLElement) => {
    if (enabled) {
      table.open(column, filterLabel, element.querySelector('button') ?? element, rangeStep);
    }
  };
  return (
    <th
      {...props}
      className={`relative ${props.className ?? ''}`}
      scope="col"
      title={enabled ? 'Right-click, Alt-click or Shift+F10 to filter this column' : undefined}
      onContextMenu={(event) => {
        if (!enabled) return;
        event.preventDefault();
        open(event.currentTarget);
      }}
      onClickCapture={(event) => {
        if (enabled && event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          open(event.currentTarget);
        }
      }}
      onKeyDown={(event) => {
        if (enabled && ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu')) {
          event.preventDefault();
          open(event.currentTarget);
        }
      }}
    >
      {children ??
        (enabled ? (
          <button
            type="button"
            className="btn btn-ghost btn-xs h-auto min-h-0 px-1 py-1 font-semibold"
            onClick={(event) => open(event.currentTarget)}
          >
            {label}
          </button>
        ) : (
          label
        ))}
      {active && (
        <span
          className={`pointer-events-none absolute right-1 top-0 text-[8px] leading-none text-primary ${indicatorClassName}`}
          aria-label={`${label} filtered`}
        >
          {' '}
          ⏷
        </span>
      )}
    </th>
  );
}

export function useTableFiltersActive(): boolean {
  const table = useContext(TableContext);
  return Boolean(table?.enabled && Object.keys(table.filters).length);
}

/** Let hierarchical tables retain matching rows' ancestors without duplicating filters. */
export function useTableRowMatches(): (values: TableValues) => boolean {
  const table = useContext(TableContext);
  return (values) => !table?.enabled || rowMatchesFilters(values, table.filters);
}

/** Render grouped/folded source rows open while a column filter is active. */
export function TableFilterScope({ children }: { children: (filtering: boolean) => ReactNode }) {
  return children(useTableFiltersActive());
}

function rowMatchesFilters(values: TableValues, filters: Filters) {
  return Object.entries(filters).every(([key, filter]) => {
    if (!isRangeFilter(filter)) {
      return valuesFor(values[key]).some((value) => filter.includes(value));
    }
    const value = numericValue(values[key]);
    return (
      value !== null &&
      (filter.min === null || value >= filter.min) &&
      (filter.max === null || value <= filter.max)
    );
  });
}

function numericValue(value: TableValues[string] | undefined): number | null {
  if (value == null || Array.isArray(value) || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const valueFilterFor = (filter: ColumnFilter | undefined): string[] =>
  filter && !isRangeFilter(filter) ? filter : [];
const rangeFilterFor = (filter: ColumnFilter | undefined): TableRangeFilter =>
  filter && isRangeFilter(filter) ? filter : { min: null, max: null };

function useFilteredRow(values: TableValues | undefined) {
  const table = useContext(TableContext);
  const id = useId();
  const serialized = JSON.stringify(values);
  const register = table?.register;
  useLayoutEffect(() => {
    if (!register || !serialized) return;
    register(id, JSON.parse(serialized) as TableValues);
    return () => register(id, null);
  }, [register, id, serialized]);
  return Boolean(table?.enabled && values && !rowMatchesFilters(values, table.filters));
}

/** Group a summary with its editor/details so filtering preserves mounted drafts. */
export function TableBody({
  filterValues,
  hidden,
  ...props
}: ComponentProps<'tbody'> & {
  filterValues?: TableValues;
}) {
  const filtered = useFilteredRow(filterValues);
  return <tbody {...props} hidden={hidden || filtered} />;
}

export function TableRow({
  filterValues,
  hidden,
  ...props
}: ComponentProps<'tr'> & {
  filterValues?: TableValues;
}) {
  const filtered = useFilteredRow(filterValues);
  return <tr {...props} hidden={hidden || filtered} />;
}

/** Shared anchored dialog for column filters: viewport-bounded, focus-trapped, dismissible. */
function FilterDialog({
  label,
  trigger,
  onClose,
  children,
}: {
  label: string;
  trigger: HTMLElement;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useViewportBoundedOverlay<HTMLDialogElement>();
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    const position = () => {
      const element = ref.current;
      if (!element) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const box = trigger.getBoundingClientRect();
      element.style.left = `${box.left}px`;
      element.style.maxHeight = `${Math.max(0, height - 16)}px`;
      const currentShift =
        Number.parseFloat(element.style.getPropertyValue(VIEWPORT_OVERLAY_SHIFT_PROPERTY)) || 0;
      const shift = horizontalViewportShift(
        element.getBoundingClientRect(),
        { left: viewport?.offsetLeft ?? 0, width: viewport?.width ?? window.innerWidth },
        currentShift,
      );
      element.style.setProperty(VIEWPORT_OVERLAY_SHIFT_PROPERTY, `${shift}px`);
      element.style.top = `${Math.max(top + 8, Math.min(box.bottom, top + height - element.offsetHeight - 8))}px`;
    };
    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    if (ref.current) observer?.observe(ref.current);
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      observer?.disconnect();
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [trigger, ref, onClose]);
  return createPortal(
    <dialog
      open
      ref={ref}
      aria-label={`Filter ${label}`}
      className="dropdown-content fixed m-0 z-[100] flex w-72 max-w-[min(calc(100dvw-1rem),var(--viewport-overlay-available-width,calc(100dvw-1rem)))] max-h-[calc(100dvh-1rem)] flex-col gap-2 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-3 text-base-content shadow-xl"
      style={{
        left: trigger.getBoundingClientRect().left,
        transform: 'translateX(var(--viewport-overlay-shift-x, 0px))',
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
        if (event.key === 'Tab') {
          const controls = ref.current?.querySelectorAll<HTMLElement>('button, input');
          const first = controls?.[0];
          const last = controls?.[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <strong className="min-w-0 break-words">Filter {label}</strong>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={onClose}
          aria-label="Close filter"
        >
          ✕
        </button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}

function ColumnFilterMenu({
  label,
  trigger,
  values,
  selected,
  onChange,
  onClose,
}: {
  label: string;
  trigger: HTMLElement;
  values: readonly string[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const normalized = query.toLocaleLowerCase();
  return (
    <FilterDialog label={label} trigger={trigger} onClose={onClose}>
      <input
        type="search"
        className="input input-sm w-full shrink-0"
        aria-label={`Search ${label} values`}
        placeholder="Search values…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="text-xs text-base-content/60">
        {selected.length ? `${selected.length} selected` : 'All values shown'}
      </p>
      <button
        type="button"
        className="btn btn-ghost btn-xs self-start shrink-0"
        onClick={() => onChange([])}
      >
        Clear column filter
      </button>
      <div className="space-y-1">
        {values
          .filter((value) => value.toLocaleLowerCase().includes(normalized))
          .map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-2 rounded-field p-1 text-sm hover:bg-base-200"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-sm shrink-0"
                checked={selected.includes(value)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, value]
                      : selected.filter((item) => item !== value),
                  )
                }
              />
              <span className="min-w-0 break-words">{value === '' ? '(Blank)' : value}</span>
            </label>
          ))}
        {!values.some((value) => value.toLocaleLowerCase().includes(normalized)) && (
          <p className="text-sm">No matching values.</p>
        )}
      </div>
    </FilterDialog>
  );
}

/** Snap to the step grid without binary floating-point residue (0.1 + 0.2). */
function snap(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

const formatBound = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Two-thumb slider from zero to the column's current highest value, plus exact inputs. */
function ColumnRangeMenu({
  label,
  trigger,
  step,
  values,
  selected,
  onChange,
  onClose,
}: {
  label: string;
  trigger: HTMLElement;
  step: number;
  values: readonly number[];
  selected: TableRangeFilter;
  onChange: (range: TableRangeFilter) => void;
  onClose: () => void;
}) {
  const highest = Math.max(0, ...values, selected.min ?? 0, selected.max ?? 0);
  const top = Math.max(step, snap(Math.ceil(highest / step) * step, step));
  const low = Math.min(selected.min ?? 0, top);
  const high = Math.min(selected.max ?? top, top);
  const [lowDraft, setLowDraft] = useState<string | null>(null);
  const [highDraft, setHighDraft] = useState<string | null>(null);
  const apply = (nextLow: number, nextHigh: number) => {
    const [min, max] = nextLow <= nextHigh ? [nextLow, nextHigh] : [nextHigh, nextLow];
    // A thumb resting at either end leaves that side open, so a later
    // heavier/pricier item is not silently excluded.
    onChange({ min: min <= 0 ? null : min, max: max >= top ? null : max });
  };
  const commit = (draft: string | null, side: 'low' | 'high') => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(parsed)) {
      const bounded = Math.max(0, Math.min(parsed, top));
      if (side === 'low') apply(bounded, high);
      else apply(low, bounded);
    }
    if (side === 'low') setLowDraft(null);
    else setHighDraft(null);
  };
  const percent = (value: number) => `${(value / top) * 100}%`;
  const filtered = selected.min !== null || selected.max !== null;
  return (
    <FilterDialog label={label} trigger={trigger} onClose={onClose}>
      <p className="text-xs text-base-content/60">
        {filtered ? `${formatBound(low)} to ${formatBound(high)}` : 'All values shown'}
      </p>
      <button
        type="button"
        className="btn btn-ghost btn-xs self-start shrink-0"
        onClick={() => onChange({ min: null, max: null })}
      >
        Clear column filter
      </button>
      <div
        className="table-range-slider"
        style={
          {
            '--range-low': percent(low),
            '--range-high': percent(high),
          } as CSSProperties
        }
      >
        <input
          type="range"
          min={0}
          max={top}
          step={step}
          value={low}
          aria-label={`Minimum ${label}`}
          // Keep the low thumb reachable when both thumbs rest at the top.
          style={low >= top ? { zIndex: 2 } : undefined}
          onChange={(event) => apply(Math.min(Number(event.target.value), high), high)}
        />
        <input
          type="range"
          min={0}
          max={top}
          step={step}
          value={high}
          aria-label={`Maximum ${label}`}
          onChange={(event) => apply(low, Math.max(Number(event.target.value), low))}
        />
      </div>
      <div className="flex justify-between text-xs text-base-content/60 num">
        <span>0</span>
        <span>{formatBound(top)}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <input
          type="number"
          inputMode="decimal"
          className="input input-sm w-0 min-w-0 flex-1 num"
          min={0}
          max={top}
          step={step}
          aria-label={`Minimum ${label} value`}
          value={lowDraft ?? String(low)}
          onChange={(event) => setLowDraft(event.target.value)}
          onBlur={() => commit(lowDraft, 'low')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(lowDraft, 'low');
          }}
        />
        <span className="text-base-content/60">to</span>
        <input
          type="number"
          inputMode="decimal"
          className="input input-sm w-0 min-w-0 flex-1 num"
          min={0}
          max={top}
          step={step}
          aria-label={`Maximum ${label} value`}
          value={highDraft ?? String(high)}
          onChange={(event) => setHighDraft(event.target.value)}
          onBlur={() => commit(highDraft, 'high')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(highDraft, 'high');
          }}
        />
      </div>
    </FilterDialog>
  );
}

/** Extract labels only from declarative cell content, never mounted editor DOM. */
export function tableCellText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(tableCellText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return tableCellText((node.props as { children?: ReactNode }).children);
  }
  return '';
}
