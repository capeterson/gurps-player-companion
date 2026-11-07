import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecycleBinOut } from '../../../shared/schemas/recycleBin.ts';
import { ApiError, api } from '../../lib/api.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { RecycleBinPage } from './RecycleBinPage.tsx';

vi.mock('../../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api.ts')>()),
  api: vi.fn(),
}));
const syncNow = vi.fn();
vi.mock('../../sync/orchestrator.ts', () => ({ getSyncOrchestrator: () => ({ syncNow }) }));

const bin: RecycleBinOut = {
  characters: [
    {
      id: 'char-1',
      name: 'Aldric Thorne',
      deletedAt: '2026-11-04T12:00:00.000Z',
      purgeAfter: '2026-12-04T12:00:00.000Z',
    },
  ],
  campaigns: [
    {
      id: 'camp-1',
      name: 'Lantern Coast',
      characterCount: 4,
      deletedAt: '2026-11-01T12:00:00.000Z',
      purgeAfter: '2026-12-01T12:00:00.000Z',
    },
  ],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <RecycleBinPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RecycleBinPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncNow.mockResolvedValue(undefined);
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/recycle-bin') return bin as never;
      return undefined as never;
    });
  });

  it('lists deleted characters and campaigns with their removal dates', async () => {
    renderPage();
    expect(await screen.findByText('Aldric Thorne')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recycle bin' })).toBeInTheDocument();
    expect(screen.getByText(/permanently removed after 30 days/)).toBeInTheDocument();
    expect(screen.getByText(/Lantern Coast/)).toBeInTheDocument();
    expect(screen.getByText(/4 characters/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Deleted .* · removed after /)).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Delete now' })).toHaveLength(2);
  });

  it('says so when nothing is in the bin', async () => {
    vi.mocked(api).mockResolvedValue({ characters: [], campaigns: [] } as never);
    renderPage();
    expect(await screen.findByText('Nothing deleted in the last 30 days.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('restores a character, pulls it back locally and reports it', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Aldric Thorne');
    await user.click(screen.getAllByRole('button', { name: 'Restore' })[0] as HTMLElement);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/characters/char-1/restore', { method: 'POST' }),
    );
    expect(syncNow).toHaveBeenCalled();
    expect(await screen.findByText('Restored Aldric Thorne')).toBeInTheDocument();
  });

  it('restores a campaign through its own endpoint', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Aldric Thorne');
    await user.click(screen.getAllByRole('button', { name: 'Restore' })[1] as HTMLElement);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/campaigns/camp-1/restore', { method: 'POST' }),
    );
    expect(await screen.findByText('Restored Lantern Coast')).toBeInTheDocument();
  });

  it('names the failure when a restore is rejected', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/recycle-bin') return bin as never;
      throw new ApiError(403, 'forbidden');
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Aldric Thorne');
    await user.click(screen.getAllByRole('button', { name: 'Restore' })[0] as HTMLElement);
    expect(
      await screen.findByText("Couldn't restore Aldric Thorne — forbidden"),
    ).toBeInTheDocument();
  });

  it('permanently deletes a character only after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Aldric Thorne');
    await user.click(screen.getAllByRole('button', { name: 'Delete now' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Permanently delete character?' });
    expect(api).not.toHaveBeenCalledWith(
      expect.stringContaining('/recycle-bin/characters'),
      expect.anything(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete now' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/recycle-bin/characters/char-1', { method: 'DELETE' }),
    );
    expect(await screen.findByText('Permanently deleted Aldric Thorne')).toBeInTheDocument();
  });

  it('requires retyping a campaign name before it can be permanently deleted', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Aldric Thorne');
    await user.click(screen.getAllByRole('button', { name: 'Delete now' })[1] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Permanently delete campaign?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete now' });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Type campaign name to confirm' }),
      'Lantern Coast',
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/recycle-bin/campaigns/camp-1', { method: 'DELETE' }),
    );
  });
});
