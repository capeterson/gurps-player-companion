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

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useToasts } from '../lib/toast.tsx';
import { tokenStore } from '../lib/tokenStore.ts';
import { useFlashState } from './useFlashState.ts';

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
  /** Local writers compare with current storage inside their transaction.
   * Never suppress a deliberate commit using a potentially delayed prop. */
  readonly persistOnCommit?: boolean;
  /**
   * Local writers that already serialize in storage can enqueue at commit time.
   * Every settlement is still processed in order to retain rollback baselines.
   * This lets relative gestures observe even a second queued input edit.
   * Never enable for an HTTP save that does not itself serialize writes.
   */
  readonly enqueueOnCommit?: {
    /** Read the durable rollback value, including other inputs' successful edits. */
    readCommitted: () => Promise<V>;
  };
  /** Map an unknown rejection into a user-facing message.  Defaults to the Error message. */
  readonly onError?: (err: unknown) => string;
  /**
   * When provided, the hook subscribes to the flash bus on this key and
   * triggers the rollback animation if an async event arrives.  Used
   * by the offline-first outbox: server rejections happen long after
   * `onSave` has resolved (the enqueue completed instantly), so the
   * orchestrator emits a flash event keyed by
   * `${entityClass}:${entityId}:${fieldPath}` that rolls the input
   * back to the latest authoritative value.
   *
   * The orchestrator also pushes a persistent toast naming the field;
   * the flash bus only handles the *visual* part of AGENTS.md rule 2.
   */
  readonly flashKey?: string;
  /** Identity of this draft when several inputs share one rollback flash key. */
  readonly scopeKey?: string;
  /** Read the reconciled local value after an outbox rejection. A live-query
   * prop can miss an optimistic write immediately followed by its rollback. */
  readonly readRollbackValue?: () => Promise<V>;
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

function defaultOnError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'save failed';
}

