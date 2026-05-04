/**
 * useDraftField — the canonical draft-on-blur input pattern for the app.
 *
 * Per AGENTS.md (interaction design rules 1 + 2):
 *
 *   1. User edits are never silently discarded.  While a save is
 *      in flight for field X, additional commits to X queue (latest
 *      wins) and fire when the in-flight save settles.  Different
 *      fields run independently — each useDraftField instance is its
 *      own state machine, so saves on different fields parallelise
 *      naturally.
 *   2. A rollback (server reject, parse error, validation error) is a
 *      UX event.  The hook fires a toast that names the field and the
 *      reason, and toggles the `data-flashing` attribute so the input
 *      pulses via the `field-rollback-flash` keyframe in theme.css.
 *
 * The hook works in terms of a typed value `V`.  The DOM-facing draft
 * is always a string; `parse` converts string → V at commit time and
 * `format` converts V → string when syncing from the server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToasts } from '../lib/toast.tsx';

export interface UseDraftFieldOptions<V> {
  /** Human-readable field name used in toast messages, e.g. "ST". */
  readonly name: string;
  /** Authoritative server value.  Synced into the draft when the field is clean. */
  readonly serverValue: V;
  /** Convert the input string into the typed value.  Throw to indicate a parse error. */
  readonly parse?: (raw: string) => V;
  /** Render the typed value as the input's display string. */
  readonly format?: (v: V) => string;
  /** Equality check used to detect no-op commits and "still synced" states. */
  readonly equals?: (a: V, b: V) => boolean;
  /** Optional client-side validation.  Return an error message string, or null if valid. */
  readonly validate?: ((v: V) => string | null) | undefined;
  /** Persist the value.  Resolve on success, reject on failure (rollback fires). */
  readonly onSave: (v: V) => Promise<unknown>;
  /** Map an unknown rejection into a user-facing message.  Defaults to the Error message. */
  readonly onError?: (err: unknown) => string;
}

/**
 * Class name to apply to inputs driven by useDraftField — it wires the
 * `data-flashing` keyframe in `theme.css`.  The hook does NOT include
 * this in `inputProps` because consumers always need to compose it
 * with their own utilities (`input input-bordered …`).
 */
export const DRAFT_FIELD_CLASS = 'field-rollback-flash';

export interface UseDraftFieldReturn {
  /** The current draft string — bind to <input value=...>. */
  readonly value: string;
  /** Set the draft.  Marks the field dirty. */
  readonly setValue: (raw: string) => void;
  /** Commit the draft.  Typically called from onBlur. */
  readonly commit: () => void;
  /** True while a save is in flight (or a queued follow-up is pending). */
  readonly isSaving: boolean;
  /** Last error message produced by parse/validate/save.  Cleared on next setValue. */
  readonly error: string | null;
  /** Whether the rollback flash is currently animating. */
  readonly flashing: boolean;
  /**
   * Convenience props to spread onto a controlled <input>.  Does NOT
   * include className — apply DRAFT_FIELD_CLASS yourself, composed with
   * your own utilities.
   */
  readonly inputProps: {
    readonly value: string;
    readonly onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    readonly onBlur: () => void;
    readonly 'data-flashing': 'true' | 'false';
    readonly 'data-flash-parity': '0' | '1';
  };
}

const FLASH_MS = 1400;

function defaultOnError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'save failed';
}

