import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { weaponData } from '../../../shared/schemas/inventory.ts';
import { WeaponModesEditor } from './WeaponModesEditor.tsx';

describe('WeaponModesEditor', () => {
  it('duplicates attacks with unique stable keys and preserves the original key when renamed', () => {
    const onChange = vi.fn();
    render(
      <WeaponModesEditor
        text={'modes:\n  - key: original\n    name: Swing\n'}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Attack name, Swing'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate attack Renamed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate attack Renamed' }));
    const result = weaponData.parse(parse(onChange.mock.lastCall?.[0] as string));
    expect(result.modes?.map((mode) => mode.key)).toEqual([
      'original',
      'renamed-copy-2',
      'renamed-copy',
    ]);
    expect(result.modes?.map((mode) => mode.name)).toEqual([
      'Renamed',
      'Renamed copy',
      'Renamed copy',
    ]);
  });
  it('creates a weapon, edits its display name and preserves the stable mode key', () => {
    const onChange = vi.fn();
    render(<WeaponModesEditor text="" onChange={onChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Weapon or shield' }));
    fireEvent.change(screen.getByLabelText('Attack name, Primary'), {
      target: { value: 'Thrust' },
    });
    fireEvent.change(screen.getByLabelText('damage, Thrust'), { target: { value: 'thr+2 imp' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ranged statistics' }));
    fireEvent.change(screen.getByLabelText('acc'), { target: { value: '3' } });

    const latest = onChange.mock.lastCall?.[0];
    expect(typeof latest).toBe('string');
    expect(parse(latest as string)).toMatchObject({
      modes: [{ key: 'primary', name: 'Thrust', damage: 'thr+2 imp', ranged: { acc: 3 } }],
    });
  });

  it('edits imported legacy mode details in the complete typed view', () => {
    const onChange = vi.fn();
    render(
      <WeaponModesEditor
        text={'modes:\n  - key: thrust\n    name: Thrust\n    damage: "thr+2 imp"\n'}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'All weapon fields' }));
    fireEvent.change(screen.getByLabelText('Damage'), { target: { value: 'thr+3 imp' } });
    expect(parse(onChange.mock.lastCall?.[0] as string)).toMatchObject({
      modes: [{ key: 'thrust', name: 'Thrust', damage: 'thr+3 imp' }],
    });
  });

  it('retains an incomplete bulk draft through another edit, then parses the completed number', () => {
    const onChange = vi.fn();
    render(<WeaponModesEditor text="" onChange={onChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Weapon or shield' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ranged statistics' }));
    fireEvent.change(screen.getByLabelText('bulk'), { target: { value: '-' } });
    fireEvent.change(screen.getByLabelText('Attack name, Primary'), {
      target: { value: 'Longbow' },
    });
    expect(screen.getByLabelText('bulk')).toHaveValue('-');

    fireEvent.change(screen.getByLabelText('bulk'), { target: { value: '-6' } });
    expect(parse(onChange.mock.lastCall?.[0] as string)).toMatchObject({
      modes: [{ name: 'Longbow', ranged: { bulk: -6 } }],
    });
  });
});
