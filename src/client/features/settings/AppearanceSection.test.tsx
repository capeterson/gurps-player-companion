import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, api: vi.fn() };
});

import { ApiError, api } from '../../lib/api.ts';
import { type ThemePreferences, resetThemeStoreForTests, setThemeMode } from '../../lib/theme.ts';
import { useThemePreferenceSync } from '../../lib/themeSync.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';

const apiMock = vi.mocked(api);
const SERVER: ThemePreferences = { darkTheme: 'corona-obsidian', lightTheme: 'heliolance' };

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

function patchBodies() {
  return apiMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => init?.body);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gpc.theme.v2', 'light');
  apiMock.mockReset();
  resetThemeStoreForTests();
});

describe('AppearanceSection', () => {
  it('offers both light palettes but no single-option dark picker', async () => {
    apiMock.mockImplementation(async (_path, init) =>
      init?.method === 'PATCH' ? init.body : SERVER,
    );
    renderSection();
    const light = screen.getByRole('combobox', { name: 'Light theme' }) as HTMLSelectElement;
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByText('Corona Obsidian')).toBeTruthy();
    expect(Array.from(light.options, (option) => option.textContent)).toEqual([
      'Heliolance',
      'Daybreak Lens',
    ]);
    expect(light.value).toBe('heliolance');

    await userEvent.selectOptions(light, 'Daybreak Lens');
    expect(light.value).toBe('daybreak-lens');
    expect(document.documentElement.dataset.theme).toBe('daybreak-lens');
    await waitFor(() =>
      expect(patchBodies()).toEqual([
        { darkTheme: 'corona-obsidian', lightTheme: 'daybreak-lens' },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByText('Saved on this device — syncing to your account…')).toBeNull(),
    );
  });

  it('rolls a rejected change back with a toast and a flash', async () => {
    apiMock.mockImplementation(async (_path, init) => {
      if (init?.method === 'PATCH') throw new ApiError(422, 'theme not allowed');
      return SERVER;
    });
    renderSection();
    const light = screen.getByLabelText('Light theme') as HTMLSelectElement;
    await userEvent.selectOptions(light, 'Daybreak Lens');

    expect(await screen.findByText("Couldn't save light theme — theme not allowed")).toBeTruthy();
    await waitFor(() => expect(light.value).toBe('heliolance'));
    expect(light.getAttribute('data-flashing')).toBe('true');
  });

  it('retains a device mode change while a palette save is in flight', async () => {
    let releaseFirst!: () => void;
    apiMock.mockImplementation(async (_path, init) => {
      if (init?.method !== 'PATCH') return SERVER;
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return init.body;
    });
    renderSection();
    const light = screen.getByLabelText('Light theme') as HTMLSelectElement;
    await userEvent.selectOptions(light, 'Daybreak Lens');
    act(() => setThemeMode('dark'));
    releaseFirst();

    await waitFor(() =>
      expect(screen.queryByText('Saved on this device — syncing to your account…')).toBeNull(),
    );
    expect(patchBodies()).toHaveLength(1);
    expect(light.value).toBe('daybreak-lens');
    expect(document.documentElement.dataset.theme).toBe('corona-obsidian');
  });

  it('queues a same-field edit behind a slow save and sends it afterwards', async () => {
    let releaseFirst!: () => void;
    let patches = 0;
    apiMock.mockImplementation(async (_path, init) => {
      if (init?.method !== 'PATCH') return SERVER;
      patches += 1;
      if (patches === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return init.body;
    });
    renderSection();
    const light = screen.getByLabelText('Light theme') as HTMLSelectElement;
    await userEvent.selectOptions(light, 'Daybreak Lens');
    await userEvent.selectOptions(light, 'Heliolance');
    expect(patchBodies()).toHaveLength(1);
    releaseFirst();

    await waitFor(() => expect(patchBodies()).toHaveLength(2));
    expect(patchBodies()[1]).toEqual({
      darkTheme: 'corona-obsidian',
      lightTheme: 'heliolance',
    });
    expect(light.value).toBe('heliolance');
    expect(document.documentElement.dataset.theme).toBe('heliolance');
  });
});
