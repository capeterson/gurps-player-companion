/**
 * Colour theme state.
 *
 * Two independent choices decide the DaisyUI theme on `<html data-theme>`:
 *
 * - **Mode** (dark / light) is per device. It defaults to the OS preference
 *   and is flipped by the header toggle.
 * - **Palettes** (which dark theme and which light theme) are per user and
 *   synced through `GET`/`PATCH /auth/preferences`, so every device shows the
 *   same palettes.
 *
 * Palette changes are local-first: they apply and persist immediately, are
 * marked `pending`, and are pushed to the server one request at a time (the
 * latest values win). A network failure keeps them pending and retries when
 * the browser comes back online or the server copy is next read. Only an
 * explicit server rejection rolls a change back, and that is reported to
 * subscribers so the UI can toast and flash the control (AGENTS.md rule 2).
 */
import { useSyncExternalStore } from 'react';
import {
  DARK_THEMES,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  type DarkThemeName,
  LIGHT_THEMES,
  type LightThemeName,
  THEME_LABELS,
  type ThemeName,
  type ThemePreferences,
  darkThemeName,
  lightThemeName,
  themePreferences,
} from '../../shared/schemas/themePreferences.ts';
import { ApiError, api } from './api.ts';

export type { DarkThemeName, LightThemeName, ThemeName, ThemePreferences };
export { DARK_THEMES, LIGHT_THEMES, THEME_LABELS };

export type ThemeMode = 'dark' | 'light';
export type ThemePreferenceField = keyof ThemePreferences;

export interface ThemeState {
  readonly mode: ThemeMode;
  readonly preferences: ThemePreferences;
  /** True while local palette choices have not been confirmed by the server. */
  readonly pending: boolean;
}

export interface ThemeRejection {
  readonly fields: readonly ThemePreferenceField[];
  readonly reason: string;
}

const MODE_KEY = 'gpc.theme';
const PREFERENCES_KEY = 'gpc.themePreferences';
const PREFERENCES_ENDPOINT = '/auth/preferences';

export const THEME_FIELD_LABELS: Record<ThemePreferenceField, string> = {
  darkTheme: 'dark theme',
  lightTheme: 'light theme',
};

/** Browser chrome colour (address bar, PWA title bar) for each theme's page background. */
const THEME_COLORS: Record<ThemeName, string> = {
  'gilded-tome': '#16110d',
  'midnight-gilt': '#0d1220',
  'verdigris-brass': '#0c1715',
  'illuminated-manuscript': '#f3ecdc',
  'heraldic-vellum': '#f2f4f8',
};

const DEFAULT_PREFERENCES: ThemePreferences = {
  darkTheme: DEFAULT_DARK_THEME,
  lightTheme: DEFAULT_LIGHT_THEME,
};

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredMode(): ThemeMode {
  const stored = storage()?.getItem(MODE_KEY);
  // `arcane-*` values predate the gold themes; they only ever recorded the mode.
  if (stored === 'dark' || stored === 'arcane-dark') return 'dark';
  if (stored === 'light' || stored === 'arcane-light') return 'light';
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function readStoredPreferences(): { preferences: ThemePreferences; pending: boolean } {
  const raw = storage()?.getItem(PREFERENCES_KEY);
  if (!raw) return { preferences: DEFAULT_PREFERENCES, pending: false };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const dark = darkThemeName.safeParse(value.darkTheme);
    const light = lightThemeName.safeParse(value.lightTheme);
    return {
      preferences: {
        darkTheme: dark.success ? dark.data : DEFAULT_DARK_THEME,
        lightTheme: light.success ? light.data : DEFAULT_LIGHT_THEME,
      },
      pending: value.pending === true,
    };
  } catch {
    return { preferences: DEFAULT_PREFERENCES, pending: false };
  }
}

function readStoredState(): ThemeState {
  return { mode: readStoredMode(), ...readStoredPreferences() };
}

export function resolveTheme(mode: ThemeMode, preferences: ThemePreferences): ThemeName {
  return mode === 'dark' ? preferences.darkTheme : preferences.lightTheme;
}

export function applyTheme(theme: ThemeName) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

/** Apply the stored theme before React renders, so there is no flash of the default. */
export function applyStoredTheme() {
  const stored = readStoredState();
  applyTheme(resolveTheme(stored.mode, stored.preferences));
}

export function modeLabel(mode: ThemeMode) {
  return mode === 'dark' ? 'Dark' : 'Light';
}

