import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../lib/toast.tsx';
import { useConfirmedEntityDelete } from './useConfirmedEntityDelete.tsx';

const enqueueDelete = vi.hoisted(() => vi.fn());
vi.mock('../../../sync/outbox.ts', () => ({ enqueueDelete }));

const SPELL = { id: 'spell-1', name: 'Fireball' };

function Row() {
  const deletion = useConfirmedEntityDelete({
    entityClass: 'character_spell',
    noun: 'spell',
    label: SPELL.name,
    entity: SPELL,
    characterId: 'char-1',
  });
  return (
    <div>
      <button type="button" onClick={deletion.request} aria-label={`Delete spell ${SPELL.name}`}>
        ✕
      </button>
      {deletion.dialog}
    </div>
  );
}

function renderRow() {
  render(
    <ToastProvider>
      <Row />
    </ToastProvider>,
  );
}

beforeEach(() => {
  enqueueDelete.mockReset();
  enqueueDelete.mockResolvedValue(undefined);
});

describe('useConfirmedEntityDelete', () => {
  it('asks before deleting and enqueues the row snapshot on confirm', async () => {
    renderRow();
    expect(screen.queryByText('Delete spell "Fireball"?')).not.toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Delete spell Fireball' }));
    expect(screen.getByText('Delete spell "Fireball"?')).toBeVisible();
    expect(enqueueDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(enqueueDelete).toHaveBeenCalledWith({
        entityClass: 'character_spell',
        entityId: 'spell-1',
        humanName: 'spell "Fireball"',
        characterId: 'char-1',
        prevValue: SPELL,
      }),
    );
  });

  it('does nothing when the confirmation is cancelled', () => {
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Delete spell Fireball' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(enqueueDelete).not.toHaveBeenCalled();
  });

  it('toasts the reason when the delete cannot be queued', async () => {
    enqueueDelete.mockRejectedValue(new Error('db closed'));
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Delete spell Fireball' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(screen.getByText(/Couldn't delete spell — db closed/)).toBeInTheDocument(),
    );
  });
});
