import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExperimentalFeatures } from '../../../shared/schemas/experimentalFeatures.ts';
import { api } from '../../lib/api.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { ExperimentalFeaturesSection } from './ExperimentalFeaturesSection.tsx';

vi.mock('../../lib/api.ts', () => ({ api: vi.fn() }));

const apiMock = vi.mocked(api);

function renderSection(userId = 'account-one') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ExperimentalFeaturesSection userId={userId} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function isPatch(options: unknown) {
  return (options as { method?: string } | undefined)?.method === 'PATCH';
}

function patchBodies() {
  return apiMock.mock.calls
    .filter(([, options]) => isPatch(options))
    .map(([, options]) => (options as { body: unknown }).body);
}

beforeEach(() => apiMock.mockReset());

describe('ExperimentalFeaturesSection', () => {
  it('shows the named Experimental Features gate and persists MCP UI enablement', async () => {
    apiMock.mockImplementation(async (_path, options) =>
      isPatch(options) ? { mcpUi: true } : { mcpUi: false },
    );
    renderSection();

    expect(await screen.findByRole('heading', { name: 'Experimental Features' })).toBeVisible();
    const mcpUi = await screen.findByRole('checkbox', { name: 'MCP UI' });
    expect(mcpUi).not.toBeChecked();
    await userEvent.click(mcpUi);

    await waitFor(() => expect(patchBodies()).toEqual([{ mcpUi: true }]));
    expect(
      apiMock.mock.calls.some(
        ([path, options]) => path === '/auth/experimental-features' && !options,
      ),
    ).toBe(true);
    expect(apiMock).toHaveBeenCalledWith(
      '/auth/experimental-features',
      expect.objectContaining({ method: 'PATCH', body: { mcpUi: true } }),
    );
    await waitFor(() => expect(mcpUi).toBeChecked());
  });

  it('rolls a failed toggle back with a reason toast and input flash', async () => {
    apiMock.mockImplementation(async (_path, options) => {
      if (isPatch(options)) throw new Error('settings unavailable');
      return { mcpUi: false } satisfies ExperimentalFeatures;
    });
    renderSection();
    const mcpUi = await screen.findByRole('checkbox', { name: 'MCP UI' });
    await userEvent.click(mcpUi);

    expect(await screen.findByText("Couldn't save MCP UI — settings unavailable")).toBeVisible();
    await waitFor(() => expect(mcpUi).not.toBeChecked());
    await waitFor(() => expect(mcpUi).toHaveAttribute('data-flashing', 'true'));
  });

  it('serializes rapid same-toggle changes and saves the latest value after the first settles', async () => {
    let resolveFirst!: () => void;
    const saved: boolean[] = [];
    apiMock.mockImplementation(async (_path, options) => {
      if (!isPatch(options)) return { mcpUi: false };
      const value = (options as { body: ExperimentalFeatures }).body.mcpUi;
      saved.push(value);
      if (saved.length === 1) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return { mcpUi: value };
    });
    renderSection();
    const mcpUi = await screen.findByRole('checkbox', { name: 'MCP UI' });
    fireEvent.click(mcpUi);
    await waitFor(() => expect(saved).toEqual([true]));
    fireEvent.click(mcpUi);
    expect(saved).toEqual([true]);

    await act(async () => resolveFirst());
    await waitFor(() => expect(saved).toEqual([true, false]));
    await waitFor(() => expect(mcpUi).not.toBeChecked());
    expect(patchBodies()).toEqual([{ mcpUi: true }, { mcpUi: false }]);
  });

  it('retries a failed settings read and scopes cached values by account', async () => {
    apiMock
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce({ mcpUi: true })
      .mockResolvedValueOnce({ mcpUi: false });
    const view = renderSection('account-one');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load experimental features — temporary read failure",
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const mcpUi = await screen.findByRole('checkbox', { name: 'MCP UI' });
    expect(mcpUi).toBeChecked();

    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <ToastProvider>
          <ExperimentalFeaturesSection userId="account-two" />
        </ToastProvider>
      </QueryClientProvider>,
    );
    const secondAccountToggle = await screen.findByRole('checkbox', { name: 'MCP UI' });
    expect(secondAccountToggle).not.toBeChecked();
    expect(
      apiMock.mock.calls.filter(([path]) => path === '/auth/experimental-features'),
    ).toHaveLength(3);
  });
});
