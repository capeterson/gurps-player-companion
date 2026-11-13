/**
 * useDraftToggle — boolean-checkbox companion to `useDraftField`.
 *
 * Same AGENTS.md guarantees apply: rapid toggles must not be silently
 * discarded.  Each click flips local state and either fires the save
 * (if no save is in flight) or queues the latest value (latest wins).
 * When the in-flight save settles, the queue drains regardless of
 * success or failure.  On failure we toast and roll back the local
 * state to the last-known server value.
 *
 * The text-input version of this state machine lives in
 * `useDraftField.ts`; this is the smaller version for binary inputs
 * where parse / format / validate aren't needed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { beginPendingToggle } from '../lib/pendingToggles.ts';
import { useToasts } from '../lib/toast.tsx';
import { tokenStore } from '../lib/tokenStore.ts';
import { useFlashState } from './useFlashState.ts';

export interface UseDraftToggleOptions {
  readonly name: string;
  readonly serverValue: boolean;
  readonly onSave: (
    v: boolean,
    sessionId: string | null,
    isActive: () => boolean,
  ) => Promise<unknown>;
  readonly onError?: (err: unknown) => string;
  /** See useDraftField.flashKey -- async rollback subscription. */
  readonly flashKey?: string;
}

export interface UseDraftToggleReturn {
  readonly checked: boolean;
  readonly toggle: () => void;
  readonly isSaving: boolean;
  readonly sessionChanged: boolean;
  /** True while the rollback flash keyframe is animating. */
  readonly flashing: boolean;
  /**
   * Spread these onto the underlying `<input type="checkbox">` so the
   * shared `field-rollback-flash` keyframe in theme.css fires on
   * server / network rejection.  Apply DRAFT_FIELD_CLASS yourself.
   */
  readonly flashProps: {
    readonly 'data-flashing': 'true' | 'false';
    readonly 'data-flash-parity': '0' | '1';
  };
}

function defaultOnError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'save failed';
}

