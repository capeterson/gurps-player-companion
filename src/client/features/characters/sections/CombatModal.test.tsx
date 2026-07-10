/**
 * CombatModal — the full common-condition set (legacy-condition
 * round-trip) and the reeling suggestion, mirroring PoolsCard's tests
 * (see play/PoolsCard.test.tsx) for the same underlying behaviour now
 * that CombatModal shares the same shared/domain/conditions helpers.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { getLocalDb } from '../../../db/dexie.ts';
import { CombatModal } from './CombatModal.tsx';

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000c0a8';

function makeCharacter(
  hpMax: number,
  conditions: string[] = [],
  currentHp = hpMax,
): CharacterDetail {
  return {
    id: CHAR_ID,
    name: 'Test Character',
    derived: { hp: hpMax, fp: 10 },
    combat: { currentHp, currentFp: 10, conditions, posture: 'standing', maneuver: null },
  } as unknown as CharacterDetail;
}

function renderModal(character: CharacterDetail, canWrite = true) {
  return render(
    <MemoryRouter>
      <CombatModal character={character} canWrite={canWrite} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe('CombatModal', () => {
  it('lights the Stunned chip for a legacy Capitalized condition and toggling it off enqueues no stunned variant', async () => {
    renderModal(makeCharacter(10, ['Stunned']));

    const chip = screen.getByRole('button', { name: 'Stunned', pressed: true });
    fireEvent.click(chip);

    const db = getLocalDb();
    await waitFor(async () => {
      const row = await db.characterCombat.get(CHAR_ID);
      expect(row?.conditions).toEqual([]);
    });
    const ops = await db.outbox.toArray();
    const conditionOp = ops.find((o) => o.fieldPath === 'conditions');
    expect(conditionOp?.attemptedValue).toEqual([]);
  });

  it('shows the reeling suggestion when hp drops below 1/3 max and reeling is not set', () => {
    // hpMax=10 -> ceil(10/3)=4; currentHp=2 is below it.
    renderModal(makeCharacter(10, [], 2));
    expect(screen.getByText('Reeling suggested — B419')).toBeInTheDocument();
  });

  it('does not show the reeling suggestion once reeling is already applied', () => {
    renderModal(makeCharacter(10, ['reeling'], 2));
    expect(screen.queryByText('Reeling suggested — B419')).not.toBeInTheDocument();
  });

  it('does not show the reeling suggestion above the 1/3-max threshold', () => {
    renderModal(makeCharacter(10, [], 8));
    expect(screen.queryByText('Reeling suggested — B419')).not.toBeInTheDocument();
  });

  it('shows death-check threshold alongside max/reeling in the HP caption', () => {
    renderModal(makeCharacter(10));
    expect(screen.getByText(/death checks from/)).toBeInTheDocument();
  });

  it('renders all 12 common condition chips', () => {
    renderModal(makeCharacter(10));
    // Spot-check a few ids across the full set that weren't in the old
    // 6-entry hardcoded list.
    expect(screen.getByRole('button', { name: 'Mortally Wounded' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restrained' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pinned' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'On Fire' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Poisoned' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sleeping' })).toBeInTheDocument();
  });
});
