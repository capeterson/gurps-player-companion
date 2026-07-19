import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import type { EncounterOut } from '../../../shared/schemas/encounter.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { EncounterPage } from './EncounterPage.tsx';
import { cleanupLinkedSheetEffect } from './effectSheetCleanup.ts';
import { encountersApi } from './encountersApi.ts';

const encounter = vi.hoisted(() => ({ data: null as EncounterOut | null }));

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }));
vi.mock('../characters/useCharacterDetail.ts', () => ({ useCampaignCharactersList: () => [] }));
vi.mock('./useEncounters.ts', () => ({
  useEncounter: () => ({ data: encounter.data, isLoading: false, error: null }),
}));
vi.mock('./effectSheetCleanup.ts', () => ({ cleanupLinkedSheetEffect: vi.fn() }));
vi.mock('./encountersApi.ts', () => ({
  encounterKeys: {
    detail: (id: string, encounterId: string) => ['encounters', id, encounterId],
    list: (id: string) => ['encounters', id],
  },
  encountersApi: {
    advance: vi.fn(),
    createCombatant: vi.fn(),
    createEffect: vi.fn(),
    deleteCombatant: vi.fn(),
    deleteEffect: vi.fn(),
    update: vi.fn(),
    updateCombatant: vi.fn(),
    updateEffect: vi.fn(),
  },
}));
vi.mock('../../lib/api.ts', () => ({
  api: vi.fn(async (path: string) =>
    path === '/auth/me'
      ? { id: 'owner' }
      : ({ ownerId: 'owner', members: [] } as unknown as CampaignOut),
  ),
}));

Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), writable: true });

