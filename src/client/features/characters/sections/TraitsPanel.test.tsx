import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  localStorage.clear();
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
  fireEvent.click(screen.getByRole('button', { name: '+ Add trait' }));
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

function renderCharacterTraits(traits: readonly unknown[], canWrite = true) {
  const character = {
    id: ownedTrait.characterId,
    campaignId: null,
    traits,
    inventory: [],
  } as unknown as CharacterDetail;
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TraitsPanel character={character} canWrite={canWrite} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function renderOwnedTrait() {
  return renderCharacterTraits([ownedTrait]);
}

function addDxEffect() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit Weapon Mastery' }));
  fireEvent.click(screen.getByRole('button', { name: '+ Add effects' }));
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

it('can remove an empty Effects section without writing a trait patch', () => {
  renderOwnedTrait();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Weapon Mastery' }));
  fireEvent.click(screen.getByRole('button', { name: '+ Add effects' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove effects' }));
  expect(screen.getByRole('button', { name: '+ Add effects' })).toBeVisible();
  expect(screen.queryByText('Effects')).not.toBeInTheDocument();
  expect(enqueueFieldPatch).not.toHaveBeenCalled();
});

it('removes saved effects through the outbox and restores the compact add control', async () => {
  renderCharacterTraits([
    { ...ownedTrait, customEffects: [{ target: 'dx', value: 1, scaling: 'flat' }] },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Weapon Mastery' }));
  fireEvent.click(screen.getByText('Effects (1)'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove effects' }));
  await waitFor(() =>
    expect(enqueueFieldPatch).toHaveBeenCalledWith(
      expect.objectContaining({ fieldPath: 'customEffects', attemptedValue: [] }),
    ),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: '+ Add effects' })).toBeVisible());
});

it('keeps saved effects visible and flashes the editor if removal fails', async () => {
  enqueueFieldPatch.mockRejectedValueOnce(new Error('effect rejected'));
  renderCharacterTraits([
    { ...ownedTrait, customEffects: [{ target: 'dx', value: 1, scaling: 'flat' }] },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Weapon Mastery' }));
  fireEvent.click(screen.getByText('Effects (1)'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove effects' }));
  await screen.findByText(/Couldn't save Weapon Mastery effects — effect rejected/);
  expect(screen.getByText('Effects (1)')).toBeVisible();
  expect(screen.getByText('Effects (1)').closest('details')).toHaveAttribute(
    'data-flashing',
    'true',
  );
});

it('queues removal behind an in-flight effects save', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: 'Remove effects' }));
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
    attemptedValue: [],
  });
  await waitFor(() => expect(screen.getByRole('button', { name: '+ Add effects' })).toBeVisible());
});

it('retains a visible rollback event when an owned-effects save fails', async () => {
  enqueueFieldPatch.mockRejectedValueOnce(new Error('effect rejected'));
  renderOwnedTrait();
  addDxEffect();
  fireEvent.click(screen.getByRole('button', { name: 'Save effects' }));
  await screen.findByText(/Couldn't save Weapon Mastery effects — effect rejected/);
  expect(
    await screen.findByText(
      'No mechanical effects. Add one for stat, skill, defense, DR, damage, or weapon bonuses.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByText('Effects').closest('details')).toHaveAttribute('data-flashing', 'true');
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

it('uses the same compact searchable and sortable table pattern as skills', () => {
  const secondTrait = {
    ...ownedTrait,
    id: '01997c5c-8d80-7000-8000-000000000012',
    name: 'Acute Vision',
    kind: 'advantage',
    points: 2,
    level: 2,
    notes: 'Sharp-eyed scout',
  } as const;
  const character = {
    id: ownedTrait.characterId,
    campaignId: null,
    traits: [ownedTrait, secondTrait],
    inventory: [],
  } as unknown as CharacterDetail;
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TraitsPanel character={character} canWrite />
      </ToastProvider>
    </QueryClientProvider>,
  );

  const table = screen.getByRole('table', { name: 'Traits' });
  expect(screen.getByRole('searchbox', { name: 'Search traits' })).toBeVisible();
  for (const label of ['Trait', 'Type', 'Points', 'Level']) {
    expect(screen.getByRole('button', { name: `Sort by ${label}` })).toBeVisible();
  }
  expect(within(table).getAllByRole('button', { name: /^Reorder / })).toHaveLength(2);
  expect(screen.queryByLabelText('Trait name')).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search traits' }), {
    target: { value: 'scout' },
  });
  expect(within(table).getByText('Acute Vision')).toBeVisible();
  expect(within(table).getByText('Weapon Mastery')).not.toBeVisible();

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search traits' }), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sort by Points' }));
  expect(within(table).getAllByRole('rowgroup')[1]).toHaveAccessibleName('Acute Vision');
});

it('opens one full-width trait editor and keeps unset advanced details out of the way', () => {
  renderOwnedTrait();
  expect(screen.queryByRole('heading', { name: 'Edit Weapon Mastery' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Weapon Mastery' }));
  expect(screen.getByRole('heading', { name: 'Edit Weapon Mastery' })).toBeVisible();
  expect(screen.getByLabelText('Weapon Mastery name')).toBeVisible();
  expect(screen.getByLabelText('Weapon Mastery points')).toBeVisible();
  expect(screen.getByLabelText('Weapon Mastery description and notes')).toBeVisible();
  expect(screen.queryByText('Source & rules')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '+ Add effects' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete trait' })).toBeVisible();
});

it('preserves unsaved custom-effect drafts when disclosures close or search hides the row', () => {
  renderCharacterTraits([
    ownedTrait,
    {
      ...ownedTrait,
      id: '01997c5c-8d80-7000-8000-000000000013',
      name: 'Fit',
      points: 5,
    },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Weapon Mastery' }));
  fireEvent.click(screen.getByRole('button', { name: '+ Add effects' }));
  fireEvent.click(screen.getByRole('button', { name: '+ Add effect' }));

  fireEvent.click(screen.getByText('Effects'));
  expect(screen.getByLabelText('Effect 1 target')).not.toBeVisible();
  fireEvent.click(screen.getByText('Effects'));
  expect(screen.getByLabelText('Effect 1 target')).toBeVisible();

  fireEvent.change(screen.getByLabelText('Effect 1 target'), { target: { value: 'dx' } });
  fireEvent.change(screen.getByLabelText('Effect 1 bonus'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Fit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search traits' }), {
    target: { value: 'no matching trait' },
  });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search traits' }), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Weapon Mastery' }));
  expect(screen.getByLabelText('Effect 1 bonus')).toHaveValue('2');
  expect(enqueueFieldPatch).not.toHaveBeenCalled();
});

it('keeps browsing controls available while removing trait mutations for readers', async () => {
  const character = {
    id: ownedTrait.characterId,
    campaignId: null,
    traits: [
      {
        ...ownedTrait,
        notes: 'A visible note',
        customEffects: [
          { target: 'dr', value: 2, scaling: 'flat', hitLocation: 'Torso' },
          {
            target: 'weapon_accuracy',
            value: 1,
            scaling: 'flat',
            weaponSelector: {
              kind: 'inventory_item',
              inventoryItemId: '01997c5c-8d80-7000-8000-000000000099',
            },
          },
        ],
      },
    ],
    inventory: [
      {
        id: '01997c5c-8d80-7000-8000-000000000099',
        name: 'Fine sword',
      },
    ],
  } as unknown as CharacterDetail;
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TraitsPanel character={character} canWrite={false} />
      </ToastProvider>
    </QueryClientProvider>,
  );

  expect(screen.getByRole('searchbox', { name: 'Search traits' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sort by Trait' })).toBeVisible();
  expect(screen.getByRole('button', { name: /^Reorder Weapon Mastery/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: '+ Add trait' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit Weapon Mastery' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View Weapon Mastery' }));
  expect(await screen.findByText('A visible note')).toBeVisible();
  expect(screen.getByText('+2 to Damage Resistance at Torso')).toBeVisible();
  expect(screen.getByText(/\+1 to Weapon Accuracy for “Fine sword”/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Delete trait' })).not.toBeInTheDocument();
});
