import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { PlayerCharacterQuickActions } from './PlayerCharacterQuickActions.tsx';

const patchCombat = vi.fn();
const bumpHp = vi.fn();
const bumpFp = vi.fn();
const toggle = vi.fn();
const character = { id: 'pc-1' } as CharacterDetail;
let access = { isOwner: true, canWrite: true, isMinimal: false };

vi.mock('../characters/useCharacterDetail.ts', () => ({ useCharacterDetail: () => character }));
vi.mock('../characters/useCharacterAccess.ts', () => ({ useCharacterAccessLocal: () => access }));
vi.mock('../characters/sections/useCombatPatch.ts', () => ({ useCombatPatch: () => patchCombat }));
vi.mock('../characters/sections/usePoolBumpers.ts', () => ({
  usePoolBumpers: () => ({ bumpHp, bumpFp }),
}));
vi.mock('../characters/sections/useConditionsToggle.ts', () => ({
  useConditionsToggle: () => ({ conditions: [], toggle }),
}));

describe('PlayerCharacterQuickActions', () => {
  it('uses character combat hooks for the owner actions', () => {
    access = { isOwner: true, canWrite: true, isMinimal: false };
    render(<PlayerCharacterQuickActions characterId="pc-1" meId="me" />);

    fireEvent.click(screen.getByRole('button', { name: 'HP -1' }));
    fireEvent.click(screen.getByRole('button', { name: 'FP +1' }));
    const quickActions = screen.getByText('Your sheet').parentElement;
    if (!quickActions) throw new Error('Quick actions container missing');
    fireEvent.click(within(quickActions).getByRole('button', { name: 'Stunned' }));

    expect(bumpHp).toHaveBeenCalledWith(-1);
    expect(bumpFp).toHaveBeenCalledWith(1);
    expect(toggle).toHaveBeenCalledWith('stunned');
  });

  it('does not expose controls through the share gate', () => {
    access = { isOwner: false, canWrite: false, isMinimal: true };
    render(<PlayerCharacterQuickActions characterId="pc-1" meId="viewer" />);
    expect(screen.queryByText('Your sheet')).not.toBeInTheDocument();
  });
});
