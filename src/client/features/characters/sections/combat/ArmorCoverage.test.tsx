import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { DrSummaryCard } from './DrSummaryCard.tsx';

function character(): CharacterDetail {
  return {
    id: 'armor-test',
    effects: [],
    inventory: [
      {
        id: 'mail',
        name: 'Mail',
        equipped: true,
        isArmor: true,
        armor: {
          dr: 4,
          drCrushing: 2,
          typedDr: { cut: 7, imp: 3, burn: 4 },
          locations: ['torso', 'vitals', 'tail'],
        },
      },
      {
        id: 'padding',
        name: 'Padding',
        equipped: true,
        isArmor: true,
        armor: { dr: 2, drCrushing: null, typedDr: {}, locations: ['torso', 'vitals'] },
      },
    ],
  } as unknown as CharacterDetail;
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function openDamage() {
  fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
  return within(screen.getByRole('dialog', { hidden: true }));
}

describe('Armor map integration', () => {
  it('selects every zone by keyboard and retains custom locations in the picker', () => {
    const { container } = render(<DrSummaryCard character={character()} />);
    const shapes = container.querySelectorAll('path[data-location]');
    expect(shapes).toHaveLength(15);
    for (const shape of shapes) {
      fireEvent.keyDown(shape, { key: 'Enter' });
      expect(screen.getByLabelText('Hit location')).toHaveValue(
        shape.getAttribute('data-location'),
      );
      expect(shape).toHaveAttribute('aria-pressed', 'true');
    }
    change('Hit location', 'tail');
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('2');
  });

  it('uses typed and crushing contributions per layer before dividing the total', () => {
    render(<DrSummaryCard character={character()} />);
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('4');
    change('Damage type', 'cut');
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('9');
    change('Armor penetration', '2');
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('4');
    change('Damage type', 'imp');
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('2');
    expect(screen.getAllByRole('button', { name: 'Torso, DR 2' })).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Protection layers' })).toHaveTextContent('3 DR');
  });

  it.each(['2', '3', '5', '10', '100', 'ignore'])(
    'passes map choices into the dialog and applies vitals injury after penetration %s',
    (divisor) => {
      const bumpHp = vi.fn();
      render(<DrSummaryCard character={character()} canWrite hpMax={10} bumpHp={bumpHp} />);
      change('Hit location', 'vitals');
      change('Damage type', 'imp');
      change('Armor penetration', divisor);
      const expectedDr = divisor === 'ignore' ? 0 : Math.floor(5 / Number(divisor));
      expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent(String(expectedDr));
      const dialog = openDamage();
      expect(dialog.getByLabelText('Hit location')).toHaveValue('vitals');
      expect(dialog.getByLabelText('Type')).toHaveValue('imp');
      expect(dialog.getByLabelText('Armor divisor')).toHaveValue(divisor);
      fireEvent.change(dialog.getByLabelText('Basic damage'), { target: { value: '10' } });
      fireEvent.click(dialog.getByRole('button', { name: `Apply −${(10 - expectedDr) * 3} HP` }));
      expect(bumpHp).toHaveBeenCalledWith(-(10 - expectedDr) * 3);
      expect(openDamage().getByLabelText('Basic damage')).toHaveValue('');
    },
  );

  it('uses burning DR and the tight-beam vitals multiplier', () => {
    render(<DrSummaryCard character={character()} canWrite hpMax={10} bumpHp={vi.fn()} />);
    change('Hit location', 'vitals');
    change('Damage type', 'burn_tight');
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('6');
    const dialog = openDamage();
    fireEvent.change(dialog.getByLabelText('Basic damage'), { target: { value: '10' } });
    expect(dialog.getByRole('button', { name: 'Apply −8 HP' })).toBeEnabled();
  });

  it('retains invalid input and blocks submission rather than treating a bad divisor as normal DR', () => {
    const bumpHp = vi.fn();
    render(<DrSummaryCard character={character()} canWrite hpMax={10} bumpHp={bumpHp} />);
    const dialog = openDamage();
    fireEvent.change(dialog.getByLabelText('Basic damage'), { target: { value: 'Infinity' } });
    expect(dialog.getByLabelText('Basic damage')).toHaveValue('Infinity');
    expect(dialog.getByRole('button', { name: /Apply/ })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText('Basic damage'), { target: { value: '10' } });
    fireEvent.change(dialog.getByLabelText('Armor divisor'), { target: { value: '__custom' } });
    fireEvent.change(dialog.getByLabelText('Custom armor divisor'), { target: { value: '-2' } });
    expect(dialog.getByRole('alert')).toHaveTextContent('positive armor divisor');
    const apply = dialog.getByRole('button', { name: /Apply/ });
    expect(apply).toBeDisabled();
    fireEvent.submit(apply.closest('form') as HTMLFormElement);
    expect(bumpHp).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText('Custom armor divisor'), { target: { value: '(2)' } });
    expect(dialog.getByRole('button', { name: /Apply/ })).toBeEnabled();
  });
});
