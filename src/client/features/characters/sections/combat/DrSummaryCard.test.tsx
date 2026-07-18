import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('resolves incoming damage through DR and applies injury to HP', () => {
    const bumpHp = vi.fn();
    // Torso DR 4; 12 cut => 8 penetrating × 1.5 = 12 injury.
    render(
      <DrSummaryCard
        character={makeCharacter([{ dr: 4, locations: ['torso'] }])}
        canWrite
        hpMax={10}
        bumpHp={bumpHp}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '12' } });
    // Type defaults to 'cr'; switch to cut for the ×1.5 multiplier.
    const [typeSelect] = screen.getAllByRole('combobox');
    fireEvent.change(typeSelect as HTMLElement, { target: { value: 'cut' } });

    const apply = screen.getByRole('button', { name: /Apply −12 HP/ });
    fireEvent.click(apply);
    expect(bumpHp).toHaveBeenCalledWith(-12);
  });

  it('offers no incoming-damage button without write access', () => {
    render(<DrSummaryCard character={makeCharacter([{ dr: 4, locations: ['torso'] }])} />);
    expect(screen.queryByRole('button', { name: /Incoming damage/ })).not.toBeInTheDocument();
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
