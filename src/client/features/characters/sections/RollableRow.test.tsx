import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RollableRow } from './RollableRow.tsx';

describe('RollableRow', () => {
  it('tapping the row calls openRoll with the label, target, and presets', () => {
    const openRoll = vi.fn();
    const presets = [{ label: 'Skull (−7)', mod: -7 }];
    render(
      <RollableRow label="Broadsword" baseTarget={14} presets={presets} openRoll={openRoll} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    expect(openRoll).toHaveBeenCalledWith({ label: 'Broadsword', baseTarget: 14, presets });
  });

  it('shows the target number regardless of write access — rolling never mutates synced state', () => {
    const openRoll = vi.fn();
    render(<RollableRow label="Dodge" baseTarget={9} openRoll={openRoll} />);
    expect(screen.getByText('9')).toBeInTheDocument();
  });
});
