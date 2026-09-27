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
  it('reads the pre-gold arcane values as a mode', () => {
    localStorage.setItem('gpc.theme', 'arcane-light');
    expect(readStoredMode()).toBe('light');
    localStorage.setItem('gpc.theme', 'arcane-dark');
    expect(readStoredMode()).toBe('dark');
  });

  it('defaults to Gilded Tome in dark mode and Illuminated Manuscript in light mode', () => {
    localStorage.setItem('gpc.theme', 'dark');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('gilded-tome');
    localStorage.setItem('gpc.theme', 'light');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('illuminated-manuscript');
  });

  it('switches mode locally without contacting the server', () => {
    localStorage.setItem('gpc.theme', 'dark');
    resetThemeStoreForTests();
    setThemeMode('light');
    expect(document.documentElement.dataset.theme).toBe('illuminated-manuscript');
    expect(localStorage.getItem('gpc.theme')).toBe('light');
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe('theme preferences sync', () => {
  beforeEach(() => {
    localStorage.setItem('gpc.theme', 'dark');
    resetThemeStoreForTests();
  });

  it('applies immediately and clears pending once the server confirms', async () => {
    apiMock.mockResolvedValueOnce({
      darkTheme: 'midnight-gilt',
      lightTheme: 'illuminated-manuscript',
    });
    setThemePreference('darkTheme', 'midnight-gilt');
    expect(document.documentElement.dataset.theme).toBe('midnight-gilt');
    expect(getThemeState().pending).toBe(true);
    expect(JSON.parse(localStorage.getItem('gpc.themePreferences') ?? '{}')).toMatchObject({
      darkTheme: 'midnight-gilt',
      pending: true,
    });
    await flush();
    expect(patchBodies()).toEqual([
      { darkTheme: 'midnight-gilt', lightTheme: 'illuminated-manuscript' },
    ]);
    expect(getThemeState().pending).toBe(false);
  });

  it('keeps an offline change pending and sends it when the browser comes back online', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    setThemePreference('lightTheme', 'heraldic-vellum');
    await flush();
    expect(getThemeState()).toMatchObject({
      pending: true,
      preferences: { lightTheme: 'heraldic-vellum' },
    });

    apiMock.mockResolvedValueOnce({ darkTheme: 'gilded-tome', lightTheme: 'heraldic-vellum' });
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
      return { darkTheme: 'gilded-tome', lightTheme: 'illuminated-manuscript' };
    });
    setThemePreference('darkTheme', 'midnight-gilt');
    await flush();
    await flush();
    expect(getThemeState()).toMatchObject({
      pending: false,
      preferences: { darkTheme: 'gilded-tome' },
    });
    expect(document.documentElement.dataset.theme).toBe('gilded-tome');
    expect(rejections).toEqual([{ fields: ['darkTheme'], reason: 'invalid theme' }]);
  });

  it('queues a same-field change behind a slow save and sends the latest value', async () => {
    const first = deferred<unknown>();
    apiMock.mockReturnValueOnce(first.promise as Promise<never>);
    apiMock.mockResolvedValueOnce({
      darkTheme: 'gilded-tome',
      lightTheme: 'illuminated-manuscript',
    });
    setThemePreference('darkTheme', 'midnight-gilt');
    setThemePreference('darkTheme', 'gilded-tome');
    expect(patchBodies()).toHaveLength(1);

    first.resolve({ darkTheme: 'midnight-gilt', lightTheme: 'illuminated-manuscript' });
    await flush();
    expect(patchBodies()).toEqual([
      { darkTheme: 'midnight-gilt', lightTheme: 'illuminated-manuscript' },
      { darkTheme: 'gilded-tome', lightTheme: 'illuminated-manuscript' },
    ]);
    expect(getThemeState()).toMatchObject({
      pending: false,
      preferences: { darkTheme: 'gilded-tome' },
    });
    expect(document.documentElement.dataset.theme).toBe('gilded-tome');
  });

  it('does not clobber a different-field change when a slow save returns', async () => {
    const first = deferred<unknown>();
    apiMock.mockReturnValueOnce(first.promise as Promise<never>);
    apiMock.mockResolvedValueOnce({ darkTheme: 'midnight-gilt', lightTheme: 'heraldic-vellum' });
    setThemePreference('darkTheme', 'midnight-gilt');
    setThemePreference('lightTheme', 'heraldic-vellum');

    first.resolve({ darkTheme: 'midnight-gilt', lightTheme: 'illuminated-manuscript' });
    await flush();
    expect(getThemeState().preferences).toEqual({
      darkTheme: 'midnight-gilt',
      lightTheme: 'heraldic-vellum',
    });
    expect(patchBodies().at(-1)).toEqual({
      darkTheme: 'midnight-gilt',
      lightTheme: 'heraldic-vellum',
    });
    expect(getThemeState().pending).toBe(false);
  });

  it('adopts server preferences from another device, but never over a pending local change', async () => {
    adoptServerThemePreferences({ darkTheme: 'midnight-gilt', lightTheme: 'heraldic-vellum' });
    expect(document.documentElement.dataset.theme).toBe('midnight-gilt');
    expect(apiMock).not.toHaveBeenCalled();

    apiMock.mockRejectedValue(new TypeError('offline'));
    setThemePreference('darkTheme', 'gilded-tome');
    await flush();
    adoptServerThemePreferences({ darkTheme: 'midnight-gilt', lightTheme: 'heraldic-vellum' });
    expect(getThemeState().preferences.darkTheme).toBe('gilded-tome');
  });

  it('ignores a server read that started before a local change', async () => {
    const read = deferred<unknown>();
    apiMock.mockReturnValueOnce(read.promise as Promise<never>);
    apiMock.mockResolvedValueOnce({
      darkTheme: 'midnight-gilt',
      lightTheme: 'illuminated-manuscript',
    });
    const fetching = fetchServerThemePreferences();
    setThemePreference('darkTheme', 'midnight-gilt');
    await flush();
    read.resolve({ darkTheme: 'gilded-tome', lightTheme: 'illuminated-manuscript' });
    await fetching;
    expect(getThemeState().preferences.darkTheme).toBe('midnight-gilt');
  });

  it('drops unsent changes on sign-out', async () => {
    apiMock.mockRejectedValue(new TypeError('offline'));
    setThemePreference('darkTheme', 'midnight-gilt');
    await flush();
    clearPendingThemePreferences();
    expect(getThemeState().pending).toBe(false);
    adoptServerThemePreferences({ darkTheme: 'gilded-tome', lightTheme: 'illuminated-manuscript' });
    expect(document.documentElement.dataset.theme).toBe('gilded-tome');
  });
});
