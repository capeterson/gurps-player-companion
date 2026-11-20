import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return { ...actual, api: vi.fn() };
});

import { ApiError, api } from './api.ts';
import {
  type ThemePreferences,
  adoptServerThemePreferences,
  applyStoredTheme,
  clearPendingThemePreferences,
  fetchServerThemePreferences,
  getThemeState,
  readStoredMode,
  resetThemeStoreForTests,
  setThemeMode,
  setThemePreference,
  subscribeThemeRejections,
} from './theme.ts';

const apiMock = vi.mocked(api);
const DEFAULTS: ThemePreferences = { darkTheme: 'corona-obsidian', lightTheme: 'heliolance' };
const DAYBREAK: ThemePreferences = { ...DEFAULTS, lightTheme: 'daybreak-lens' };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function patchBodies() {
  return apiMock.mock.calls
    .filter(([, init]) => (init as { method?: string } | undefined)?.method === 'PATCH')
    .map(([, init]) => (init as { body: ThemePreferences }).body);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
  apiMock.mockReset();
  resetThemeStoreForTests();
  document.documentElement.dataset.theme = '';
});

describe('theme mode', () => {
  it('drops the previous mode and unsent palette without pushing a reset', async () => {
    const osMode = readStoredMode();
    localStorage.setItem('gpc.theme', osMode === 'light' ? 'dark' : 'light');
    localStorage.setItem(
      'gpc.themePreferences',
      JSON.stringify({ darkTheme: 'midnight-gilt', lightTheme: 'heraldic-vellum', pending: true }),
    );
    resetThemeStoreForTests();
    expect(getThemeState()).toEqual({ mode: osMode, preferences: DEFAULTS, pending: false });
    expect(localStorage.getItem('gpc.theme')).toBeNull();
    expect(localStorage.getItem('gpc.themePreferences')).toBeNull();

    apiMock.mockResolvedValueOnce(DAYBREAK);
    await fetchServerThemePreferences();
    expect(patchBodies()).toHaveLength(0);
    expect(getThemeState().preferences).toEqual(DAYBREAK);
  });

  it('defaults to Corona Obsidian in dark mode and Heliolance in light mode', () => {
    localStorage.setItem('gpc.theme.v2', 'dark');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('corona-obsidian');
    localStorage.setItem('gpc.theme.v2', 'light');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('heliolance');
  });

  it('preserves new choices and pending edits across startup, even after a legacy tab writes', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('offline'));
    localStorage.setItem('gpc.theme.v2', 'dark');
    resetThemeStoreForTests();
    setThemeMode('light');
    setThemePreference('lightTheme', 'daybreak-lens');
    await flush();
    localStorage.setItem('gpc.theme', 'arcane-dark');
    localStorage.setItem(
      'gpc.themePreferences',
      JSON.stringify({ darkTheme: 'arcane-dark', lightTheme: 'arcane-light', pending: true }),
    );
    resetThemeStoreForTests();
    applyStoredTheme();
    expect(getThemeState()).toEqual({ mode: 'light', preferences: DAYBREAK, pending: true });
    expect(document.documentElement.dataset.theme).toBe('daybreak-lens');
  });

  it('keeps every theme-color tag in step with the applied theme', () => {
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)">';
    localStorage.setItem('gpc.theme.v2', 'light');
    applyStoredTheme();
    const tags = [...document.querySelectorAll('meta[name="theme-color"]')];
    expect(tags.map((tag) => tag.getAttribute('content'))).toEqual(['#faf4e9', '#faf4e9']);
    document.head.innerHTML = '';
  });

  it('switches mode locally without contacting the server', () => {
    localStorage.setItem('gpc.theme.v2', 'dark');
    resetThemeStoreForTests();
    setThemeMode('light');
    expect(document.documentElement.dataset.theme).toBe('heliolance');
    expect(localStorage.getItem('gpc.theme.v2')).toBe('light');
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe('theme preferences sync', () => {
  beforeEach(() => {
    localStorage.setItem('gpc.theme.v2', 'light');
    resetThemeStoreForTests();
  });

  it('applies immediately and clears pending once the server confirms', async () => {
    apiMock.mockResolvedValueOnce(DAYBREAK);
    setThemePreference('lightTheme', 'daybreak-lens');
    expect(document.documentElement.dataset.theme).toBe('daybreak-lens');
    expect(getThemeState().pending).toBe(true);
    expect(JSON.parse(localStorage.getItem('gpc.themePreferences.v2') ?? '{}')).toMatchObject({
      ...DAYBREAK,
      pending: true,
    });
    await flush();
    expect(patchBodies()).toEqual([DAYBREAK]);
    expect(getThemeState().pending).toBe(false);
  });

  it('keeps an offline change pending and sends it when the browser comes back online', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    setThemePreference('lightTheme', 'daybreak-lens');
    await flush();
    expect(getThemeState()).toMatchObject({
      pending: true,
      preferences: DAYBREAK,
    });

    apiMock.mockResolvedValueOnce(DAYBREAK);
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(patchBodies()).toHaveLength(2);
    expect(getThemeState().pending).toBe(false);
  });

  it('rolls back a rejected change and reports the field', async () => {
    const rejections: unknown[] = [];
    subscribeThemeRejections((rejection) => rejections.push(rejection));
    apiMock.mockImplementation(async (_path, init) => {
      if ((init as { method?: string } | undefined)?.method === 'PATCH') {
        throw new ApiError(422, 'invalid theme');
      }
      return DEFAULTS;
    });
    setThemePreference('lightTheme', 'daybreak-lens');
    await flush();
    await flush();
    expect(getThemeState()).toMatchObject({
      pending: false,
      preferences: DEFAULTS,
    });
    expect(document.documentElement.dataset.theme).toBe('heliolance');
    expect(rejections).toEqual([{ fields: ['lightTheme'], reason: 'invalid theme' }]);
  });

  it('queues a same-field change behind a slow save and sends the latest value', async () => {
    const first = deferred<unknown>();
    apiMock.mockReturnValueOnce(first.promise as Promise<never>);
    apiMock.mockResolvedValueOnce(DEFAULTS);
    setThemePreference('lightTheme', 'daybreak-lens');
    setThemePreference('lightTheme', 'heliolance');
    expect(patchBodies()).toHaveLength(1);

    first.resolve(DAYBREAK);
    await flush();
    expect(patchBodies()).toEqual([DAYBREAK, DEFAULTS]);
    expect(getThemeState()).toMatchObject({
      pending: false,
      preferences: DEFAULTS,
    });
    expect(document.documentElement.dataset.theme).toBe('heliolance');
  });

  it('keeps the current device mode when a slow palette save returns', async () => {
    const first = deferred<unknown>();
    apiMock.mockReturnValueOnce(first.promise as Promise<never>);
    setThemePreference('lightTheme', 'daybreak-lens');
    setThemeMode('dark');

    first.resolve(DAYBREAK);
    await flush();
    expect(getThemeState()).toEqual({ mode: 'dark', preferences: DAYBREAK, pending: false });
    expect(document.documentElement.dataset.theme).toBe('corona-obsidian');
    expect(patchBodies()).toEqual([DAYBREAK]);
  });

  it('adopts server preferences from another device, but never over a pending local change', async () => {
    adoptServerThemePreferences(DAYBREAK);
    expect(document.documentElement.dataset.theme).toBe('daybreak-lens');
    expect(apiMock).not.toHaveBeenCalled();

    apiMock.mockRejectedValue(new TypeError('offline'));
    setThemePreference('lightTheme', 'heliolance');
    await flush();
    adoptServerThemePreferences(DAYBREAK);
    expect(getThemeState().preferences).toEqual(DEFAULTS);
  });

  it('ignores a server read that started before a local change', async () => {
    const read = deferred<unknown>();
    apiMock.mockReturnValueOnce(read.promise as Promise<never>);
    apiMock.mockResolvedValueOnce(DAYBREAK);
    const fetching = fetchServerThemePreferences();
    setThemePreference('lightTheme', 'daybreak-lens');
    await flush();
    read.resolve(DEFAULTS);
    await fetching;
    expect(getThemeState().preferences).toEqual(DAYBREAK);
  });

  it('drops unsent changes on sign-out', async () => {
    apiMock.mockRejectedValue(new TypeError('offline'));
    setThemePreference('lightTheme', 'daybreak-lens');
    await flush();
    clearPendingThemePreferences();
    expect(getThemeState().pending).toBe(false);
    adoptServerThemePreferences(DEFAULTS);
    expect(document.documentElement.dataset.theme).toBe('heliolance');
  });
});
