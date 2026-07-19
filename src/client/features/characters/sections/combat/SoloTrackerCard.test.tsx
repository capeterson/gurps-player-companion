import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocalDb, resetLocalDb } from '../../../../db/dexie.ts';
import { SoloTrackerCard } from './SoloTrackerCard.tsx';

afterEach(async () => {
  await resetLocalDb();
});

describe('SoloTrackerCard', () => {
  it('creates an isolated device-only tracker keyed by the displayed character', async () => {
    render(<SoloTrackerCard characterId="character-a" canWrite={true} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start tracker' }));

    await waitFor(async () => {
      expect(await getLocalDb().soloEncounters.get('character-a')).toMatchObject({
        characterId: 'character-a',
        round: 1,
        combatants: [],
      });
    });
    expect(await getLocalDb().soloEncounters.get('character-b')).toBeUndefined();
  });

  it('adds template and manual effects locally without creating outbox work', async () => {
    render(<SoloTrackerCard characterId="character-a" canWrite={true} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start tracker' }));

    fireEvent.change(await screen.findByLabelText('Effect template'), {
      target: { value: 'shock' },
    });
    expect(await screen.findByLabelText('Effect name')).toHaveValue('Shock');
    fireEvent.click(screen.getByRole('button', { name: 'Add effect' }));

    await waitFor(async () => {
      expect((await getLocalDb().soloEncounters.get('character-a'))?.effects).toMatchObject([
        { name: 'Shock', duration: { unit: 'rounds', amount: 1 }, startedAtRound: 1 },
      ]);
    });
    expect(await getLocalDb().outbox.count()).toBe(0);

    fireEvent.change(screen.getByLabelText('Effect name'), { target: { value: 'Smoke cloud' } });
    fireEvent.change(screen.getByLabelText('Effect duration'), { target: { value: 'minutes' } });
    fireEvent.change(screen.getByLabelText('Duration amount'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Maintenance FP/min'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add effect' }));

    await waitFor(async () => {
      expect((await getLocalDb().soloEncounters.get('character-a'))?.effects).toMatchObject([
        { name: 'Shock' },
        { name: 'Smoke cloud', duration: { unit: 'minutes', amount: 2 }, maintenanceCost: 1 },
      ]);
    });
    expect(await getLocalDb().outbox.count()).toBe(0);
  });

  it('prompts for expired and overdue maintenance effects, then acknowledges and removes them locally', async () => {
    await getLocalDb().soloEncounters.put({
      characterId: 'character-a',
      round: 61,
      activeCombatantId: null,
      combatants: [],
      effects: [
        {
          id: 'expired',
          name: 'Shock',
          duration: { unit: 'rounds', amount: 1 },
          startedAtRound: 1,
          maintenanceCost: 2,
          lastMaintainedRound: 1,
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    render(<SoloTrackerCard characterId="character-a" canWrite={true} />);

    expect(
      await screen.findByText('Expired: resolve or acknowledge this effect.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Maintenance due (2 FP).')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Maintain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge expiry' }));

    await waitFor(async () => {
      expect((await getLocalDb().soloEncounters.get('character-a'))?.effects[0]).toMatchObject({
        lastMaintainedRound: 61,
        expiryAcknowledgedAtRound: 61,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(async () =>
      expect((await getLocalDb().soloEncounters.get('character-a'))?.effects).toEqual([]),
    );
    expect(await getLocalDb().outbox.count()).toBe(0);
  });
});
