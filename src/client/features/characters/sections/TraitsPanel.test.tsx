import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { TraitsPanel } from './TraitsPanel.tsx';

const enqueueCreate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
beforeEach(() => enqueueCreate.mockClear());
const pick = vi.hoisted(() => ({
  id: '0193b3c0-f1f0-7000-8000-00000000f001',
  campaignId: '0193b3c0-f1f0-7000-8000-00000000c002',
  name: 'Gifted',
  kind: 'advantage',
  basePoints: 10,
  pointsPerLevel: null,
  availableModifiers: [],
  variants: [],
  effects: [{ target: 'dx', value: 2 }],
}));
vi.mock('../../../sync/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../sync/outbox.ts')>()),
  enqueueCreate,
}));
vi.mock('./useLibraryFetcher.ts', () => ({
  useLibraryFetcher: () => ({ fetchOptions: async () => [] }),
}));
vi.mock('../../../components/ui/LibraryAutocomplete.tsx', () => ({
  LibraryAutocomplete: ({ value, onPick }: { value: string; onPick: (value: unknown) => void }) => (
    <div>
      <input aria-label="Trait name" value={value} readOnly />
      <button type="button" onClick={() => onPick(pick)}>
        Pick Gifted
      </button>
    </div>
  ),
}));

it('rejects a stale campaign trait pick, retains the draft and flashes the form', async () => {
  const character = {
    id: 'char-1',
    campaignId: pick.campaignId,
    traits: [],
  } as unknown as CharacterDetail;
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  const view = render(<TraitsPanel character={character} canWrite />, { wrapper });
  fireEvent.click(screen.getByRole('button', { name: 'Pick Gifted' }));
  view.rerender(
    <TraitsPanel character={{ ...character, campaignId: 'other-campaign' }} canWrite />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await screen.findByText(/Couldn't add trait.*Campaign changed/);
  expect(enqueueCreate).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Trait name')).toHaveValue('Gifted');
  expect(screen.getByLabelText('Trait name').closest('form')).toHaveAttribute(
    'data-flashing',
    'true',
  );
  view.rerender(<TraitsPanel character={character} canWrite />);
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(enqueueCreate).toHaveBeenCalledOnce());
  expect(enqueueCreate.mock.calls[0]?.[0].localLibraryMechanics).toMatchObject({
    campaignId: pick.campaignId,
    sourceId: pick.id,
  });
  enqueueCreate.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Pick Gifted' }));
  view.rerender(<TraitsPanel character={{ ...character, campaignId: null }} canWrite />);
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(enqueueCreate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Trait name'), { target: { value: 'Custom' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(enqueueCreate).toHaveBeenCalledOnce());
  expect(enqueueCreate.mock.calls[0]?.[0].attemptedValue).toMatchObject({ name: 'Custom' });
  expect(enqueueCreate.mock.calls[0]?.[0].attemptedValue).not.toHaveProperty('libraryTraitId');
  expect(enqueueCreate.mock.calls[0]?.[0].localLibraryMechanics).toBeNull();
});
