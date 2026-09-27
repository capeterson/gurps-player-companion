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

  it('preserves imported YAML in advanced mode and emits edits without reshaping them', () => {
    const onChange = vi.fn();
    render(
      <WeaponModesEditor
        text={'modes:\n  - key: thrust\n    name: Thrust\n    damage: "thr+2 imp"\n'}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit weapon YAML' }));
    const editor = screen.getByLabelText('Weapon modes (YAML)');
    const edited = 'modes:\n  - key: thrust\n    name: Thrust\n    damage: "thr+3 imp"\n';
    fireEvent.change(editor, { target: { value: edited } });
    expect(onChange).toHaveBeenLastCalledWith(edited);
    expect(screen.getByLabelText('Weapon modes (YAML)')).toHaveValue(
      'modes:\n  - key: thrust\n    name: Thrust\n    damage: "thr+2 imp"\n',
    );
  });
});