function makeEncounter(overrides: Partial<EncounterOut> = {}): EncounterOut {
  return {
    id: 'encounter',
    campaignId: 'campaign',
    name: 'Ambush',
    status: 'active',
    round: 3,
    activeCombatantId: 'target',
    version: 1,
    endedAt: null,
    combatants: [
      {
        id: 'target',
        encounterId: 'encounter',
        kind: 'npc',
        characterId: null,
        name: 'Target',
        basicSpeed: 5,
        dx: 10,
        orderKey: 10,
        active: true,
        maxHp: 10,
        currentHp: 10,
        move: null,
        dodge: null,
        dr: null,
        maneuver: null,
        conditions: [],
        hiddenFromPlayers: false,
        notes: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    effects: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/campaigns/campaign/encounters/encounter']}>
          <Routes>
            <Route path="/campaigns/:id/encounters/:encounterId" element={<EncounterPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('EncounterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encounter.data = makeEncounter();
    vi.mocked(encountersApi.createEffect).mockResolvedValue({});
    vi.mocked(encountersApi.deleteEffect).mockResolvedValue(undefined);
    vi.mocked(encountersApi.updateEffect).mockResolvedValue({});
    vi.mocked(encountersApi.updateCombatant).mockResolvedValue({});
  });

  it('serializes rapid NPC HP decrements against the latest intended value', async () => {
    let resolveFirst: (() => void) | undefined;
    vi.mocked(encountersApi.updateCombatant)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = () => resolve({});
          }),
      )
      .mockResolvedValueOnce({});
    renderPage();

    const decrement = await screen.findByRole('button', { name: 'HP -1' });
    fireEvent.click(decrement);
    fireEvent.click(decrement);

    expect(encountersApi.updateCombatant).toHaveBeenCalledTimes(1);
    expect(encountersApi.updateCombatant).toHaveBeenLastCalledWith(
      'campaign',
      'encounter',
      'target',
      {
        currentHp: 9,
      },
    );

    resolveFirst?.();
    await waitFor(() => expect(encountersApi.updateCombatant).toHaveBeenCalledTimes(2));
    expect(encountersApi.updateCombatant).toHaveBeenLastCalledWith(
      'campaign',
      'encounter',
      'target',
      {
        currentHp: 8,
      },
    );
  });

  it('lets NPC HP damage drop below zero', async () => {
    const [firstCombatant] = makeEncounter().combatants;
    if (!firstCombatant) throw new Error('missing combatant');
    encounter.data = makeEncounter({ combatants: [{ ...firstCombatant, currentHp: 0 }] });
    renderPage();

    const decrement = await screen.findByRole('button', { name: 'HP -1' });
    fireEvent.click(decrement);

    await waitFor(() => expect(encountersApi.updateCombatant).toHaveBeenCalled());
    expect(encountersApi.updateCombatant).toHaveBeenLastCalledWith(
      'campaign',
      'encounter',
      'target',
      { currentHp: -1 },
    );
  });

  it('disables turn-order reslots while a mutation is pending', async () => {
    let resolveMove: (() => void) | undefined;
    vi.mocked(encountersApi.updateCombatant).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMove = () => resolve({});
        }),
    );
    const [firstCombatant] = makeEncounter().combatants;
    if (!firstCombatant) throw new Error('missing combatant');
    encounter.data = makeEncounter({
      combatants: [
        firstCombatant,
        { ...firstCombatant, id: 'second', name: 'Second', orderKey: 20 },
      ],
    });
    renderPage();

    const [moveDown] = await screen.findAllByRole('button', { name: 'Move down' });
    if (!moveDown) throw new Error('missing move down button');
    fireEvent.click(moveDown);
    await waitFor(() => expect(encountersApi.updateCombatant).toHaveBeenCalledTimes(1));
    // While that reslot is pending the button is disabled, so a second tap cannot
    // recompute from the stale snapshot and re-send the same order key.
    await waitFor(() => expect(moveDown).toBeDisabled());
    fireEvent.click(moveDown);
    expect(encountersApi.updateCombatant).toHaveBeenCalledTimes(1);

    resolveMove?.();
    await waitFor(() => expect(moveDown).not.toBeDisabled());
  });

  it('omits blank optional fields when creating an effect', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Add effect' });
    fireEvent.click(screen.getByRole('button', { name: 'Add effect' }));
    const dialog = screen.getByRole('dialog');
    const [nameInput] = within(dialog).getAllByRole('textbox');
    const [, , targetSelect] = within(dialog).getAllByRole('combobox');
    if (!nameInput || !targetSelect) throw new Error('effect dialog fields are missing');
    fireEvent.change(nameInput, { target: { value: 'Haste' } });
    fireEvent.change(targetSelect, { target: { value: 'target' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add effect' }));

    await waitFor(() => expect(encountersApi.createEffect).toHaveBeenCalled());
    expect(vi.mocked(encountersApi.createEffect).mock.calls[0]?.[2]).toEqual({
      targetCombatantId: 'target',
      name: 'Haste',
      duration: { unit: 'rounds', amount: 1 },
    });
  });

  it('does not clean up a linked sheet effect when deletion or acknowledgement fails', async () => {
    encounter.data = makeEncounter({
      effects: [
        {
          id: 'effect',
          encounterId: 'encounter',
          targetCombatantId: 'target',
          casterCombatantId: null,
          createdById: 'owner',
          name: 'Haste',
          duration: { unit: 'rounds', amount: 1 },
          startedAtRound: 1,
          maintenanceCost: null,
          lastMaintainedRound: null,
          expiryAcknowledgedAtRound: null,
          linkedCondition: 'stunned',
          linkedTempEffectId: null,
          notes: null,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });
    vi.mocked(encountersApi.deleteEffect).mockRejectedValue(new Error('Delete failed'));
    vi.mocked(encountersApi.updateEffect).mockRejectedValue(new Error('Acknowledge failed'));
    renderPage();
    const effectCard = (await screen.findByText('Haste')).closest('article');
    if (!effectCard) throw new Error('effect card is missing');
    fireEvent.click(within(effectCard).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(encountersApi.deleteEffect).toHaveBeenCalled());
    expect(cleanupLinkedSheetEffect).not.toHaveBeenCalled();

    fireEvent.click(within(effectCard).getByRole('button', { name: 'Acknowledge expiry' }));
    await waitFor(() => expect(encountersApi.updateEffect).toHaveBeenCalled());
    expect(cleanupLinkedSheetEffect).not.toHaveBeenCalled();
  });

  it('hides turn controls for ended encounters', async () => {
    encounter.data = makeEncounter({ status: 'ended', endedAt: '2025-01-01T00:00:00.000Z' });
    renderPage();
    await screen.findByText('Combat ended');
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next turn' })).not.toBeInTheDocument();
  });
});
