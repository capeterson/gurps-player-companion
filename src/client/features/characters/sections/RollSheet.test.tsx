/**
 * RollSheet — the dice roller. Math.random is mocked so `roll3d6`
 * produces a deterministic result; the modifier stepper and preset
 * chips are exercised through the effective-target display.
 */

import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RollHistoryStrip } from './RollHistoryStrip.tsx';
import { RollSheet } from './RollSheet.tsx';
import { __resetRollHistoryForTests, useRollHistory } from './rollHistory.ts';
import type { RollRequest } from './rollTypes.ts';

afterEach(() => {
  vi.restoreAllMocks();
  __resetRollHistoryForTests();
});

describe('RollSheet', () => {
  it.each([
    ['very_high', 0.5, 10, 'failure', 'turns this failure into a critical failure'],
    ['very_high', 0.99, 10, 'failure', 'spectacular disaster'],
    ['normal', 0.5, 10, null, null],
    ['very_high', 0, 10, 'success', null],
  ] as const)(
    'resolves and records spell outcomes in %s mana (dice %s)',
    (mana, random, target, crit, notice) => {
      vi.spyOn(Math, 'random').mockReturnValue(random);
      const view = render(
        <RollSheet
          request={{ label: 'Light', baseTarget: target, spellManaLevel: mana }}
          characterId="mage"
          onClose={() => {}}
        />,
      );
      const history = renderHook(() => useRollHistory('mage'));
      fireEvent.click(screen.getByRole('button', { name: 'Roll 3d6' }));
      expect(history.result.current[0]?.crit).toBe(crit);
      expect(history.result.current[0]?.manaDisaster).toBe(notice === 'spectacular disaster');
      if (notice) expect(screen.getByText(new RegExp(notice))).toBeInTheDocument();
      else expect(screen.queryByText(/Very high mana/)).not.toBeInTheDocument();
      const stored = localStorage.getItem('gurps:rollHistory:mage');
      if (!stored) throw new Error('Missing persisted roll');
      view.unmount();
      history.unmount();
      __resetRollHistoryForTests();
      localStorage.setItem('gurps:rollHistory:mage', stored);
      render(<RollHistoryStrip characterId="mage" />);
      expect(Boolean(screen.queryByText('disaster'))).toBe(notice === 'spectacular disaster');
      if (notice === 'spectacular disaster')
        expect(screen.getByText('disaster')).toHaveAttribute(
          'title',
          'Very high mana: critical failure and spectacular disaster',
        );
      else if (crit === 'failure') expect(screen.getByText('crit fail')).toBeInTheDocument();
    },
  );

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
    expect(screen.getByText('vs 12')).toBeInTheDocument(); // rolled-against target
  });

  it('clears the result when the modifier changes after a roll', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const request: RollRequest = { label: 'Broadsword', baseTarget: 12 };
    render(<RollSheet request={request} characterId="char-1" onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Roll 3d6' }));
    expect(screen.getByText('vs 12')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Increase modifier'));

    expect(screen.queryByText('vs 12')).not.toBeInTheDocument();
    expect(screen.queryByText('Critical success')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Roll 3d6' })).toBeInTheDocument();
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

  it('allows a range-penalty preset deeper than −10 without clamping', () => {
    const request: RollRequest = {
      label: 'Longbow',
      baseTarget: 14,
      presets: [{ label: '150 yd (−11)', mod: -11 }],
    };
    render(<RollSheet request={request} characterId="char-1" onClose={() => {}} />);

    fireEvent.click(screen.getByText('150 yd (−11)'));
    expect(screen.getByLabelText('Effective target 3')).toBeInTheDocument();
  });

  it('rolls damage dice when the request carries a damage payload', () => {
    // Math.random() -> 0 => every die shows 1; 2d+1 => 1+1+1 = 3.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const request: RollRequest = {
      label: 'Broadsword damage',
      baseTarget: 0,
      damage: { dice: { dice: 2, adds: 1 }, damageType: 'cut', armorDivisor: null },
    };
    render(<RollSheet request={request} characterId="char-1" onClose={() => {}} />);

    expect(screen.getByLabelText('Damage formula 2d+1 cut')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Roll 2d+1' }));

    expect(screen.getByText('3')).toBeInTheDocument(); // total
    expect(screen.getByText('2d+1 cut')).toBeInTheDocument(); // rolled-with formula
    // No success/failure verdict on a damage roll.
    expect(screen.queryByText(/margin/)).not.toBeInTheDocument();
  });

  it('damage steppers adjust the flat adds and enforce the cut/imp minimum', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const request: RollRequest = {
      label: 'Dagger damage',
      baseTarget: 0,
      damage: { dice: { dice: 1, adds: -4 }, damageType: 'imp', armorDivisor: null },
    };
    render(<RollSheet request={request} characterId="char-1" onClose={() => {}} />);

    // 1d-4 rolling a 1 => raw -3, floored to the imp minimum of 1 (B378).
    // Both the single die face and the clamped total render "1".
    fireEvent.click(screen.getByRole('button', { name: 'Roll 1d-4' }));
    expect(screen.getAllByText('1')).toHaveLength(2);

    // +1 add: formula becomes 1d-3 and the stale result clears.
    fireEvent.click(screen.getByLabelText('Increase damage adds'));
    expect(screen.getByLabelText('Damage formula 1d-3 imp')).toBeInTheDocument();
    expect(screen.queryByText('1d-4 imp')).not.toBeInTheDocument();
  });
});