export function useDraftField<V>(opts: UseDraftFieldOptions<V>): UseDraftFieldReturn {
  const options = useRef(opts);
  options.current = opts;
  const toasts = useToasts();
  const [draft, setDraft] = useState(() => (opts.format ?? String)(opts.serverValue));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const dirty = useRef(false);
  const editVersion = useRef(0);
  // Knowledge advances independently of the text the user is still editing.
  // Unknown is distinct from a legitimate null/undefined field value.
  const committed = useRef<{ value: V } | null>({ value: opts.serverValue });
  const knowledgeVersion = useRef(0);
  const readVersion = useRef(0);
  const mounted = useRef(true);
  type Outcome = { ok: true } | { ok: false; error: unknown };
  type Scope = {
    key: string | undefined;
    sessionId: string | undefined;
    inflight: Attempt | null;
    queued: Attempt | null;
    localQueue: Attempt[];
    rollbackPending: boolean;
  };
  type Attempt = {
    value: V;
    editVersion: number;
    save: (value: V) => Promise<unknown>;
    read: (() => Promise<V>) | undefined;
    scope: Scope;
    name: string;
    onError: (error: unknown) => string;
    storageMode: boolean;
    outcome?: Promise<Outcome>;
  };
  const sessionId = useSyncExternalStore(
    tokenStore.subscribe,
    () => tokenStore.read()?.sessionId,
    () => undefined,
  );
  const newScope = useCallback(
    (key: string | undefined): Scope => ({
      key,
      sessionId: tokenStore.read()?.sessionId,
      inflight: null,
      queued: null,
      localQueue: [],
      rollbackPending: false,
    }),
    [],
  );
  const draftScopeKey = opts.scopeKey ?? opts.flashKey;
  const scope = useRef<Scope>(newScope(draftScopeKey));
  const inScope = useCallback(
    (origin: Scope) =>
      mounted.current &&
      scope.current === origin &&
      (options.current.scopeKey ?? options.current.flashKey) === origin.key &&
      tokenStore.read()?.sessionId === origin.sessionId,
    [],
  );

  const show = useCallback((value: V) => {
    const formatted = (options.current.format ?? String)(value);
    draftRef.current = formatted;
    setDraft(formatted);
  }, []);
  const reader = useCallback(
    () => options.current.readRollbackValue ?? options.current.enqueueOnCommit?.readCommitted,
    [],
  );
  const storageMode = Boolean(opts.persistOnCommit || opts.enqueueOnCommit);

  // Reads may complete after a newer prop, save, rejection, or context switch.
  // Only the newest observation can establish knowledge; raw edits stay separate.
  const refresh = async (read: () => Promise<V>, replace: boolean, origin = scope.current) => {
    const request = ++readVersion.current;
    const knowledge = knowledgeVersion.current;
    const edit = editVersion.current;
    try {
      const value = await read();
      if (
        !inScope(origin) ||
        request !== readVersion.current ||
        knowledge !== knowledgeVersion.current
      )
        return;
      committed.current = { value };
      knowledgeVersion.current++;
      if (replace && edit === editVersion.current && !dirty.current && !scope.current.inflight)
        show(value);
    } catch (err) {
      if (
        !inScope(origin) ||
        request !== readVersion.current ||
        knowledge !== knowledgeVersion.current
      )
        return;
      committed.current = null;
      if (edit === editVersion.current && !scope.current.inflight) dirty.current = true;
      // An unreadable store cannot prove the old text is already saved.
      toasts.push(
        `Couldn't refresh ${options.current.name} — ${(options.current.onError ?? defaultOnError)(err)}`,
        {
          kind: 'error',
        },
      );
    }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (scope.current.key !== draftScopeKey || scope.current.sessionId !== sessionId) {
      scope.current = newScope(draftScopeKey);
      dirty.current = false;
      editVersion.current++;
      committed.current = { value: opts.serverValue };
      knowledgeVersion.current++;
      show(opts.serverValue);
      setIsSaving(false);
      setError(null);
    }
    const read = reader();
    if (storageMode && read) {
      void refreshRef.current(read, true);
    } else if (!scope.current.inflight) {
      committed.current = { value: opts.serverValue };
      knowledgeVersion.current++;
      if (!dirty.current) show(opts.serverValue);
    }
  }, [opts.serverValue, draftScopeKey, storageMode, reader, show, sessionId, newScope]);

  const {
    flashing,
    flashProps,
    trigger: flashRollback,
  } = useFlashState(opts.flashKey, () => {
    committed.current = null;
    knowledgeVersion.current++;
    const read = reader();
    if (read) {
      // A real server rejection can beat the local enqueue's continuation.
      // Do not let that continuation re-establish the rejected optimistic value.
      scope.current.rollbackPending = true;
      if (!scope.current.inflight) {
        scope.current.rollbackPending = false;
        void refreshRef.current(read, true);
      }
    } else if (!dirty.current && !scope.current.inflight) {
      committed.current = { value: options.current.serverValue };
      show(options.current.serverValue);
    }
  });

  const rollback = useCallback(
    (msg: string) => {
      setError(msg);
      flashRollback();
      toasts.push(`Couldn't save ${options.current.name} — ${msg}`, { kind: 'error' });
      const read =
        options.current.readRollbackValue ?? options.current.enqueueOnCommit?.readCommitted;
      if (read) {
        dirty.current = false;
        void refreshRef.current(read, true);
      } else if (committed.current) {
        dirty.current = false;
        const formatted = (options.current.format ?? String)(committed.current.value);
        draftRef.current = formatted;
        setDraft(formatted);
      }
    },
    [flashRollback, toasts],
  );

  const performSave = useCallback(
    async (attempt: Attempt): Promise<void> => {
      const owner = attempt.scope;
      const sessionActive = () => tokenStore.read()?.sessionId === owner.sessionId;
      const active = () => inScope(owner);
      // Committed follow-ups belong to their original scope even if the
      // component unmounts or starts showing another entity.
      if (!sessionActive()) return;
      owner.inflight = attempt;
      if (active()) {
        setIsSaving(true);
        readVersion.current++;
      }
      let outcome: Outcome;
      if (attempt.outcome) outcome = await attempt.outcome;
      else {
        try {
          await attempt.save(attempt.value);
          outcome = { ok: true };
        } catch (error) {
          outcome = { ok: false, error };
        }
      }
      if (!sessionActive()) return;
      if (active()) {
        knowledgeVersion.current++;
        if (outcome.ok) {
          if (!attempt.storageMode && !owner.rollbackPending)
            committed.current = { value: attempt.value };
        } else {
          const msg = attempt.onError(outcome.error);
          if (attempt.editVersion === editVersion.current) setError(msg);
          flashRollback();
        }
      }
      if (!outcome.ok) {
        toasts.push(`Couldn't save ${attempt.name} — ${attempt.onError(outcome.error)}`, {
          kind: 'error',
        });
      }
      // Drain with the original callbacks and scope, even after navigation.
      const next = owner.localQueue.shift() ?? owner.queued;
      owner.queued = null;
      if (next) {
        owner.inflight = null;
        await performSave(next);
        return;
      }
      owner.inflight = null;
      if (!active()) return;
      if (attempt.editVersion === editVersion.current) {
        if (outcome.ok) {
          dirty.current = false;
          setError(null);
        } else if (attempt.read) {
          // A failed reader must retain the raw draft for retry.
          // The refresh below clears it only if durable knowledge is available.
          dirty.current = false;
        } else if (committed.current) {
          const formatted = (options.current.format ?? String)(committed.current.value);
          draftRef.current = formatted;
          setDraft(formatted);
          dirty.current = false;
        }
      }
      const needsRead = attempt.storageMode || owner.rollbackPending || !outcome.ok;
      owner.rollbackPending = false;
      if (attempt.read && needsRead) await refreshRef.current(attempt.read, true, attempt.scope);
      if (!active()) return;
      // A new save may have started while the storage observation was pending.
      if (!scope.current.inflight) setIsSaving(false);
    },
    [flashRollback, toasts, inScope],
  );

  const setValue = useCallback((raw: string) => {
    editVersion.current++;
    draftRef.current = raw;
    setDraft(raw);
    dirty.current = true;
    setError(null);
  }, []);

  const commit = useCallback(() => {
    if (!dirty.current) return;
    const config = options.current;
    let value: V;
    try {
      value = config.parse ? config.parse(draftRef.current) : (draftRef.current as unknown as V);
      const message = config.validate?.(value);
      if (message) throw new Error(message);
    } catch (err) {
      rollback(err instanceof Error ? err.message : 'invalid input');
      return;
    }
    if (
      !config.persistOnCommit &&
      !config.enqueueOnCommit &&
      !config.readRollbackValue &&
      !scope.current.inflight &&
      committed.current &&
      (config.equals ?? Object.is)(value, committed.current.value)
    ) {
      dirty.current = false;
      setError(null);
      return;
    }
    const attempt: Attempt = {
      value,
      editVersion: editVersion.current,
      save: config.onSave,
      read: config.readRollbackValue ?? config.enqueueOnCommit?.readCommitted,
      scope: scope.current,
      name: config.name,
      onError: config.onError ?? defaultOnError,
      storageMode: Boolean(config.persistOnCommit || config.enqueueOnCommit),
    };
    if (tokenStore.read()?.sessionId !== attempt.scope.sessionId) return;
    if (config.enqueueOnCommit) {
      // Start storage transactions synchronously with the gesture, preserving
      // ordering with relative/pool updates from other hook instances.
      try {
        attempt.outcome = Promise.resolve(attempt.save(value)).then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      } catch (error) {
        attempt.outcome = Promise.resolve({ ok: false, error });
      }
      if (scope.current.inflight) scope.current.localQueue.push(attempt);
      else void performSave(attempt);
    } else if (scope.current.inflight) scope.current.queued = attempt;
    else void performSave(attempt);
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
      onChange: (event) => setValue(event.target.value),
      onBlur: commit,
      ...flashProps,
    },
  };
}
