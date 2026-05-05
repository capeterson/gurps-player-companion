import { useEffect, useMemo, useRef, useState } from 'react';

export type SyncIndicatorStatus = 'syncing' | 'failed' | 'synced';

interface UseSyncIndicatorStateOptions {
  hasSyncWork: boolean;
  hasSyncError: boolean;
  minVisibleMs?: number;
}

function resolveStatus(hasSyncWork: boolean, hasSyncError: boolean): SyncIndicatorStatus {
  if (hasSyncError) return 'failed';
  if (hasSyncWork) return 'syncing';
  return 'synced';
}

export function useSyncIndicatorState(opts: UseSyncIndicatorStateOptions): SyncIndicatorStatus {
  const { hasSyncWork, hasSyncError, minVisibleMs = 1000 } = opts;
  const target = useMemo(() => resolveStatus(hasSyncWork, hasSyncError), [hasSyncWork, hasSyncError]);
  const [visible, setVisible] = useState<SyncIndicatorStatus>(target);
  const shownAtRef = useRef<number>(Date.now());

  useEffect(() => {
    if (target === visible) return;

    const elapsed = Date.now() - shownAtRef.current;
    const wait = Math.max(0, minVisibleMs - elapsed);
    const timer = window.setTimeout(() => {
      shownAtRef.current = Date.now();
      setVisible(target);
    }, wait);

    return () => window.clearTimeout(timer);
  }, [target, visible, minVisibleMs]);

  return visible;
}

