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

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  push(message: string, opts?: { kind?: ToastKind; durationMs?: number | null }): string;
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

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback<ToastApi['push']>(
    (message, opts) => {
      const kind = opts?.kind ?? 'info';
      const durationMs = opts?.durationMs ?? (kind === 'error' ? 6000 : 3500);
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, kind, message }]);
      if (durationMs !== null) {
        const handle = setTimeout(() => dismiss(id), durationMs);
        timers.current.set(id, handle);
      }
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
          <button
            type="button"
            className="btn btn-ghost btn-xs"
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
