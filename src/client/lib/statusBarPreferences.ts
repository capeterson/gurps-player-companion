import { useCallback, useSyncExternalStore } from 'react';

export interface StatusBarPreferences {
  showPosture: boolean;
  showManeuver: boolean;
  showConditions: boolean;
}

const PREFIX = 'gpc:status-bar-preferences:';
const CHANGE_EVENT = 'gpc:status-bar-preferences-change';
const DEFAULTS: StatusBarPreferences = {
  showPosture: false,
  showManeuver: false,
  showConditions: false,
};

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

export function readStatusBarPreferences(userId: string | undefined): StatusBarPreferences {
  const raw = readRaw(userId);
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<StatusBarPreferences>;
    return {
      showPosture: value.showPosture === true,
      showManeuver: value.showManeuver === true,
      showConditions: value.showConditions === true,
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
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<StatusBarPreferences>;
    return {
      showPosture: value.showPosture === true,
      showManeuver: value.showManeuver === true,
      showConditions: value.showConditions === true,
    };
  } catch {
    return DEFAULTS;
  }
}
