import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueCreate, newClientId } from '../../sync/outbox.ts';
import { CharactersPage } from './CharactersPage.tsx';
import { useCharactersList } from './useCharacterDetail.ts';

vi.mock('./useCharacterDetail.ts', () => ({ useCharactersList: vi.fn() }));
vi.mock('../../sync/outbox.ts', () => ({ enqueueCreate: vi.fn(), newClientId: vi.fn() }));
vi.mock('../../lib/tokenStore.ts', () => ({ readUserIdFromToken: () => 'user-1' }));

function Location() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/characters']}>
      <Location />
      <CharactersPage />
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
