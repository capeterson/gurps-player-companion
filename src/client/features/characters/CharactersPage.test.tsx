import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../lib/toast.tsx';
import { enqueueCreate, enqueueDelete, newClientId } from '../../sync/outbox.ts';
import { CharactersPage } from './CharactersPage.tsx';
import { useCharactersList } from './useCharacterDetail.ts';

vi.mock('./useCharacterDetail.ts', () => ({ useCharactersList: vi.fn() }));
vi.mock('../../sync/outbox.ts', () => ({
  enqueueCreate: vi.fn(),
  enqueueDelete: vi.fn(),
  newClientId: vi.fn(),
}));
vi.mock('../../sync/orchestrator.ts', () => ({
  getSyncOrchestrator: () => ({ syncNow: vi.fn() }),
}));
vi.mock('../../lib/tokenStore.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tokenStore.ts')>()),
  readUserIdFromToken: () => 'user-1',
}));

function Location() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/characters']}>
      <ToastProvider>
        <Location />
        <CharactersPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('CharactersPage creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCharactersList).mockReturnValue([]);
    vi.mocked(newClientId).mockReturnValue('new-character');
    vi.mocked(enqueueCreate).mockResolvedValue(undefined);
  });

  it('does not enqueue a blank or whitespace-only name', () => {
    renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'New character name' }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(enqueueCreate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/characters');
  });

  it('ignores duplicate submits while a create is still saving', async () => {
    let finish!: () => void;
    vi.mocked(enqueueCreate).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'New character name' }), {
      target: { value: 'Marin' },
    });
    const form = screen.getByRole('button', { name: 'Create' }).closest('form');
    if (!form) throw new Error('Character form is missing');

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(enqueueCreate).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(await screen.findByLabelText('Current route')).toHaveTextContent(
      '/characters/new-character',
    );
  });

  it('keeps a new name typed during a slow create and stays on the list', async () => {
    let finish!: () => void;
    vi.mocked(enqueueCreate).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderPage();
    const input = screen.getByRole('textbox', { name: 'New character name' });
    fireEvent.change(input, { target: { value: 'Marin' } });
    const form = input.closest('form');
    if (!form) throw new Error('Character form is missing');
    fireEvent.submit(form);

    fireEvent.change(input, { target: { value: 'The next hero' } });
    await act(async () => {
      finish();
      await Promise.resolve();
    });

    expect(await screen.findByDisplayValue('The next hero')).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/characters');
    expect(enqueueCreate).toHaveBeenCalledTimes(1);
  });
});

describe('CharactersPage deletion', () => {
  const row = (id: string, name: string, ownerId: string) => ({
    id,
    ownerId,
    campaignId: null,
    campaignName: null,
    name,
    portraitAssetId: null,
    st: 10,
    dx: 10,
    iq: 10,
    ht: 10,
    updatedAt: '2026-11-01T00:00:00.000Z',
    revision: 1,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enqueueDelete).mockResolvedValue(undefined);
    vi.mocked(useCharactersList).mockReturnValue([
      row('mine', 'Aldric Thorne', 'user-1'),
      row('theirs', 'Mira the Quick', 'user-2'),
    ]);
  });

  it('offers Delete only on characters the viewer owns', () => {
    renderPage();
    expect(screen.getByLabelText('Actions for Aldric Thorne')).toBeInTheDocument();
    expect(screen.queryByLabelText('Actions for Mira the Quick')).not.toBeInTheDocument();
  });

  it('confirms, queues the delete and offers Undo', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Actions for Aldric Thorne'));
    await user.click(screen.getByRole('button', { name: 'Delete…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete character?' });
    expect(within(dialog).getByText(/permanently deleted after 30 days/)).toBeInTheDocument();
    expect(enqueueDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(enqueueDelete).toHaveBeenCalledWith(
        expect.objectContaining({ entityClass: 'character', entityId: 'mine' }),
      ),
    );
    expect(await screen.findByText('Deleted Aldric Thorne')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('keeps the character when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Actions for Aldric Thorne'));
    await user.click(screen.getByRole('button', { name: 'Delete…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete character?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(enqueueDelete).not.toHaveBeenCalled();
  });

  it('links to the recycle bin', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Recycle bin' })).toHaveAttribute(
      'href',
      '/recycle-bin',
    );
  });
});
