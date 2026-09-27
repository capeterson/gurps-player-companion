import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, api: vi.fn() };
});

import { ApiError, api } from '../../lib/api.ts';
import { type ThemePreferences, resetThemeStoreForTests } from '../../lib/theme.ts';
import { useThemePreferenceSync } from '../../lib/themeSync.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';

const apiMock = vi.mocked(api);
const SERVER: ThemePreferences = { darkTheme: 'gilded-tome', lightTheme: 'illuminated-manuscript' };

function Harness() {
  useThemePreferenceSync();
  return <AppearanceSection />;
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <Harness />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function isPatch(init: unknown) {
  return (init as { method?: string } | undefined)?.method === 'PATCH';
}

function patchBodies() {
  return apiMock.mock.calls
    .filter(([, init]) => isPatch(init))
    .map(([, init]) => (init as { body: unknown }).body);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gpc.theme', 'dark');
  apiMock.mockReset();
  resetThemeStoreForTests();
});

describe('AppearanceSection', () => {
  it('offers the named themes for each mode and saves a change', async () => {
    apiMock.mockImplementation(async (_path, init) =>
      isPatch(init) ? { ...SERVER, ...(init as { body: object }).body } : SERVER,
    );
    renderSection();
    const dark = screen.getByLabelText('Dark theme');
    const light = screen.getByLabelText('Light theme');
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
    expect(
      Array.from((dark as HTMLSelectElement).options).map((option) => option.textContent),
    ).toEqual(['Gilded Tome', 'Midnight Gilt', 'Verdigris & Brass']);
    expect(
      Array.from((light as HTMLSelectElement).options).map((option) => option.textContent),
    ).toEqual(['Illuminated Manuscript', 'Heraldic Vellum']);
    expect((dark as HTMLSelectElement).value).toBe('gilded-tome');

    await userEvent.selectOptions(dark, 'Midnight Gilt');
    expect((dark as HTMLSelectElement).value).toBe('midnight-gilt');
    expect(document.documentElement.dataset.theme).toBe('midnight-gilt');
    await waitFor(() =>
      expect(patchBodies()).toEqual([
        { darkTheme: 'midnight-gilt', lightTheme: 'illuminated-manuscript' },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByText('Saved on this device — syncing to your account…')).toBeNull(),
    );
  });

  it('rolls a rejected change back with a toast and a flash', async () => {
    apiMock.mockImplementation(async (_path, init) => {
      if (isPatch(init)) throw new ApiError(422, 'theme not allowed');
      return SERVER;
    });
    renderSection();
    const light = screen.getByLabelText('Light theme') as HTMLSelectElement;
    await userEvent.selectOptions(light, 'Heraldic Vellum');

    expect(await screen.findByText("Couldn't save light theme — theme not allowed")).toBeTruthy();
    await waitFor(() => expect(light.value).toBe('illuminated-manuscript'));
    expect(light.getAttribute('data-flashing')).toBe('true');
  });

  it('lets a different-field edit land while a slow save is in flight', async () => {
    let releaseFirst!: () => void;
    let patches = 0;
    apiMock.mockImplementation(async (_path, init) => {
      if (!isPatch(init)) return SERVER;
      patches += 1;
      const body = (init as { body: ThemePreferences }).body;
      if (patches === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return { ...body, lightTheme: 'illuminated-manuscript' };
      }
      return body;
    });
    renderSection();
    const dark = screen.getByLabelText('Dark theme') as HTMLSelectElement;
    const light = screen.getByLabelText('Light theme') as HTMLSelectElement;
    await userEvent.selectOptions(dark, 'Midnight Gilt');
    await userEvent.selectOptions(light, 'Heraldic Vellum');
    releaseFirst();

    await waitFor(() =>
      expect(patchBodies().at(-1)).toEqual({
        darkTheme: 'midnight-gilt',
        lightTheme: 'heraldic-vellum',
      }),
    );
    expect(dark.value).toBe('midnight-gilt');
    expect(light.value).toBe('heraldic-vellum');
  });

  it('queues a same-field edit behind a slow save and sends it afterwards', async () => {
    let releaseFirst!: () => void;
    let patches = 0;
    apiMock.mockImplementation(async (_path, init) => {
      if (!isPatch(init)) return SERVER;
      patches += 1;
      const body = (init as { body: ThemePreferences }).body;
      if (patches === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return body;
    });
    renderSection();
    const dark = screen.getByLabelText('Dark theme') as HTMLSelectElement;
    await userEvent.selectOptions(dark, 'Midnight Gilt');
    await userEvent.selectOptions(dark, 'Gilded Tome');
    expect(patchBodies()).toHaveLength(1);
    releaseFirst();

    await waitFor(() => expect(patchBodies()).toHaveLength(2));
    expect(patchBodies()[1]).toEqual({
      darkTheme: 'gilded-tome',
      lightTheme: 'illuminated-manuscript',
    });
    expect(dark.value).toBe('gilded-tome');
    expect(document.documentElement.dataset.theme).toBe('gilded-tome');
  });
});
