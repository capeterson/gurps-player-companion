import { useCallback, useSyncExternalStore } from 'react';

export interface StatusBarPreferences {
  /** Shows the Posture, Maneuver and Conditions triggers beside HP and FP. */
  showStatusHeader: boolean;
}

const PREFIX = 'gpc:status-bar-preferences:';
const CHANGE_EVENT = 'gpc:status-bar-preferences-change';
const DEFAULTS: StatusBarPreferences = { showStatusHeader: false };

function keyFor(userId: string): string {
  return `${PREFIX}${userId}`;
}

function readRaw(userId: string | undefined): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(keyFor(userId));
  } catch {
    return null;
  }
}

function parsePreferences(raw: string | null): StatusBarPreferences {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    // Older builds stored three separate toggles; any of them on keeps the header on.
    return {
      showStatusHeader:
        value.showStatusHeader === true ||
        value.showPosture === true ||
        value.showManeuver === true ||
        value.showConditions === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function writeStatusBarPreferences(
  userId: string,
  preferences: StatusBarPreferences,
): boolean {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(preferences));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: userId }));
    return true;
  } catch {
    return false;
  }
}

/** User-scoped, device-local presentation settings shared across open tabs. */
export function useStatusBarPreferences(userId: string | undefined): StatusBarPreferences {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!userId) return () => {};
      const onLocal = (event: Event) => {
        if ((event as CustomEvent<string>).detail === userId) notify();
      };
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === keyFor(userId)) notify();
      };
      window.addEventListener(CHANGE_EVENT, onLocal);
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener(CHANGE_EVENT, onLocal);
        window.removeEventListener('storage', onStorage);
      };
    },
    [userId],
  );
  const snapshot = useCallback(() => readRaw(userId), [userId]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  return parsePreferences(raw);
}
