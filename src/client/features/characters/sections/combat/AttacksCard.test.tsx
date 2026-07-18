/**
 * AttacksCard — the vitals/eye hit-location presets are only offered
 * when the weapon's damage can plausibly target them (B399: imp/pi
 * only). A cutting weapon must not offer "Vitals"/"Eye" presets; an
 * impaling or piercing weapon must.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import type { RollRequest } from '../rollTypes.ts';
import { AttacksCard } from './AttacksCard.tsx';

/** Pull the `presets` array out of an openRoll mock's first call. */
function presetsFrom(openRoll: ReturnType<typeof vi.fn>): readonly { label: string }[] {
  const call = openRoll.mock.calls[0] as [RollRequest] | undefined;
  return call?.[0]?.presets ?? [];
}

interface WeaponOverrides {
  readonly name?: string;
  readonly skill?: string | null;
  readonly stRequired?: number | null;
  readonly ranged?: Record<string, unknown> | null;
}

function makeCharacter(damage: string, overrides: WeaponOverrides = {}): CharacterDetail {
  return {
    id: 'char-1',
    derived: { effectiveSt: 10 },
    skills: [{ id: 's1', name: 'Broadsword', level: 14 }],
    inventory: [
      {
        id: 'w1',
        name: overrides.name ?? 'Broadsword',
        equipped: true,
        weaponData: {
          damage,
          reach: '1',
          parry: '0',
          stRequired: overrides.stRequired ?? null,
          skill: overrides.skill ?? null,
          ranged: overrides.ranged ?? null,
        },
      },
    ],
  } as unknown as CharacterDetail;
}

describe('AttacksCard', () => {
  it('excludes Vitals/Eye presets for a cutting-only weapon (B399)', () => {
    const openRoll = vi.fn();
    render(<AttacksCard character={makeCharacter('sw+1 cut')} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    const presets = presetsFrom(openRoll);
    expect(presets.some((p: { label: string }) => p.label.startsWith('Vitals'))).toBe(false);
    expect(presets.some((p: { label: string }) => p.label.startsWith('Eye'))).toBe(false);
    // Other locations remain available.
    expect(presets.some((p: { label: string }) => p.label.startsWith('Torso'))).toBe(true);
  });

  it('includes Vitals/Eye presets for an impaling weapon (B399)', () => {
    const openRoll = vi.fn();
    render(<AttacksCard character={makeCharacter('thr imp')} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    const presets = presetsFrom(openRoll);
    expect(presets.some((p: { label: string }) => p.label.startsWith('Vitals'))).toBe(true);
    expect(presets.some((p: { label: string }) => p.label.startsWith('Eye'))).toBe(true);
  });

  it('includes Vitals/Eye presets for a piercing weapon (B399)', () => {
    const openRoll = vi.fn();
    render(<AttacksCard character={makeCharacter('1d(2) pi+')} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    const presets = presetsFrom(openRoll);
    expect(presets.some((p: { label: string }) => p.label.startsWith('Vitals'))).toBe(true);
  });

  it('keeps the full preset list for unparseable homebrew damage text', () => {
    const openRoll = vi.fn();
    render(<AttacksCard character={makeCharacter('special')} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    const presets = presetsFrom(openRoll);
    expect(presets.some((p: { label: string }) => p.label.startsWith('Vitals'))).toBe(true);
  });

  it('an explicit skill binding beats the fuzzy name match', () => {
    const openRoll = vi.fn();
    // 'Excalibur' would never fuzzy-match 'Broadsword'; the explicit
    // binding must resolve it and roll at the bound skill's level.
    const character = makeCharacter('sw+1 cut', { name: 'Excalibur', skill: 'Broadsword' });
    render(<AttacksCard character={character} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    const call = openRoll.mock.calls[0] as [RollRequest];
    expect(call[0].baseTarget).toBe(14);
  });

  it('an explicitly bound skill missing from the sheet shows a hint, not a roll', () => {
    const openRoll = vi.fn();
    const character = makeCharacter('sw+1 cut', { name: 'Katana', skill: 'Katana' });
    render(<AttacksCard character={character} openRoll={openRoll} />);

    expect(screen.getByText(/Skill 'Katana' not on sheet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Katana\b.*\d/ })).not.toBeInTheDocument();
  });

  it('subtracts the ST shortfall from the roll target (B270)', () => {
    const openRoll = vi.fn();
    // stRequired 12 vs effective ST 10 => −2; Broadsword 14 rolls at 12.
    const character = makeCharacter('sw+1 cut', { stRequired: 12 });
    render(<AttacksCard character={character} openRoll={openRoll} />);

    expect(screen.getByText('ST 12 (−2)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    const call = openRoll.mock.calls[0] as [RollRequest];
    expect(call[0].baseTarget).toBe(12);
  });

  it('a ranged weapon offers Aim and range-penalty presets', () => {
    const openRoll = vi.fn();
    const character = makeCharacter('1d+1 imp', {
      ranged: { acc: 3, range: '100/150', rof: '1', shots: null, bulk: null, recoil: null },
    });
    render(<AttacksCard character={character} openRoll={openRoll} />);

    // Stat line renders from present fields only.
    expect(screen.getByText('Acc 3 · 100/150 · RoF 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    const presets = presetsFrom(openRoll);
    expect(presets.some((p) => p.label === 'Aim (+3)')).toBe(true);
    expect(presets.some((p) => p.label === '10 yd (−4)')).toBe(true);
    expect(presets.some((p) => p.label === '150 yd (−11)')).toBe(true);
    // Hit locations still follow the range presets.
    expect(presets.some((p) => p.label.startsWith('Torso'))).toBe(true);
  });

  it('a damage chip opens a damage roll with resolved dice', () => {
    const openRoll = vi.fn();
    // sw at ST 10 = 1d; sw+1 cut => 1d+1 cut.
    render(<AttacksCard character={makeCharacter('sw+1 cut')} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: '1d+1 cut' }));
    const call = openRoll.mock.calls[0] as [RollRequest];
    expect(call[0].label).toBe('Broadsword damage');
    expect(call[0].damage).toEqual({
      dice: { dice: 1, adds: 1 },
      damageType: 'cut',
      armorDivisor: null,
    });
  });
});