export function useDraftToggle(opts: UseDraftToggleOptions): UseDraftToggleReturn {
  const { name, serverValue, onSave, onError = defaultOnError, flashKey } = opts;
  const toasts = useToasts();
  const [checked, setChecked] = useState(serverValue);
  const [isSaving, setIsSaving] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const sessionRef = useRef(tokenStore.read()?.sessionId ?? null);
  const endPendingRef = useRef<ReturnType<typeof beginPendingToggle> | null>(null);

  // The most recently CONFIRMED authoritative value.  Updated by an
  // incoming server prop change OR a successful save.  Mirrors the
  // logic in useDraftField so a quick toggle-then-toggle-back doesn't
  // get short-circuited against a stale prop while a refetch is in
  // flight.
  const lastCommittedRef = useRef(serverValue);
  const inflightRef = useRef<{ value: boolean } | null>(null);
  const queuedRef = useRef<{ value: boolean } | null>(null);
  const isMountedRef = useRef(true);

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const nameRef = useRef(name);
  nameRef.current = name;

  // Sync from server when no save is in flight.  We don't need a
  // "dirty" flag the way the text version does because checkbox state
  // is fully determined by clicks — there's no half-typed value to
  // preserve.
  useEffect(() => {
    if (inflightRef.current !== null) return;
    lastCommittedRef.current = serverValue;
    setChecked(serverValue);
  }, [serverValue]);

  useEffect(
    () =>
      tokenStore.subscribe((next) => {
        if ((next?.sessionId ?? null) === sessionRef.current) return;
        queuedRef.current = null;
        endPendingRef.current?.end();
        endPendingRef.current = null;
        setSessionChanged(true);
        setChecked(false);
        setIsSaving(false);
      }),
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Async rollback subscription (orchestrator → flashBus → here).  See
  // useDraftField for the full reasoning; for the toggle we just
  // re-snap to the last committed value and pulse the flash class.
  // Flash state (parity, timer, flashBus subscription) is shared via
  // useFlashState; only the checked-revert side effect is specific here.
  const {
    flashing,
    flashProps,
    trigger: flashRollback,
  } = useFlashState(flashKey, () => {
    setChecked(lastCommittedRef.current);
  });

  const performSave = useCallback(
    async (
      value: boolean,
      save: (v: boolean, sessionId: string | null, isActive: () => boolean) => Promise<unknown>,
      lease: ReturnType<typeof beginPendingToggle>,
    ): Promise<void> => {
      if (!lease.isActive() || (tokenStore.read()?.sessionId ?? null) !== sessionRef.current)
        return;
      inflightRef.current = { value };
      setIsSaving(true);
      let succeeded = false;
      try {
        await save(
          value,
          sessionRef.current,
          () => lease.isActive() && (tokenStore.read()?.sessionId ?? null) === sessionRef.current,
        );
        succeeded = true;
      } catch (err) {
        if (!lease.isActive() || (tokenStore.read()?.sessionId ?? null) !== sessionRef.current) {
          lease.end();
          if (endPendingRef.current === lease) endPendingRef.current = null;
          return;
        }
        const msg = onErrorRef.current(err);
        // Per AGENTS.md rule 2 ("rollback is a UX event"): both toast
        // AND flash on rejection.  The flash class on the consumer's
        // input drives the keyframe.
        flashRollback();
        toasts.push(`Couldn't save ${nameRef.current} — ${msg}`, { kind: 'error' });
      }
      if (!lease.isActive() || (tokenStore.read()?.sessionId ?? null) !== sessionRef.current) {
        lease.end();
        if (endPendingRef.current === lease) endPendingRef.current = null;
        return;
      }
      inflightRef.current = null;

      if (succeeded) {
        // Record this successful save's value as the new authoritative
        // committed state BEFORE draining the queue.  If the queued
        // follow-up save then fails, its no-queue rollback branch
        // reverts to THIS value rather than the pre-save state, so a
        // durable toggle that already landed can't be erased from the
        // UI by a later rejection.
        lastCommittedRef.current = value;
      }

      // Drain queue regardless of success / failure — same rule as
      // useDraftField: queued same-field edits fire when the in-flight
      // save settles.
      const queued = queuedRef.current;
      if (queued !== null) {
        queuedRef.current = null;
        if (!succeeded) {
          // Roll local back through the queued value.  The flash-toast
          // for the failure already happened; we'll attempt the queued
          // value next.
          setChecked(queued.value);
        }
        await performSave(queued.value, save, lease);
        return;
      }

      if (!succeeded) {
        // No queue, save failed: revert local to the last-known
        // committed value so the checkbox doesn't show a stale
        // optimistic state.
        setChecked(lastCommittedRef.current);
      }

      lease.end();
      if (endPendingRef.current === lease) endPendingRef.current = null;
      if (isMountedRef.current) setIsSaving(false);
    },
    [toasts, flashRollback],
  );

  const toggle = useCallback(() => {
    if (sessionChanged || (tokenStore.read()?.sessionId ?? null) !== sessionRef.current) return;
    const next = !checked;
    setChecked(next);
    if (inflightRef.current !== null) {
      // A save is in flight — queue the latest desired value.
      queuedRef.current = { value: next };
      return;
    }
    const lease = beginPendingToggle(sessionRef.current, () => {
      if (endPendingRef.current !== lease) return;
      endPendingRef.current = null;
      inflightRef.current = null;
      queuedRef.current = null;
      if (isMountedRef.current) {
        setChecked(lastCommittedRef.current);
        setIsSaving(false);
      }
    });
    endPendingRef.current = lease;
    void performSave(next, onSaveRef.current, lease);
  }, [checked, performSave, sessionChanged]);

  return {
    checked: sessionChanged ? false : checked,
    toggle,
    sessionChanged,
    isSaving,
    flashing,
    flashProps,
  };
}
