/**
 * DefensesCard — shield Defense Bonus flows into Dodge/Parry/Block from
 * an equipped shield item, armor DB (Deflect enchantments) stacks on
 * top of it, Block is gated on that equipped shield (not a bare skill),
 * the ST shortfall lowers Parry, and 'No' parry weapons render a
 * non-rollable row.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import type { RollRequest } from '../rollTypes.ts';
import { DefensesCard } from './DefensesCard.tsx';

interface WeaponItem {
  readonly id: string;
  readonly name: string;
  readonly equipped?: boolean;
  readonly parry?: string | null;
  readonly skill?: string | null;
  readonly db?: number | null;
  readonly stRequired?: number | null;
}

interface ArmorItem {
  readonly id: string;
  readonly name: string;
  readonly equipped?: boolean;
  /** armor.db — Defense Bonus from Deflect enchantments. */
  readonly db?: number | null;
}

interface Skill {
  readonly name: string;
  readonly level: number;
}

function makeCharacter(
  items: WeaponItem[],
  skills: Skill[],
  armorItems: ArmorItem[] = [],
): CharacterDetail {
  const weaponRows = items.map((it) => ({
    id: it.id,
    name: it.name,
    equipped: it.equipped ?? true,
    weaponData: {
      damage: '',
      reach: '1',
      parry: it.parry ?? null,
      stRequired: it.stRequired ?? null,
      skill: it.skill ?? null,
      db: it.db ?? null,
      ranged: null,
    },
  }));
  const armorRows = armorItems.map((a) => ({
    id: a.id,
    name: a.name,
    equipped: a.equipped ?? true,
    isArmor: true,
    armor: {
      locations: ['torso'],
      dr: 4,
      drCrushing: null,
      typedDr: {},
      flexible: false,
      frontOnly: false,
      backOnly: false,
      db: a.db ?? null,
      notes: null,
    },
    weaponData: null,
  }));
  return {
    id: 'char-1',
    derived: { dodge: 9, basicMove: 5, effectiveSt: 10 },
    encumbrance: { dodgePenalty: 0, moveMultiplier: 1, label: 'None', ratio: 1 },
    skills: skills.map((s, i) => ({ id: `s${i}`, name: s.name, level: s.level })),
    inventory: [...weaponRows, ...armorRows],
  } as unknown as CharacterDetail;
}

/** Read the baseTarget from a RollableRow by clicking it and inspecting openRoll. */
function targetFor(openRoll: ReturnType<typeof vi.fn>, index: number): number {
  const call = openRoll.mock.calls[index] as [RollRequest];
  return call[0].baseTarget;
}

