import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { DrSummaryCard } from './DrSummaryCard.tsx';

function makeCharacter(armor: Array<{ dr: number; locations: string[] }>): CharacterDetail {
  return {
    id: 'char-1',
    inventory: armor.map((a, i) => ({
      id: `a${i}`,
      name: `Armor ${i}`,
      equipped: true,
      isArmor: true,
      armor: {
        locations: a.locations,
        dr: a.dr,
        drCrushing: null,
        flexible: false,
        frontOnly: false,
        backOnly: false,
        notes: null,
      },
      weaponData: null,
    })),
  } as unknown as CharacterDetail;
}

describe('DrSummaryCard', () => {
  it('shows empty state when no equipped armor exists', () => {
    render(<DrSummaryCard character={{ id: 'c', inventory: [] } as unknown as CharacterDetail} />);
    expect(screen.getByText(/No equipped armor/i)).toBeInTheDocument();
  });

  it('aggregates and displays DR per hit location', () => {
    render(
      <DrSummaryCard
        character={makeCharacter([
          { dr: 2, locations: ['torso'] },
          { dr: 3, locations: ['torso', 'arm_left'] },
        ])}
      />,
    );
    expect(screen.getByText('Torso')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Left Arm')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('skips unequipped armor', () => {
    const character = {
      id: 'c',
      inventory: [
        {
          id: 'a0',
          name: 'Unequipped',
          equipped: false,
          isArmor: true,
          armor: {
            locations: ['torso'],
            dr: 10,
            drCrushing: null,
            flexible: false,
            frontOnly: false,
            backOnly: false,
            notes: null,
          },
          weaponData: null,
        },
      ],
    } as unknown as CharacterDetail;
    render(<DrSummaryCard character={character} />);
    expect(screen.getByText(/No equipped armor/i)).toBeInTheDocument();
  });
});
