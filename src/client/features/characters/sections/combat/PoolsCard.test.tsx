/**
 * PoolsCard — the reeling suggestion and legacy-condition round-trip.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import type { PoolBumpers } from '../usePoolBumpers.ts';
import { PoolsCard } from './PoolsCard.tsx';

function makeCharacter(hpMax: number, conditions: string[] = []): CharacterDetail {
  return {
    id: 'char-1',
    derived: { hp: hpMax, fp: 10 },
    combat: { currentHp: hpMax, currentFp: 10, conditions, posture: 'standing', maneuver: null },
  } as unknown as CharacterDetail;
}

function makeBumpers(hp: number, hpMax: number): PoolBumpers {
  return {
    hp,
    fp: 10,
    hpMax,
    fpMax: 10,
    bumpHp: vi.fn(),
    bumpFp: vi.fn(),
    resetHp: vi.fn(),
    resetFp: vi.fn(),
    flashHp: false,
  };
}

describe('PoolsCard', () => {
  it('shows the reeling suggestion when hp drops below 1/3 max and reeling is not set', () => {
    // hpMax=10 -> ceil(10/3)=4; hp=2 is below it.
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    render(
      <PoolsCard
        character={makeCharacter(10)}
        canWrite={true}
        patchCombat={patchCombat}
        bumpers={makeBumpers(2, 10)}
      />,
    );
    expect(screen.getByText('Reeling suggested — B419')).toBeInTheDocument();
  });

  it('does not show the reeling suggestion once reeling is already applied', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    render(
      <PoolsCard
        character={makeCharacter(10, ['reeling'])}
        canWrite={true}
        patchCombat={patchCombat}
        bumpers={makeBumpers(2, 10)}
      />,
    );
    expect(screen.queryByText('Reeling suggested — B419')).not.toBeInTheDocument();
  });

  it('does not show the reeling suggestion above the 1/3-max threshold', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    render(
      <PoolsCard
        character={makeCharacter(10)}
        canWrite={true}
        patchCombat={patchCombat}
        bumpers={makeBumpers(8, 10)}
      />,
    );
    expect(screen.queryByText('Reeling suggested — B419')).not.toBeInTheDocument();
  });

  it('toggling a legacy Capitalized condition off enqueues an array with no stunned variant', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    render(
      <PoolsCard
        character={makeCharacter(10, ['Stunned'])}
        canWrite={true}
        patchCombat={patchCombat}
        bumpers={makeBumpers(10, 10)}
      />,
    );

    // The legacy 'Stunned' entry normalizes to 'stunned' and shows active.
    const chip = screen.getByRole('button', { name: 'Stunned', pressed: true });
    fireEvent.click(chip);

    expect(patchCombat).toHaveBeenCalledWith('conditions', []);
  });
});
