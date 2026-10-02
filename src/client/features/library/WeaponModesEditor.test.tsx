import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { WeaponModesEditor } from './WeaponModesEditor.tsx';

describe('WeaponModesEditor', () => {
  it('creates a weapon, edits stable mode metadata, and preserves the structured YAML', () => {
    const onChange = vi.fn();
    render(<WeaponModesEditor text="" onChange={onChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Weapon or shield' }));
    fireEvent.change(screen.getByLabelText('Stable mode key'), { target: { value: 'thrust' } });
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Thrust' } });
    fireEvent.change(screen.getByLabelText('damage'), { target: { value: 'thr+2 imp' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ranged statistics' }));
    fireEvent.change(screen.getByLabelText('acc'), { target: { value: '3' } });

    const latest = onChange.mock.lastCall?.[0];
    expect(typeof latest).toBe('string');
    expect(parse(latest as string)).toMatchObject({
      modes: [{ key: 'thrust', name: 'Thrust', damage: 'thr+2 imp', ranged: { acc: 3 } }],
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
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Longbow' } });
    expect(screen.getByLabelText('bulk')).toHaveValue('-');

    fireEvent.change(screen.getByLabelText('bulk'), { target: { value: '-6' } });
    expect(parse(onChange.mock.lastCall?.[0] as string)).toMatchObject({
      modes: [{ name: 'Longbow', ranged: { bulk: -6 } }],
    });
  });
});