export function useDraftField<V>(opts: UseDraftFieldOptions<V>): UseDraftFieldReturn {
  const {
    name,
    serverValue,
    parse = (s) => s as unknown as V,
    format = (v) => String(v),
    equals = Object.is,
    validate,
    onSave,
    onError = defaultOnError,
  } = opts;

  const toasts = useToasts();
  const [draft, setDraft] = useState(() => format(serverValue));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashParity, setFlashParity] = useState<'0' | '1'>('0');
  const [flashing, setFlashing] = useState(false);

  // Refs mirror state so the long-lived performSave closure sees current values.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const serverValueRef = useRef(serverValue);
  serverValueRef.current = serverValue;
  const dirtyRef = useRef(false);
  // `null` here means "no save in flight / nothing queued".  We wrap the
  // value in `{ value }` so the outer null check is unambiguous even
  // when `V` itself includes null (e.g. a nullable text field whose
  // empty draft saves as null).  Comparing the *reference* against
  // null can never confuse `null` with a legitimate null payload.
  const inflightRef = useRef<{ value: V } | null>(null);
  const queuedRef = useRef<{ value: V } | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Cache the option callbacks in refs so identity changes between renders
  // don't accidentally restart in-flight saves or stale-close on closures.
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const formatRef = useRef(format);
  formatRef.current = format;
  const equalsRef = useRef(equals);
  equalsRef.current = equals;
  const validateRef = useRef(validate);
  validateRef.current = validate;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const nameRef = useRef(name);
  nameRef.current = name;

  // Sync from the server ONLY when the field is clean and no save is in
  // flight.  Per AGENTS.md, we never wholesale-sync over a user's local
  // edit.
  useEffect(() => {
    if (dirtyRef.current) return;
    if (inflightRef.current !== null) return;
    const formatted = formatRef.current(serverValue);
    setDraft(formatted);
    draftRef.current = formatted;
  }, [serverValue]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const flashRollback = useCallback(() => {
    setFlashing(true);
    setFlashParity((p) => (p === '0' ? '1' : '0'));
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) setFlashing(false);
    }, FLASH_MS);
  }, []);

  /**
   * Used for parse / validate failures only — these never start an
   * onSave call, so they don't interact with the inflight/queue state
   * machine.  `performSave`'s server-rejection branch handles its own
   * toast + flash + draft revert because it has to reason about the
   * queue too.
   */
  const rollback = useCallback(
    (msg: string) => {
      const formatted = formatRef.current(serverValueRef.current);
      setDraft(formatted);
      draftRef.current = formatted;
      dirtyRef.current = false;
      setError(msg);
      flashRollback();
      toasts.push(`Couldn't save ${nameRef.current} — ${msg}`, { kind: 'error' });
    },
    [flashRollback, toasts],
  );

  const performSave = useCallback(
    async (value: V): Promise<void> => {
      inflightRef.current = { value };
      setIsSaving(true);
      let succeeded = false;
      try {
        await onSaveRef.current(value);
        succeeded = true;
      } catch (err) {
        const msg = onErrorRef.current(err);
        setError(msg);
        flashRollback();
        toasts.push(`Couldn't save ${nameRef.current} — ${msg}`, { kind: 'error' });
      }
      inflightRef.current = null;

      // The queue holds the user's most recent commit on this field — they
      // typed it AFTER `value`, so it's their freshest intent and per
      // AGENTS.md ("fire when the in-flight save settles") it must run
      // regardless of whether THIS save succeeded or failed.  Dropping the
      // queue on failure would silently lose that newer edit.
      const queued = queuedRef.current;
      if (queued !== null) {
        queuedRef.current = null;
        if (!succeeded) {
          // The failed save left draft on the rejected value.  Move it
          // to the queued value so the input shows the user's later
          // edit while the replay save runs.  The flash already fired
          // for the failure; we don't re-flash on the carry-over.
          const formatted = formatRef.current(queued.value);
          setDraft(formatted);
          draftRef.current = formatted;
        }
        await performSave(queued.value);
        return;
      }

      if (succeeded) {
        // No queue, save succeeded: if the live draft still matches the
        // value we just saved, mark clean so future server syncs can
        // update us.
        try {
          const parsedDraft = parseRef.current(draftRef.current);
          if (equalsRef.current(parsedDraft, value)) {
            dirtyRef.current = false;
            setError(null);
          }
        } catch {
          /* user is mid-edit with an unparsable draft — keep dirty */
        }
      } else {
        // No queue, save failed: revert draft to the last-known server
        // value so we don't strand the input on the rejected text.
        const formatted = formatRef.current(serverValueRef.current);
        setDraft(formatted);
        draftRef.current = formatted;
        dirtyRef.current = false;
      }

      if (isMountedRef.current) setIsSaving(false);
    },
    [flashRollback, toasts],
  );

  const setValue = useCallback((raw: string) => {
    setDraft(raw);
    draftRef.current = raw;
    dirtyRef.current = true;
    setError(null);
  }, []);

  const commit = useCallback(() => {
    if (!dirtyRef.current) return;

    let parsed: V;
    try {
      parsed = parseRef.current(draftRef.current);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'invalid input';
      rollback(msg);
      return;
    }

    if (validateRef.current) {
      const verr = validateRef.current(parsed);
      if (verr) {
        rollback(verr);
        return;
      }
    }

    if (equalsRef.current(parsed, serverValueRef.current) && inflightRef.current === null) {
      // No-op: the typed value already matches the server.
      dirtyRef.current = false;
      setError(null);
      return;
    }

    if (inflightRef.current !== null) {
      // Queue the latest value for after the current save settles.
      // Wrapping in `{ value }` keeps the null-vs-not-null check on
      // queuedRef unambiguous when V itself includes null.
      queuedRef.current = { value: parsed };
      return;
    }

    void performSave(parsed);
  }, [performSave, rollback]);

  return {
    value: draft,
    setValue,
    commit,
    isSaving,
    error,
    flashing,
    inputProps: {
      value: draft,
      onChange: (e) => setValue(e.target.value),
      onBlur: commit,
      'data-flashing': flashing ? 'true' : 'false',
      'data-flash-parity': flashParity,
    },
  };
}
