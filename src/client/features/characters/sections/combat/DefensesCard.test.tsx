/**
 * DefensesCard — shield Defense Bonus flows into Dodge/Parry/Block from
 * an equipped shield item, the highest location-aware armor DB stacks on
 * top of the shield once, Block is gated on that equipped shield (not a bare skill),
 * the ST shortfall lowers Parry, and 'No' parry weapons render a
 * non-rollable row.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterAttrs } from '../../../../../shared/domain/characterCalc.ts';
import { applyEffectsToAttrs, resolveEffects } from '../../../../../shared/domain/traitEffects.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import type { RollRequest } from '../rollTypes.ts';
import { AttacksCard } from './AttacksCard.tsx';
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
  readonly locations?: string[];
  readonly frontOnly?: boolean;
  readonly backOnly?: boolean;
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
      locations: a.locations ?? ['torso'],
      dr: 4,
      drCrushing: null,
      typedDr: {},
      flexible: false,
      frontOnly: a.frontOnly ?? false,
      backOnly: a.backOnly ?? false,
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
  it('applies weapon-scoped Parry and Block only to their matched items', () => {
    const character = makeCharacter(
      [
        { id: 'sword', name: 'Broadsword', parry: '0', skill: 'Broadsword' },
        { id: 'saber', name: 'Saber', parry: '0', skill: 'Broadsword' },
        { id: 'shield', name: 'Shield', db: 0, skill: 'Shield' },
      ],
      [
        { name: 'Broadsword', level: 14 },
        { name: 'Shield', level: 14 },
      ],
    );
    character.effects = [
      {
        sourceKind: 'trait',
        sourceName: 'Weapon Bond',
        sourceId: '11111111-1111-4111-8111-111111111111',
        target: 'weapon_parry',
        value: 1,
        active: true,
        weaponSelector: {
          kind: 'inventory_item',
          inventoryItemId: '11111111-1111-4111-8111-111111111111',
        },
        matchedInventoryItemIds: ['sword'],
        weaponMatchStatus: 'one',
      },
      {
        sourceKind: 'trait',
        sourceName: 'Shield Mastery',
        sourceId: '22222222-2222-4222-8222-222222222222',
        target: 'weapon_block',
        value: 2,
        active: true,
        weaponSelector: { kind: 'weapon_name', weaponName: 'Shield' },
        matchedInventoryItemIds: ['shield'],
        weaponMatchStatus: 'one',
      },
    ];
    const openRoll = vi.fn();
    render(<DefensesCard character={character} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Parry \(Broadsword\)/ }));
    expect(targetFor(openRoll, 0)).toBe(11);
    fireEvent.click(screen.getByRole('button', { name: /Parry \(Saber\)/ }));
    expect(targetFor(openRoll, 1)).toBe(10);
    fireEvent.click(screen.getByRole('button', { name: /Block \(Shield\)/ }));
    expect(targetFor(openRoll, 2)).toBe(12);
    expect(screen.getAllByText('Weapon Bond').length).toBeGreaterThan(0);
  });

  it.each(['All-Out Attack', 'Move and Attack'])(
    'preserves permanent parry diagnostics during %s',
    (maneuver) => {
      const character = makeCharacter(
        [
          { id: 'no', name: 'No blade', parry: 'No', skill: 'Sword' },
          { id: 'custom', name: 'Custom blade', parry: 'homebrew', skill: 'Sword' },
          { id: 'missing', name: 'Missing skill blade', parry: '0', skill: 'Absent' },
          { id: 'valid', name: 'Valid blade', parry: '0', skill: 'Sword' },
        ],
        [{ name: 'Sword', level: 14 }],
      );
      character.combat = { maneuver } as CharacterDetail['combat'];
      render(<DefensesCard character={character} openRoll={vi.fn()} />);
      expect(screen.getByText('No')).toBeInTheDocument();
      expect(screen.getByText('homebrew')).toBeInTheDocument();
      expect(screen.getByText("skill 'Absent' not on sheet")).toBeInTheDocument();
      expect(screen.getByText('Parry (Valid blade) — unavailable')).toBeInTheDocument();
      for (const name of ['No blade', 'Custom blade', 'Missing skill blade']) {
        expect(screen.queryByText(`Parry (${name}) — unavailable`)).not.toBeInTheDocument();
      }
      expect(screen.queryByRole('button', { name: /^Parry/ })).not.toBeInTheDocument();
    },
  );

  it.each([
    [10, 3, 9, 7],
    [11, 3, 10, 8],
    [10, 4, 14, 10],
  ])('uses the same usable ST for attacks and parries (ST%s, FP%s)', (st, fp, attack, parry) => {
    const character = makeCharacter(
      [{ id: 'sword', name: 'Sword', parry: '0', skill: 'Sword', stRequired: 10 }],
      [{ name: 'Sword', level: 14 }],
    );
    character.derived = {
      ...character.derived,
      effectiveSt: st,
      hp: 12,
      fp: 12,
      thrust: '1d-2',
      swing: '1d',
    };
    character.combat = { currentHp: 12, currentFp: fp } as CharacterDetail['combat'];
    const weapon = character.inventory[0];
    if (!weapon?.weaponData) throw new Error('Missing test weapon');
    weapon.weaponData = { ...weapon.weaponData, damage: 'sw+1 cut' };
    const openRoll = vi.fn();
    const sheet = () => (
      <>
        <AttacksCard character={character} openRoll={openRoll} />
        <DefensesCard character={character} openRoll={openRoll} />
      </>
    );
    const view = render(sheet());
    fireEvent.click(screen.getByRole('button', { name: /^Sword/ }));
    expect(targetFor(openRoll, 0)).toBe(attack);
    fireEvent.click(screen.getByRole('button', { name: /^Parry/ }));
    expect(targetFor(openRoll, 1)).toBe(parry);
    // B426 leaves ST-based damage intact even when usable ST is halved.
    fireEvent.click(screen.getByRole('button', { name: '1d+1 cut' }));
    expect(openRoll.mock.calls[2]?.[0].damage.dice).toEqual({ dice: 1, adds: 1 });
    character.combat = { ...character.combat, currentFp: 12 } as CharacterDetail['combat'];
    view.rerender(sheet());
    fireEvent.click(screen.getByRole('button', { name: /^Sword/ }));
    expect(targetFor(openRoll, 3)).toBe(14);
    fireEvent.click(screen.getByRole('button', { name: /^Parry/ }));
    expect(targetFor(openRoll, 4)).toBe(10);
  });

  function liveCharacter() {
    const c = makeCharacter(
      [
        { id: 'sword', name: 'Sword', parry: '0', skill: 'Sword' },
        { id: 'shield', name: 'Shield', db: 2, skill: 'Shield' },
      ],
      [
        { name: 'Sword', level: 14 },
        { name: 'Shield', level: 14 },
      ],
    );
    c.derived = { ...c.derived, hp: 12, fp: 12, parryMod: 1, blockMod: 1 };
    c.encumbrance = { ...c.encumbrance, dodgePenalty: -1, moveMultiplier: 0.8, label: 'Light' };
    c.combat = {
      id: c.id,
      characterId: c.id,
      createdAt: '',
      updatedAt: '',
      currentHp: 12,
      currentFp: 12,
      posture: 'standing',
      conditions: [],
      maneuver: null,
    } as CharacterDetail['combat'];
    return c;
  }
  it('dispatches pool-adjusted Dodge with encumbrance and DB, then clears restrictions', () => {
    const c = liveCharacter();
    c.combat = {
      ...c.combat,
      currentHp: 3,
      currentFp: 3,
      conditions: ['Reeling'],
    } as CharacterDetail['combat'];
    const openRoll = vi.fn();
    const view = render(<DefensesCard character={c} openRoll={openRoll} />);
    const moveRow = () => within(screen.getByText('Move').parentElement as HTMLElement);
    expect(moveRow().getByText('1')).toBeInTheDocument(); // ceil(encumbered Move 4 / 4)
    fireEvent.click(screen.getByRole('button', { name: /^Dodge/ }));
    expect(targetFor(openRoll, 0)).toBe(4); // ceil((9-1)/4) + DB2
    fireEvent.click(screen.getByRole('button', { name: /^Parry/ }));
    expect(targetFor(openRoll, 1)).toBe(13); // 7+3+trait1+DB2
    c.combat = {
      ...c.combat,
      currentHp: 12,
      currentFp: 12,
      posture: 'prone',
      conditions: ['Stunned'],
    } as CharacterDetail['combat'];
    view.rerender(<DefensesCard character={c} openRoll={openRoll} />);
    expect(moveRow().getByText('0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Dodge/ }));
    expect(targetFor(openRoll, 2)).toBe(3); // 8+2-3-4
    c.combat = { ...c.combat, posture: 'standing', conditions: [] } as CharacterDetail['combat'];
    view.rerender(<DefensesCard character={c} openRoll={openRoll} />);
    fireEvent.click(screen.getByRole('button', { name: /^Dodge/ }));
    expect(targetFor(openRoll, 3)).toBe(10);
    expect(moveRow().getByText('4')).toBeInTheDocument();
  });

  it('shows unavailable defenses for All-Out Attack and limits All-Out Defense to a chosen option', () => {
    const c = liveCharacter();
    c.combat = { ...c.combat, maneuver: 'All-Out Attack' } as CharacterDetail['combat'];
    const openRoll = vi.fn();
    const view = render(<DefensesCard character={c} openRoll={openRoll} />);
    expect(screen.queryByRole('button', { name: /^Dodge/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Parry/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Block/ })).not.toBeInTheDocument();
    expect(screen.getByText('Dodge — unavailable')).toBeInTheDocument();
    c.combat = { ...c.combat, maneuver: 'All-Out Defense' } as CharacterDetail['combat'];
    view.rerender(<DefensesCard character={c} openRoll={openRoll} />);
    fireEvent.click(screen.getByRole('button', { name: '+2 dodge' }));
    fireEvent.click(screen.getByRole('button', { name: /^Dodge/ }));
    expect(targetFor(openRoll, 0)).toBe(12);
    fireEvent.click(screen.getByRole('button', { name: /^Block/ }));
    expect(targetFor(openRoll, 1)).toBe(13);
    fireEvent.click(screen.getByRole('button', { name: 'Double defense' }));
    expect(screen.getByRole('button', { name: 'Double defense' })).toHaveClass('on');
    expect(screen.getByRole('button', { name: '+2 dodge' })).not.toHaveClass('on');
    fireEvent.click(screen.getByRole('button', { name: /^Dodge/ }));
    expect(targetFor(openRoll, 2)).toBe(10);
    c.combat = { ...c.combat, maneuver: 'Move and Attack' } as CharacterDetail['combat'];
    view.rerender(<DefensesCard character={c} openRoll={openRoll} />);
    expect(screen.queryByRole('button', { name: /^Parry/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Block/ })).toBeInTheDocument();
    c.combat = { ...c.combat, maneuver: 'All-Out Defense' } as CharacterDetail['combat'];
    view.rerender(<DefensesCard character={c} openRoll={openRoll} />);
    expect(screen.getByRole('button', { name: 'Double defense' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Dodge/ }));
    expect(targetFor(openRoll, 3)).toBe(10);
  });

  it.each([0, 2])('dispatches trait-adjusted defense targets exactly once with DB %i', (db) => {
    const openRoll = vi.fn();
    const base = makeCharacter(
      [
        { id: 'w1', name: 'Broadsword', parry: '0', skill: 'Broadsword' },
        { id: 'w2', name: 'Saber', parry: '0F', skill: 'Saber' },
        { id: 'missing', name: 'Axe', parry: '0', skill: 'Axe/Mace' },
        { id: 'shield', name: 'Shield', db, skill: 'Shield' },
      ],
      [
        { name: 'Broadsword', level: 14 },
        { name: 'Saber', level: 14 },
        { name: 'Shield', level: 14 },
      ],
    );
    const withEffects = (enabled: boolean): CharacterDetail => {
      const resolved = resolveEffects(
        [
          {
            id: 'cr',
            name: 'Combat Reflexes',
            level: null,
            libraryEffects: [
              { target: 'dodge', value: 1, scaling: 'flat' },
              { target: 'parry', value: 1, scaling: 'flat' },
              { target: 'block', value: 1, scaling: 'flat' },
            ],
          },
          {
            id: 'enhanced',
            name: 'Enhanced Defenses',
            level: 2,
            libraryEffects: [
              { target: 'parry', value: 1, scaling: 'per_level', conditionGroup: 'ready' },
              { target: 'block', value: 1, scaling: 'flat', conditionGroup: 'ready' },
            ],
          },
        ],
        [],
        new Set(enabled ? ['ready'] : []),
      );
      const mods = applyEffectsToAttrs(
        { dodgeMod: 0, parryMod: 0, blockMod: 0 } as CharacterAttrs,
        resolved,
      );
      return {
        ...base,
        derived: {
          ...base.derived,
          dodge: 9 + mods.dodgeMod,
          parryMod: mods.parryMod,
          blockMod: mods.blockMod,
        },
      };
    };
    const view = render(<DefensesCard character={withEffects(false)} openRoll={openRoll} />);
    const rollTargets = () => {
      openRoll.mockClear();
      for (const name of ['Dodge', 'Parry (Broadsword)', 'Parry (Saber)', 'Block (Shield)']) {
        fireEvent.click(
          screen.getByRole('button', { name: new RegExp(name.replace(/[()]/g, '\\$&')) }),
        );
      }
      return openRoll.mock.calls.map((call) => (call[0] as RollRequest).baseTarget);
    };
    expect(rollTargets()).toEqual([10 + db, 11 + db, 11 + db, 11 + db]);
    expect(screen.queryByRole('button', { name: /Parry \(Axe\)/ })).not.toBeInTheDocument();
    view.rerender(<DefensesCard character={withEffects(true)} openRoll={openRoll} />);
    expect(rollTargets()).toEqual([10 + db, 13 + db, 13 + db, 12 + db]);
    expect(screen.getAllByText(/\+ 3 defense modifiers/)).toHaveLength(2);
    view.rerender(<DefensesCard character={withEffects(false)} openRoll={openRoll} />);
    expect(rollTargets()).toEqual([10 + db, 11 + db, 11 + db, 11 + db]);
  });

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
    expect(screen.getByText('+ 1 armor DB (Deflect Hauberk)')).toBeInTheDocument();
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
    expect(
      screen.getByText('+ 2 DB (Medium Shield) + 1 armor DB (Deflect Breastplate)'),
    ).toBeInTheDocument();
  });

  it('uses one maximum armor DB for the selected location and facing', () => {
    const openRoll = vi.fn();
    const character = makeCharacter(
      [],
      [],
      [
        { id: 'torso-low', name: 'Low Coat', db: 1 },
        { id: 'torso-high', name: 'High Plate', db: 3, frontOnly: true },
        { id: 'head', name: 'Helm', db: 2, locations: ['skull'] },
      ],
    );
    render(<DefensesCard character={character} openRoll={openRoll} />);
    fireEvent.click(screen.getByRole('button', { name: /Dodge/ }));
    expect(targetFor(openRoll, 0)).toBe(12); // 9 + max(1, 3), never +4
    fireEvent.change(screen.getByLabelText('Defense hit location'), { target: { value: 'skull' } });
    fireEvent.click(screen.getByRole('button', { name: /Dodge/ }));
    expect(targetFor(openRoll, 1)).toBe(11);
    fireEvent.change(screen.getByLabelText('Defense hit location'), { target: { value: 'torso' } });
    fireEvent.change(screen.getByLabelText('Defense facing'), { target: { value: 'back' } });
    fireEvent.click(screen.getByRole('button', { name: /Dodge/ }));
    expect(targetFor(openRoll, 2)).toBe(10);
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
