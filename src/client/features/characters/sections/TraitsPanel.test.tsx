import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { TraitsPanel } from './TraitsPanel.tsx';

const enqueueCreate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const enqueueFieldPatch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
beforeEach(() => {
  enqueueCreate.mockClear();
  enqueueFieldPatch.mockReset().mockResolvedValue(undefined);
});
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
  enqueueFieldPatch,
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

const ownedTrait = {
  id: '01997c5c-8d80-7000-8000-000000000010',
  characterId: '01997c5c-8d80-7000-8000-000000000011',
  kind: 'advantage',
  name: 'Weapon Mastery',
  points: 10,
  level: null,
  variantName: null,
  notes: null,
  modifiers: [],
  libraryTraitId: null,
  customEffects: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as const;

function renderOwnedTrait() {
  const character = {
    id: ownedTrait.characterId,
    campaignId: null,
    traits: [ownedTrait],
    inventory: [],
  } as unknown as CharacterDetail;
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TraitsPanel character={character} canWrite />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function addDxEffect() {
  fireEvent.click(screen.getByText('Custom effects'));
  fireEvent.click(screen.getByRole('button', { name: '+ Add effect' }));
  fireEvent.change(screen.getByLabelText('Effect 1 target'), { target: { value: 'dx' } });
}

it('saves character-owned effects through the trait outbox field', async () => {
  renderOwnedTrait();
  addDxEffect();
  fireEvent.click(screen.getByRole('button', { name: 'Save effects' }));
  await waitFor(() => expect(enqueueFieldPatch).toHaveBeenCalledOnce());
  expect(enqueueFieldPatch).toHaveBeenCalledWith(
    expect.objectContaining({
      entityClass: 'character_trait',
      entityId: ownedTrait.id,
      fieldPath: 'customEffects',
      attemptedValue: [{ target: 'dx', value: 1, scaling: 'flat' }],
    }),
  );
});

it('retains a visible rollback event when an owned-effects save fails', async () => {
  enqueueFieldPatch.mockRejectedValueOnce(new Error('effect rejected'));
  renderOwnedTrait();
  addDxEffect();
  fireEvent.click(screen.getByRole('button', { name: 'Save effects' }));
  await screen.findByText(/Couldn't save Weapon Mastery custom effects — effect rejected/);
  expect(
    screen.getByText(
      'No mechanical effects. Add one for stat, skill, defense, DR, damage, or weapon bonuses.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByText('Custom effects').nextElementSibling).toHaveAttribute(
    'data-flashing',
    'true',
  );
});

it('queues a newer same-field effect save and lets a different field save in parallel', async () => {
  let settleFirst: (() => void) | undefined;
  enqueueFieldPatch.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settleFirst = resolve;
      }),
  );
  renderOwnedTrait();
  addDxEffect();
  fireEvent.click(screen.getByRole('button', { name: 'Save effects' }));

  fireEvent.change(screen.getByLabelText('Effect 1 bonus'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save latest changes' }));
  const points = screen.getByLabelText('Weapon Mastery points');
  fireEvent.change(points, { target: { value: '12' } });
  fireEvent.blur(points);

  await waitFor(() =>
    expect(enqueueFieldPatch).toHaveBeenCalledWith(
      expect.objectContaining({ fieldPath: 'points', attemptedValue: 12 }),
    ),
  );
  expect(
    enqueueFieldPatch.mock.calls.filter(([args]) => args.fieldPath === 'customEffects'),
  ).toHaveLength(1);
  settleFirst?.();
  await waitFor(() =>
    expect(
      enqueueFieldPatch.mock.calls.filter(([args]) => args.fieldPath === 'customEffects'),
    ).toHaveLength(2),
  );
  expect(enqueueFieldPatch.mock.calls.at(-1)?.[0]).toMatchObject({
    fieldPath: 'customEffects',
    attemptedValue: [{ target: 'dx', value: 2, scaling: 'flat' }],
  });
});
