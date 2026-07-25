/**
 * Tiny toast system shared across the app.
 *
 * Per AGENTS.md rule 2: "A rollback is a UX event, not a silent state
 * change."  Whenever the client undoes a typed value, we MUST surface a
 * toast that names the field and the underlying reason.  This is the
 * messenger half of that rule (the field-flash is in `theme.css`).
 */

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'error' | 'info' | 'success';

/**
 * An inline button on the toast.  A toast that tells the user something
 * is available ("a new version is ready") needs to let them act on it
 * without hunting for the equivalent control elsewhere.
 */
export interface ToastAction {
  label: string;
  onClick(): void;
  /** Default true -- most actions replace the toast that offered them. */
  dismissOnClick?: boolean;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  action?: ToastAction | undefined;
}

export interface ToastPushOpts {
  kind?: ToastKind;
  durationMs?: number;
  /**
   * When true, the toast does not auto-dismiss -- it remains until the
   * user clicks ✕ or `dismiss(id)` is called explicitly.  Used for
   * sync rejections per issue #12: failed-to-sync toasts must persist
   * so the user can't miss them.  Caller may pass an explicit `id` so
   * dedup against a saved Dexie record (rejectionToasts) is possible.
   */
  persistent?: boolean;
  /** Caller-provided id; if omitted a fresh one is generated. */
  id?: string;
  /**
   * Called when the toast leaves the screen (✕ or an explicit
   * `dismiss(id)`).  Persistent sync-rejection toasts use it to record
   * the acknowledgement in Dexie -- without it, "dismissed" only ever
   * meant "removed from React state", so every reload replayed every
   * rejection the user had already read.
   */
  onDismiss?(id: string): void;
  /** Inline button rendered before the ✕. */
  action?: ToastAction | undefined;
}

export interface ToastApi {
  push(message: string, opts?: ToastPushOpts): string;
  dismiss(id: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToasts(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToasts must be used inside <ToastProvider>');
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dismissHandlers = useRef(new Map<string, (id: string) => void>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    const onDismiss = dismissHandlers.current.get(id);
    if (onDismiss) {
      dismissHandlers.current.delete(id);
      onDismiss(id);
    }
  }, []);

  const push = useCallback<ToastApi['push']>(
    (message, opts) => {
      const kind = opts?.kind ?? 'info';
      const id = opts?.id ?? `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (opts?.onDismiss) dismissHandlers.current.set(id, opts.onDismiss);
      setToasts((prev) => {
        // Dedup: if a toast with this id is already on screen (re-emit
        // from bootstrap, repeated rejection of the same op) replace
        // the existing entry rather than stacking.
        const next: Toast = { id, kind, message, action: opts?.action };
        if (prev.some((t) => t.id === id)) {
          return prev.map((t) => (t.id === id ? next : t));
        }
        return [...prev, next];
      });
      if (opts?.persistent) {
        // Caller will call dismiss() (e.g. when the user clicks ✕ or
        // when the underlying rejection record is cleared).  No timer.
        return id;
      }
      const durationMs = opts?.durationMs ?? (kind === 'error' ? 6000 : 3500);
      const handle = setTimeout(() => dismiss(id), durationMs);
      timers.current.set(id, handle);
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const handle of t.values()) clearTimeout(handle);
      t.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ push, dismiss }), [push, dismiss]);

  // Render the toast layer through a portal to <body> so it stacks above
  // the app shell regardless of containing-block / overflow context.
  const toastLayer = (
    <div
      className="toast toast-end pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={
            t.kind === 'error'
              ? 'pointer-events-auto alert alert-error shadow'
              : t.kind === 'success'
                ? 'pointer-events-auto alert alert-success shadow'
                : 'pointer-events-auto alert alert-info shadow'
          }
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="btn btn-sm ml-auto shrink-0"
              onClick={() => {
                const { onClick, dismissOnClick } = t.action as ToastAction;
                if (dismissOnClick !== false) dismiss(t.id);
                onClick();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className={`btn btn-ghost btn-xs shrink-0 ${t.action ? '' : 'ml-auto'}`}
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' && createPortal(toastLayer, document.body)}
    </ToastContext.Provider>
  );
}