describe('DefensesCard', () => {
  it('adds shield DB to Dodge, Parry, and Block', () => {
    const openRoll = vi.fn();
    const character = makeCharacter(
      [
        { id: 'w1', name: 'Broadsword', parry: '0', skill: 'Broadsword' },
        { id: 'sh', name: 'Medium Shield', db: 2, skill: 'Shield' },
      ],
      [
        { name: 'Broadsword', level: 14 },
        { name: 'Shield', level: 12 },
      ],
    );
    render(<DefensesCard character={character} openRoll={openRoll} />);

    // Dodge 9 + 2 DB = 11.
    fireEvent.click(screen.getByRole('button', { name: /Dodge/ }));
    expect(targetFor(openRoll, 0)).toBe(11);

    // Parry = floor(14/2)+3 + 0 mod + 2 DB = 12.
    fireEvent.click(screen.getByRole('button', { name: /Parry \(Broadsword\)/ }));
    expect(targetFor(openRoll, 1)).toBe(12);

    // Block = floor(12/2)+3 + 2 DB = 11.
    fireEvent.click(screen.getByRole('button', { name: /Block \(Medium Shield\)/ }));
    expect(targetFor(openRoll, 2)).toBe(11);
  });

  it('shows a Block row only when an actual shield is equipped', () => {
    const openRoll = vi.fn();
    // A Shield skill but no shield item => no Block row (RAW: you block
    // with a shield, not a skill alone).
    const character = makeCharacter(
      [{ id: 'w1', name: 'Broadsword', parry: '0', skill: 'Broadsword' }],
      [
        { name: 'Broadsword', level: 14 },
        { name: 'Shield', level: 12 },
      ],
    );
    render(<DefensesCard character={character} openRoll={openRoll} />);
    expect(screen.queryByRole('button', { name: /Block/ })).not.toBeInTheDocument();
  });

  it('hints when an equipped shield has no usable Shield skill', () => {
    const openRoll = vi.fn();
    const character = makeCharacter(
      [{ id: 'sh', name: 'Buckler', db: 1, skill: 'Shield (Buckler)' }],
      [{ name: 'Broadsword', level: 14 }],
    );
    render(<DefensesCard character={character} openRoll={openRoll} />);
    expect(
      screen.getByText(/Buckler is equipped but has no usable Shield skill/),
    ).toBeInTheDocument();
    expect(screen.getByText(/skill 'Shield \(Buckler\)' is not on the sheet/)).toBeInTheDocument();
  });

  it('renders a non-rollable row for a "No" parry weapon', () => {
    const openRoll = vi.fn();
    const character = makeCharacter(
      [{ id: 'w1', name: 'Musket', parry: 'No', skill: 'Guns' }],
      [{ name: 'Guns', level: 12 }],
    );
    render(<DefensesCard character={character} openRoll={openRoll} />);

    expect(screen.queryByRole('button', { name: /Parry \(Musket\)/ })).not.toBeInTheDocument();
    expect(screen.getByText('Parry (Musket)')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('lowers Parry by the ST shortfall before halving (B270)', () => {
    const openRoll = vi.fn();
    // stRequired 12 vs ST 10 => −2 to skill: 14 → 12; Parry = floor(12/2)+3 = 9.
    const character = makeCharacter(
      [{ id: 'w1', name: 'Greatsword', parry: '0', skill: 'Two-Handed Sword', stRequired: 12 }],
      [{ name: 'Two-Handed Sword', level: 14 }],
    );
    render(<DefensesCard character={character} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Parry \(Greatsword\)/ }));
    expect(targetFor(openRoll, 0)).toBe(9);
  });

  it('adds armor DB to Dodge, Parry, and Block (no shield)', () => {
    const openRoll = vi.fn();
    const character = makeCharacter(
      [{ id: 'w1', name: 'Broadsword', parry: '0', skill: 'Broadsword' }],
      [{ name: 'Broadsword', level: 14 }],
      [{ id: 'a1', name: 'Deflect Hauberk', db: 1 }],
    );
    render(<DefensesCard character={character} openRoll={openRoll} />);

    // Dodge 9 + 1 armor DB = 10.
    fireEvent.click(screen.getByRole('button', { name: /Dodge/ }));
    expect(targetFor(openRoll, 0)).toBe(10);

    // Parry = floor(14/2)+3 + 0 mod + 1 armor DB = 11.
    fireEvent.click(screen.getByRole('button', { name: /Parry \(Broadsword\)/ }));
    expect(targetFor(openRoll, 1)).toBe(11);

    // The Dodge caption names the armor source.
    expect(screen.getByText('+ 1 armor DB')).toBeInTheDocument();
  });

  it('stacks armor DB with shield DB on Dodge, Parry, and Block', () => {
    const openRoll = vi.fn();
    const character = makeCharacter(
      [
        { id: 'w1', name: 'Broadsword', parry: '0', skill: 'Broadsword' },
        { id: 'sh', name: 'Medium Shield', db: 2, skill: 'Shield' },
      ],
      [
        { name: 'Broadsword', level: 14 },
        { name: 'Shield', level: 12 },
      ],
      [{ id: 'a1', name: 'Deflect Breastplate', db: 1 }],
    );
    render(<DefensesCard character={character} openRoll={openRoll} />);

    // Dodge 9 + 2 shield DB + 1 armor DB = 12.
    fireEvent.click(screen.getByRole('button', { name: /Dodge/ }));
    expect(targetFor(openRoll, 0)).toBe(12);

    // Parry = floor(14/2)+3 + 0 mod + 3 total DB = 13.
    fireEvent.click(screen.getByRole('button', { name: /Parry \(Broadsword\)/ }));
    expect(targetFor(openRoll, 1)).toBe(13);

    // Block = floor(12/2)+3 + 3 total DB = 12.
    fireEvent.click(screen.getByRole('button', { name: /Block \(Medium Shield\)/ }));
    expect(targetFor(openRoll, 2)).toBe(12);

    // The Dodge caption names both sources in the breakdown.
    expect(screen.getByText('+ 2 DB (Medium Shield) + 1 armor DB')).toBeInTheDocument();
  });

  it('ignores armor DB on unequipped armor', () => {
    const openRoll = vi.fn();
    const character = makeCharacter(
      [{ id: 'w1', name: 'Broadsword', parry: '0', skill: 'Broadsword' }],
      [{ name: 'Broadsword', level: 14 }],
      [{ id: 'a1', name: 'Deflect Hauberk', db: 1, equipped: false }],
    );
    render(<DefensesCard character={character} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Dodge/ }));
    expect(targetFor(openRoll, 0)).toBe(9);
    expect(screen.queryByText(/armor DB/)).not.toBeInTheDocument();
  });
});
