import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildSpellOut } from '../../../../shared/domain/characterDetail.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { getLocalDb } from '../../../db/dexie.ts';
import { CastSpellDialog } from './CastSpellDialog.tsx';
import { SpellsPanel } from './SpellsPanel.tsx';

const push = vi.fn();
vi.mock('../../../lib/toast.tsx', () => ({ useToasts: () => ({ push }) }));
const id = '0193b3c0-f1f0-7000-8000-00000000d043';
function fixture(mage = true, cost = 3, fp = 5, hp = 10) {
  const spell = buildSpellOut(
    {
      id: 'spell',
      characterId: id,
      name: 'Light',
      college: 'Light',
      points: 4,
      baseEnergyCost: cost,
      maintenanceCost: 2,
      castingTime: null,
      duration: null,
      prerequisites: null,
      notes: null,
      librarySpellId: null,
      createdAt: '',
      updatedAt: '',
    },
    10,
    0,
    'very_high',
  );
  const character = {
    id,
    derived: { hp, fp },
    combat: null,
    manaLevel: 'very_high',
    manaLevelKnown: true,
    traits: mage ? [{ name: 'Magery', level: 0 }] : [],
    inventory: [],
  } as unknown as CharacterDetail;
  return { spell, character };
}

describe('very high mana spending', () => {
  it('removes a stale roll before layout effects on a direct known-mana change', () => {
    const props = fixture();
    const client = new QueryClient();
    function AfterCommit({ changed }: { changed: boolean }) {
      useLayoutEffect(() => {
        if (changed)
          expect(screen.queryByRole('button', { name: 'Roll 3d6' })).not.toBeInTheDocument();
      }, [changed]);
      return null;
    }
    const panel = (changed: boolean) => (
      <QueryClientProvider client={client}>
        <SpellsPanel
          character={{
            ...props.character,
            spells: [props.spell],
            manaLevel: changed ? 'very_high' : 'normal',
          }}
          canWrite={false}
        />
        <AfterCommit changed={changed} />
      </QueryClientProvider>
    );
    const view = render(panel(false));
    fireEvent.click(screen.getByRole('button', { name: 'Roll Light' }));
    expect(screen.getByRole('button', { name: 'Roll 3d6' })).toBeInTheDocument();
    view.rerender(panel(true));
    expect(screen.getByRole('button', { name: 'Roll Light' })).toBeInTheDocument();
  });
  it('discards an open roll across an unknown campaign mana transition', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const props = fixture();
    const client = new QueryClient();
    const panel = (manaLevel: CharacterDetail['manaLevel'], manaLevelKnown = true) => (
      <QueryClientProvider client={client}>
        <SpellsPanel
          character={{ ...props.character, spells: [props.spell], manaLevel, manaLevelKnown }}
          canWrite={false}
        />
      </QueryClientProvider>
    );
    const view = render(panel('normal'));
    fireEvent.click(screen.getByRole('button', { name: 'Roll Light' }));
    expect(screen.getByRole('button', { name: 'Roll 3d6' })).toBeInTheDocument();
    view.rerender(panel('normal', false));
    expect(screen.queryByRole('button', { name: 'Roll 3d6' })).not.toBeInTheDocument();
    view.rerender(panel('very_high'));
    expect(screen.queryByRole('button', { name: 'Roll 3d6' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Roll Light' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll 3d6' }));
    expect(screen.getByText('Critical failure')).toBeInTheDocument();
  });
  it('holds spell rolls until campaign mana is known, then applies its real failure rule', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const props = fixture();
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <SpellsPanel
          character={{
            ...props.character,
            spells: [props.spell],
            manaLevel: 'normal',
            manaLevelKnown: false,
          }}
          canWrite={false}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Roll Light' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Light level')).toHaveAttribute(
      'title',
      'Waiting for campaign mana',
    );
    view.rerender(
      <QueryClientProvider client={client}>
        <SpellsPanel character={{ ...props.character, spells: [props.spell] }} canWrite={false} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Roll Light' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll 3d6' }));
    expect(screen.getByText('Critical failure')).toBeInTheDocument();
  });
  it('carries campaign mana from the spell table into the actual roll result', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const props = fixture();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SpellsPanel character={{ ...props.character, spells: [props.spell] }} canWrite={false} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Roll Light' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll 3d6' }));
    expect(screen.getByText('Critical failure')).toBeInTheDocument();
    expect(screen.getByText(/turns this failure into a critical failure/)).toBeInTheDocument();
  });
  it.each([true, false])(
    'pays FP now and only reminds a mage (%s) about next-turn recovery',
    async (mage) => {
      const props = fixture(mage);
      const close = vi.fn();
      render(<CastSpellDialog {...props} onClose={close} />);
      if (!mage) expect(screen.getByText(/Without Magery/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cast' }));
      await waitFor(() => expect(close).toHaveBeenCalled());
      expect((await getLocalDb().characterCombat.get(id))?.currentFp).toBe(2);
      const message = push.mock.calls.at(-1)?.[0] as string;
      expect(message.includes('next turn')).toBe(mage);
      if (mage) {
        expect(message).toContain('restore 3 FP manually');
        expect(message).toContain('If spent on your turn');
      }
      expect(await getLocalDb().outbox.count()).toBe(1);
    },
  );

  it('blocks insufficient initial energy instead of borrowing a future refund', () => {
    render(<CastSpellDialog {...fixture(true, 20, 2, 3)} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cast' })).toBeDisabled();
    expect(screen.getByText('15 more needed')).toBeInTheDocument();
  });

  it.each(['cast', 'maintain'] as const)(
    'groups mixed-resource %s and limits recovery to personal FP',
    async (mode) => {
      const props = fixture(true, 6, 2, 10);
      props.spell.effectiveMaintenanceCost = 6;
      const stone = {
        id: 'stone',
        name: 'Ruby',
        externalLocation: null,
        characterId: id,
        powerstoneData: { currentEnergy: 3, maxEnergy: 3 },
        revision: 1,
      };
      props.character.inventory = [stone] as unknown as CharacterDetail['inventory'];
      await getLocalDb().characterInventory.put(stone as never);
      const close = vi.fn();
      render(<CastSpellDialog {...props} mode={mode} onClose={close} />);
      fireEvent.click(
        screen.getByRole('button', { name: mode === 'cast' ? 'Cast' : 'Pay upkeep' }),
      );
      await waitFor(() => expect(close).toHaveBeenCalled());
      expect(await getLocalDb().characterCombat.get(id)).toMatchObject({
        currentHp: 9,
        currentFp: 0,
      });
      expect((await getLocalDb().characterInventory.get('stone'))?.powerstoneData).toMatchObject({
        currentEnergy: 0,
      });
      if (mode === 'cast') expect(push.mock.calls.at(-1)?.[0]).toContain('restore 2 FP manually');
      else expect(push.mock.calls.at(-1)?.[0]).not.toContain('restore');
      const ops = await getLocalDb().outbox.toArray();
      expect(ops).toHaveLength(3);
      expect(ops.every((op) => typeof op.batchId === 'string')).toBe(true);
      expect(new Set(ops.map((op) => op.batchId)).size).toBe(1);
    },
  );

  it('charges maintenance without a next-turn recovery reminder', async () => {
    const close = vi.fn();
    render(<CastSpellDialog {...fixture()} mode="maintain" onClose={close} />);
    expect(
      screen.getByText(/FP spent maintaining a spell does not recover next turn/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pay upkeep' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect((await getLocalDb().characterCombat.get(id))?.currentFp).toBe(3);
    expect(push.mock.calls.at(-1)?.[0]).not.toContain('restore');
  });

  it('does not generate a refund or operation for a zero discounted cost', async () => {
    const props = fixture();
    props.spell.effectiveCost = 0;
    const close = vi.fn();
    render(<CastSpellDialog {...props} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cast' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(await getLocalDb().outbox.count()).toBe(0);
    expect(push.mock.calls.at(-1)?.[0]).toBe('Cast Light (free).');
  });

  it('repeated casting before the next turn spends remaining FP without an automatic refund', async () => {
    const props = fixture(true, 3, 5, 0);
    const close = vi.fn();
    const view = render(<CastSpellDialog {...props} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cast' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    const combat = await getLocalDb().characterCombat.get(id);
    view.unmount();
    render(
      <CastSpellDialog
        {...props}
        character={{ ...props.character, combat } as CharacterDetail}
        onClose={close}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cast' })).toBeDisabled();
    expect(screen.getByText('1 more needed')).toBeInTheDocument();
    expect(combat?.currentFp).toBe(2);
  });
});
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
