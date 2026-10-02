import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
} from 'react';

export const EditorValidityContext = createContext<
  (id: string, valid: boolean, path: string) => void
>(() => {});

/** Removing a row clears its invalid draft; moving it retains and relabels the draft. */
export function EditorValidity({
  children,
  path,
}: { children: (onValidityChange: (valid: boolean) => void) => ReactNode; path: string }) {
  const id = useId();
  const report = useContext(EditorValidityContext);
  const latest = useRef(true);
  const callback = useCallback(
    (valid: boolean) => {
      latest.current = valid;
      report(id, valid, path);
    },
    [id, report, path],
  );
  useEffect(() => {
    report(id, latest.current, path);
    return () => report(id, true, path);
  }, [id, report, path]);
  return children(callback);
}
