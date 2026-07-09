/**
 * RollSheet — the dice roller. Math.random is mocked so `roll3d6`
 * produces a deterministic result; the modifier stepper and preset
 * chips are exercised through the effective-target display.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RollSheet } from './RollSheet.tsx';
import { __resetRollHistoryForTests } from './rollHistory.ts';
import type { RollRequest } from './rollTypes.ts';

afterEach(() => {
  vi.restoreAllMocks();
  __resetRollHistoryForTests();
});

describe('RollSheet', () => {
  it('rolls 3d6 against the effective target and shows total/margin/crit', () => {
    // Math.random() -> 0 for every die => floor(0*6)+1 = 1,1,1 => total 3,
    // which B556 always calls a critical success regardless of skill.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const request: RollRequest = { label: 'Broadsword', baseTarget: 12 };
    render(<RollSheet request={request} characterId="char-1" onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Roll 3d6' }));

    expect(screen.getByText('3')).toBeInTheDocument(); // total
    expect(screen.getByText(/margin \+9/)).toBeInTheDocument(); // 12 - 3
    expect(screen.getByText('Critical success')).toBeInTheDocument();
  });

  it('the modifier stepper changes the effective target display', () => {
    const request: RollRequest = { label: 'Dodge', baseTarget: 10 };
    render(<RollSheet request={request} characterId="char-1" onClose={() => {}} />);

    expect(screen.getByLabelText('Effective target 10')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Increase modifier'));
    fireEvent.click(screen.getByLabelText('Increase modifier'));
    expect(screen.getByLabelText('Effective target 12')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Effective target 10')).toBeInTheDocument();
  });

  it('a preset chip applies its modifier, and tapping it again clears it', () => {
    const request: RollRequest = {
      label: 'Broadsword',
      baseTarget: 14,
      presets: [
        { label: 'Torso (0)', mod: 0 },
        { label: 'Skull (−7)', mod: -7 },
      ],
    };
    render(<RollSheet request={request} characterId="char-1" onClose={() => {}} />);

    fireEvent.click(screen.getByText('Skull (−7)'));
    expect(screen.getByLabelText('Effective target 7')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Skull (−7)'));
    expect(screen.getByLabelText('Effective target 14')).toBeInTheDocument();
  });
});
