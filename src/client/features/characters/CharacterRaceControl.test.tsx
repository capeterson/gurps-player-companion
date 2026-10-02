import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRaceSelection } from '../../../shared/domain/race.ts';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { HUMAN_RACE, libraryRaceOut } from '../../../shared/schemas/race.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { CharacterRaceControl } from './CharacterRaceControl.tsx';

const mock = vi.hoisted(() => ({ save: vi.fn(), races: [] as unknown[] }));
vi.mock('../library/useLocalLibrary.ts', () => ({
  useLocalLibrary: () => ({ races: mock.races }),
}));
vi.mock('./sections/useCharacterPatch.ts', () => ({
  useCharacterFieldSave: () => () => ({
    onSave: mock.save,
    flashKey: 'character:character-1:race',
  }),
}));
const race = libraryRaceOut.parse({
  id: '10000000-0000-4000-8000-000000000001',
  campaignId: '20000000-0000-4000-8000-000000000001',
  revision: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  name: 'Stonekin',
  points: 25,
  attributeModifiers: { st: 2 },
  features: ['Stone skin'],
});
const second = libraryRaceOut.parse({
  ...race,
  id: '10000000-0000-4000-8000-000000000002',
  name: 'Riverkin',
  points: 15,
});
const character = {
  id: 'character-1',
  campaignId: race.campaignId,
  race: HUMAN_RACE,
} as CharacterDetail;
function setup(canWrite = true) {
  return render(
    <ToastProvider>
      <CharacterRaceControl character={character} canWrite={canWrite} />
    </ToastProvider>,
  );
}
function open() {
  fireEvent.click(screen.getByRole('button', { name: /Change race:/ }));
}
function select(id: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Race' }), { target: { value: id } });
}
function apply() {
  fireEvent.click(screen.getByRole('button', { name: 'Apply race' }));
}
beforeEach(() => {
  mock.save.mockReset().mockResolvedValue(undefined);
  mock.races = [race, second];
});
describe('Character race', () => {
  it('defaults to Human and previews before explicitly applying the whole race', async () => {
    setup();
    expect(screen.getByRole('button', { name: 'Change race: Human' })).toBeVisible();
    open();
    select(race.id);
    expect(screen.getByText('Stonekin · 25 points', { selector: 'p' })).toBeVisible();
    expect(screen.getByText('Stone skin')).toBeVisible();
    expect(mock.save).not.toHaveBeenCalled();
    apply();
    await waitFor(() =>
      expect(mock.save).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshot: expect.objectContaining({ name: 'Stonekin', points: 25 }),
        }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Change race: Stonekin' })).toBeVisible();
  });
  it('preserves a cancelled selection without changing the owned race', () => {
    setup();
    open();
    select(race.id);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mock.save).not.toHaveBeenCalled();
    open();
    expect(screen.getByRole('combobox', { name: 'Race' })).toHaveValue(race.id);
  });
  it('shows a rollback toast and flashes the visible race control on failure', async () => {
    mock.save.mockRejectedValue(new Error('Race unavailable'));
    setup();
    open();
    select(race.id);
    apply();
    await waitFor(() =>
      expect(screen.getByText("Couldn't save race — Race unavailable")).toBeVisible(),
    );
    expect(screen.getByRole('button', { name: 'Change race: Human' })).toHaveAttribute(
      'data-flashing',
      'true',
    );
  });
  it('queues a second selection behind a slow first save', async () => {
    let finish!: () => void;
    mock.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    setup();
    open();
    select(race.id);
    apply();
    open();
    select(second.id);
    apply();
    expect(mock.save).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
    expect(mock.save.mock.calls[1]?.[0].snapshot.name).toBe('Riverkin');
    expect(screen.getByRole('button', { name: 'Change race: Riverkin' })).toBeVisible();
  });
  it('retains race intent when a different field changes during a slow save', async () => {
    let finish!: () => void;
    mock.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = setup();
    open();
    select(race.id);
    apply();
    view.rerender(
      <ToastProvider>
        <CharacterRaceControl character={{ ...character, name: 'Changed name' }} canWrite />
      </ToastProvider>,
    );
    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Change race: Stonekin' })).toBeVisible();
  });
  it('offers details without editing to a read-only viewer', () => {
    setup(false);
    fireEvent.click(screen.getByRole('button', { name: 'View race: Human' }));
    expect(screen.getByRole('heading', { name: 'Race details' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Apply race' })).not.toBeInTheDocument();
  });
});

it('preserves a draft and requires reviewing a concurrent race change', () => {
  const view = setup();
  open();
  select(race.id);
  const changed = resolveRaceSelection(
    { raceId: second.id, variantKey: null, lensIds: [], formKey: null },
    [race, second],
  );
  view.rerender(
    <ToastProvider>
      <CharacterRaceControl character={{ ...character, race: changed }} canWrite />
    </ToastProvider>,
  );
  expect(screen.getByRole('button', { name: 'Apply race' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Race' })).toHaveValue(race.id);
  fireEvent.click(screen.getByRole('button', { name: 'Use current race' }));
  expect(screen.getByRole('combobox', { name: 'Race' })).toHaveValue(second.id);
  expect(screen.getByRole('button', { name: 'Apply race' })).toBeEnabled();
});

it('names overlapping personal traits before applying without deleting the personal purchase', () => {
  mock.races = [
    libraryRaceOut.parse({
      ...race,
      traits: [{ key: 'stone-skin', name: 'Stone Skin', points: 5 }],
    }),
  ];
  render(
    <ToastProvider>
      <CharacterRaceControl
        character={{ ...character, traits: [{ name: 'Stone Skin' }] as CharacterDetail['traits'] }}
        canWrite
      />
    </ToastProvider>,
  );
  open();
  select(race.id);
  expect(screen.getByText(/Also bought personally: Stone Skin/)).toBeVisible();
  expect(mock.save).not.toHaveBeenCalled();
});
