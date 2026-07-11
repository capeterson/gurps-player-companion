/**
 * AttacksCard — the vitals/eye hit-location presets are only offered
 * when the weapon's damage can plausibly target them (B399: imp/pi
 * only). A cutting weapon must not offer "Vitals"/"Eye" presets; an
 * impaling or piercing weapon must.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { AttacksCard } from './AttacksCard.tsx';
import type { RollRequest } from './rollTypes.ts';

/** Pull the `presets` array out of an openRoll mock's first call. */
function presetsFrom(openRoll: ReturnType<typeof vi.fn>): readonly { label: string }[] {
  const call = openRoll.mock.calls[0] as [RollRequest] | undefined;
  return call?.[0]?.presets ?? [];
}

function makeCharacter(damage: string): CharacterDetail {
  return {
    id: 'char-1',
    derived: { effectiveSt: 10 },
    skills: [{ id: 's1', name: 'Broadsword', level: 14 }],
    inventory: [
      {
        id: 'w1',
        name: 'Broadsword',
        equipped: true,
        weaponData: { damage, reach: '1', parry: '0', stRequired: null },
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
});