export function oppositeMode(mode: ThemeMode): ThemeMode {
  return mode === 'dark' ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// Store

let state: ThemeState = readStoredState();
const listeners = new Set<() => void>();
const rejectionListeners = new Set<(rejection: ThemeRejection) => void>();
/** Bumped on every local palette change so stale server reads never win. */
let localVersion = 0;
let pushInFlight = false;
let pushAgain = false;

function sameMode(a: ThemeState, b: ThemeState) {
  return a.mode === b.mode;
}

function setState(next: ThemeState) {
  const previous = state;
  state = next;
  const store = storage();
  try {
    if (!sameMode(previous, next)) store?.setItem(MODE_KEY, next.mode);
    store?.setItem(PREFERENCES_KEY, JSON.stringify({ ...next.preferences, pending: next.pending }));
  } catch {
    // Storage full or blocked: the in-memory state still applies this session.
  }
  applyTheme(resolveTheme(next.mode, next.preferences));
  for (const listener of listeners) listener();
}

function samePreferences(a: ThemePreferences, b: ThemePreferences) {
  return a.darkTheme === b.darkTheme && a.lightTheme === b.lightTheme;
}

export function getThemeState(): ThemeState {
  return state;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemeState(): ThemeState {
  return useSyncExternalStore(subscribeTheme, getThemeState, getThemeState);
}

export function subscribeThemeRejections(listener: (rejection: ThemeRejection) => void) {
  rejectionListeners.add(listener);
  return () => {
    rejectionListeners.delete(listener);
  };
}

/** Flip or set the device's dark/light mode. Mode is never sent to the server. */
export function setThemeMode(mode: ThemeMode) {
  if (mode === state.mode) return;
  setState({ ...state, mode });
}

export function setThemePreference<F extends ThemePreferenceField>(
  field: F,
  value: ThemePreferences[F],
) {
  if (state.preferences[field] === value) return;
  localVersion += 1;
  setState({ ...state, preferences: { ...state.preferences, [field]: value }, pending: true });
  void pushThemePreferences();
}

/**
 * Accept the server's copy unless local changes are still waiting to be
 * sent — those win and are pushed instead (the server copy is stale then).
 */
export function adoptServerThemePreferences(server: ThemePreferences) {
  if (state.pending) {
    void pushThemePreferences();
    return;
  }
  if (!samePreferences(state.preferences, server)) {
    setState({ ...state, preferences: server });
  }
}

/** React Query `queryFn`: read the server copy and adopt it if nothing newer happened locally. */
export async function fetchServerThemePreferences(): Promise<ThemePreferences> {
  const versionAtStart = localVersion;
  const server = themePreferences.parse(await api<unknown>(PREFERENCES_ENDPOINT));
  if (versionAtStart === localVersion) adoptServerThemePreferences(server);
  return server;
}

function isRejection(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    ![401, 408, 429].includes(err.status)
  );
}

/**
 * Send the current palette choices. One request at a time: a change made
 * while a request is in flight is sent when it settles (latest values win).
 */
export async function pushThemePreferences(): Promise<void> {
  if (!state.pending) return;
  if (pushInFlight) {
    pushAgain = true;
    return;
  }
  pushInFlight = true;
  try {
    do {
      pushAgain = false;
      const sent = state.preferences;
      const versionAtSend = localVersion;
      try {
        const saved = themePreferences.parse(
          await api<unknown>(PREFERENCES_ENDPOINT, { method: 'PATCH', body: sent }),
        );
        if (versionAtSend === localVersion) {
          setState({ ...state, preferences: saved, pending: false });
        } else {
          pushAgain = true;
        }
      } catch (err) {
        if (!isRejection(err)) return; // offline / server unavailable: stay pending
        // The server refused these values: fall back to its copy, keeping any
        // field the user changed again after this request was sent.
        let server: ThemePreferences = DEFAULT_PREFERENCES;
        try {
          server = themePreferences.parse(await api<unknown>(PREFERENCES_ENDPOINT));
        } catch {
          // keep defaults
        }
        const fields = (Object.keys(sent) as ThemePreferenceField[]).filter(
          (field) => sent[field] !== server[field],
        );
        const changedSince = versionAtSend !== localVersion;
        const preferences = { ...server };
        if (changedSince) {
          for (const field of Object.keys(sent) as ThemePreferenceField[]) {
            if (state.preferences[field] !== sent[field]) {
              Object.assign(preferences, { [field]: state.preferences[field] });
            }
          }
        }
        setState({ ...state, preferences, pending: changedSince });
        pushAgain = changedSince;
        const reason = err.message || `HTTP ${err.status}`;
        for (const listener of rejectionListeners) listener({ fields, reason });
      }
    } while (pushAgain && state.pending);
  } finally {
    pushInFlight = false;
  }
}

/** Sign-out: forget unsent palette choices so they never reach the next account. */
export function clearPendingThemePreferences() {
  localVersion += 1;
  if (state.pending) setState({ ...state, pending: false });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void pushThemePreferences());
  window.addEventListener('storage', (event) => {
    if (event.key !== MODE_KEY && event.key !== PREFERENCES_KEY) return;
    const next = readStoredState();
    state = next;
    applyTheme(resolveTheme(next.mode, next.preferences));
    for (const listener of listeners) listener();
  });
}

/** Test hook: reload from storage and clear in-flight bookkeeping. */
export function resetThemeStoreForTests() {
  state = readStoredState();
  localVersion = 0;
  pushInFlight = false;
  pushAgain = false;
  listeners.clear();
  rejectionListeners.clear();
}
