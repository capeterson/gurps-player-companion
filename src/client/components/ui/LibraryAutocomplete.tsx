/**
 * Roll-our-own combobox for picking library entries.
 *
 * Behavior:
 * - Debounces the query, fetches suggestions, opens a dropdown.
 * - ↑/↓ navigate, Enter picks the highlighted option, Esc closes.
 * - Click-outside closes the dropdown.
 * - Free-text submission (Enter without highlight) is allowed via the
 *   parent's `onSubmit` — this component only calls `onPick` when an
 *   option is actively selected.
 *
 * Mirrors the legacy gurps-player-web `LibraryAutocomplete`. The
 * generic `T` is the option type (a library trait, skill, or item).
 */

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

interface Props<T> {
  /** Current text value of the input. */
  value: string;
  /** Called whenever the user types. */
  onChange: (v: string) => void;
  /** Called when the user picks a library entry from the dropdown. */
  onPick: (option: T) => void;
  /** Called to fetch suggestions for the current query. */
  fetchOptions: (query: string) => Promise<T[]>;
  /** Render one option in the dropdown list. */
  renderOption: (option: T, highlighted: boolean) => ReactNode;
  /** Stable key for an option (used as React key). */
  getOptionKey: (option: T) => string;
  /** Min characters before fetching. Default 1. */
  minChars?: number;
  /** Debounce in milliseconds. Default 200. */
  debounceMs?: number;
  placeholder?: string;
  className?: string;
  /** Forwarded to the inner <input>. */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  /** Disable the input + dropdown. */
  disabled?: boolean;
  'aria-label'?: string;
}

export function LibraryAutocomplete<T>({
  value,
  onChange,
  onPick,
  fetchOptions,
  renderOption,
  getOptionKey,
  minChars = 1,
  debounceMs = 200,
  placeholder,
  className = '',
  inputProps,
  disabled,
  'aria-label': ariaLabel,
}: Props<T>) {
  const [options, setOptions] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounced fetch.  Each keystroke schedules a timer; the previous
  // timer is cleared so only the last keystroke's request fires.
  // `cancelled` guards against state writes from a stale query that
  // settles after the user kept typing.
  useEffect(() => {
    if (disabled) return;
    if (value.length < minChars) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchOptions(value)
        .then((opts) => {
          if (cancelled) return;
          setOptions(opts);
          setHighlight(0);
          setOpen(opts.length > 0);
        })
        .catch(() => {
          if (cancelled) return;
          setOptions([]);
          setOpen(false);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, minChars, debounceMs, fetchOptions, disabled]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current) return;
      if (e.target instanceof Node && containerRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const pick = useCallback(
    (opt: T) => {
      // Only `onPick` fires here. Calling `onChange` after `onPick` would
      // race with the caller's typical "clear pickedLibraryId on free-text
      // edit" handler — both run in the same React event, the clear wins,
      // and the parent ends up with the option value but no library FK
      // (and, for traits, no captured catalogue entry → modifier picker
      // disappears). The contract is now: parents that want the input to
      // reflect the pick must call their own `setName(opt.name)` inside
      // `onPick` (all current callers already do).
      onPick(opt);
      setOpen(false);
    },
    [onPick],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      if (options.length > 0) setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === 'Enter') {
      if (open && options[highlight]) {
        e.preventDefault();
        pick(options[highlight]);
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        {...inputProps}
        ref={inputRef}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? 'library-autocomplete-listbox' : undefined}
        aria-activedescendant={
          open && options[highlight]
            ? `library-autocomplete-opt-${getOptionKey(options[highlight])}`
            : undefined
        }
        autoComplete="off"
        type="text"
        className={`input input-bordered input-sm w-full ${inputProps?.className ?? ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (options.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
      {open && options.length > 0 && (
        /*
         * ARIA combobox/listbox idiom: the listbox lives outside the
         * input's keyboard tab order (tabIndex=-1) and is driven via
         * the input's onKeyDown above + aria-activedescendant.  Each
         * option is a real `<button>` so the click is a native
         * interaction — that gives us keyboard parity for free.
         *
         * `role="listbox"` and `role="option"` are exactly the ARIA
         * pattern for a combobox; biome's `useSemanticElements` rule
         * doesn't have a native HTML element it can suggest here, so
         * we suppress it inline rather than fight the spec.
         */
        <div
          id="library-autocomplete-listbox"
          // biome-ignore lint/a11y/useSemanticElements: ARIA listbox is the spec for combobox dropdowns; <select> doesn't support free-text input.
          role="listbox"
          tabIndex={-1}
          className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-auto rounded-md border border-base-300 bg-base-100 py-1 shadow-lg"
        >
          {options.map((opt, i) => {
            const highlighted = i === highlight;
            return (
              <button
                type="button"
                key={getOptionKey(opt)}
                id={`library-autocomplete-opt-${getOptionKey(opt)}`}
                // biome-ignore lint/a11y/useSemanticElements: ARIA option is the spec for listbox children; <button role="option"> is the standard combobox idiom.
                role="option"
                aria-selected={highlighted}
                className={`block w-full cursor-pointer text-left px-3 py-1.5 text-sm ${
                  highlighted ? 'bg-primary/10 text-base-content' : ''
                }`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  // mousedown not click, so the input doesn't lose focus
                  // and trigger an unrelated blur-handler before we pick.
                  e.preventDefault();
                  pick(opt);
                }}
              >
                {renderOption(opt, highlighted)}
              </button>
            );
          })}
        </div>
      )}
      {loading && options.length === 0 && value.length >= minChars && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-base-content/50">
          …
        </span>
      )}
    </div>
  );
}
