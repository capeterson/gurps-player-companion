/**
 * AttacksCard — the vitals/eye hit-location presets are only offered
 * when the weapon's damage can plausibly target them (B399: imp/pi
 * only). A cutting weapon must not offer "Vitals"/"Eye" presets; an
 * impaling or piercing weapon must.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeDerived } from '../../../../../shared/domain/characterCalc.ts';
import { applyEffectsToAttrs, resolveEffects } from '../../../../../shared/domain/traitEffects.ts';
import type {
  CharacterDetail,
  ResolvedEffectOut,
} from '../../../../../shared/schemas/character.ts';
import type { RollRequest } from '../rollTypes.ts';
import { AttacksCard } from './AttacksCard.tsx';
import { clearAllAttackTablePreferences } from './attackTablePreferences.ts';

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
    derived: { effectiveSt: 10, thrust: '1d-2', swing: '1d' },
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
  beforeEach(() => clearAllAttackTablePreferences());

  function withMultipleWeapons() {
    const character = makeCharacter('sw+1 cut', { name: 'Sword', skill: 'Broadsword' });
    const sword = character.inventory[0];
    if (!sword?.weaponData) throw new Error('Missing weapon fixture');
    character.inventory = [
      sword,
      {
        ...sword,
        id: 'w2',
        name: 'Bow',
        weaponData: { ...sword.weaponData, damage: '1d imp', skill: 'Bow' },
      },
      {
        ...sword,
        id: 'w3',
        name: 'Axe',
        weaponData: { ...sword.weaponData, damage: '2d cr', skill: 'Axe/Mace' },
      },
    ];
    return character;
  }

  function weaponOrder() {
    return screen
      .getAllByRole('rowgroup')
      .filter((row) => row.hasAttribute('aria-label'))
      .map((row) => row.getAttribute('aria-label'));
  }

  it('sorts weapon, governing skill and damage type in either direction without losing custom order', () => {
    render(<AttacksCard character={withMultipleWeapons()} openRoll={vi.fn()} />);
    expect(weaponOrder()).toEqual(['Sword', 'Bow', 'Axe']);
    fireEvent.click(screen.getByRole('button', { name: 'Weapon' }));
    expect(weaponOrder()).toEqual(['Axe', 'Bow', 'Sword']);
    fireEvent.click(screen.getByRole('button', { name: 'Weapon' }));
    expect(weaponOrder()).toEqual(['Sword', 'Bow', 'Axe']);
    fireEvent.click(screen.getByRole('button', { name: 'Governing skill' }));
    expect(weaponOrder()).toEqual(['Axe', 'Bow', 'Sword']);
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    expect(weaponOrder()).toEqual(['Axe', 'Sword', 'Bow']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Attack order' }), {
      target: { value: 'custom' },
    });
    expect(weaponOrder()).toEqual(['Sword', 'Bow', 'Axe']);
  });

  it('persists keyboard custom ordering across remounts and keeps preferences separate per character', () => {
    const character = withMultipleWeapons();
    const view = render(<AttacksCard character={character} openRoll={vi.fn()} />);
    const bow = screen.getByRole('rowgroup', { name: 'Bow' });
    const handle = within(bow).getByRole('button', { name: /Reorder/ });
    expect(handle).toHaveTextContent('⠿');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(weaponOrder()).toEqual(['Bow', 'Sword', 'Axe']);
    view.unmount();
    const remount = render(<AttacksCard character={character} openRoll={vi.fn()} />);
    expect(weaponOrder()).toEqual(['Bow', 'Sword', 'Axe']);
    remount.rerender(
      <AttacksCard character={{ ...character, id: 'another-character' }} openRoll={vi.fn()} />,
    );
    expect(weaponOrder()).toEqual(['Sword', 'Bow', 'Axe']);
    remount.rerender(<AttacksCard character={character} openRoll={vi.fn()} />);
    expect(weaponOrder()).toEqual(['Bow', 'Sword', 'Axe']);
  });

  it('drags a weapon and all its modes together, then restores that order after a reload', () => {
    const character = withMultipleWeapons();
    const view = render(<AttacksCard character={character} openRoll={vi.fn()} />);
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(
      within(screen.getByRole('rowgroup', { name: 'Axe' })).getByRole('button', {
        name: /Reorder/,
      }),
      { dataTransfer },
    );
    fireEvent.dragEnter(screen.getByRole('rowgroup', { name: 'Sword' }), { dataTransfer });
    fireEvent.dragOver(screen.getByRole('rowgroup', { name: 'Sword' }), { dataTransfer });
    fireEvent.drop(screen.getByRole('rowgroup', { name: 'Sword' }), { dataTransfer });
    expect(weaponOrder()).toEqual(['Axe', 'Sword', 'Bow']);
    view.unmount();
    render(<AttacksCard character={character} openRoll={vi.fn()} />);
    expect(weaponOrder()).toEqual(['Axe', 'Sword', 'Bow']);
  });

  it('appends newly equipped weapons and tolerates removed IDs or invalid saved preferences', () => {
    localStorage.setItem(
      'gurps:attackTable:char-1',
      JSON.stringify({ order: ['gone', 'w2', 'w2', 5], sort: 'custom' }),
    );
    const character = withMultipleWeapons();
    const view = render(<AttacksCard character={character} openRoll={vi.fn()} />);
    expect(weaponOrder()).toEqual(['Bow', 'Sword', 'Axe']);
    view.unmount();
    localStorage.setItem('gurps:attackTable:char-1', 'invalid JSON');
    render(<AttacksCard character={character} openRoll={vi.fn()} />);
    expect(weaponOrder()).toEqual(['Sword', 'Bow', 'Axe']);
  });

  it('clears local attack preferences at logout without deleting unrelated storage', () => {
    localStorage.setItem('gurps:attackTable:char-1', '{}');
    localStorage.setItem('gurps:attackTable:char-2', '{}');
    localStorage.setItem('test-unrelated-setting', 'keep');
    clearAllAttackTablePreferences();
    expect(localStorage.getItem('gurps:attackTable:char-1')).toBeNull();
    expect(localStorage.getItem('gurps:attackTable:char-2')).toBeNull();
    expect(localStorage.getItem('test-unrelated-setting')).toBe('keep');
    localStorage.removeItem('test-unrelated-setting');
  });
  it('applies scoped attack, damage, and Accuracy bonuses with source breakdowns', () => {
    const character = makeCharacter('thr imp', { ranged: { acc: 2 } });
    character.effects = [
      {
        sourceKind: 'trait',
        sourceName: 'Weapon Bond',
        sourceId: '11111111-1111-4111-8111-111111111111',
        target: 'weapon_attack',
        value: 1,
        active: true,
        weaponSelector: { kind: 'weapon_name', weaponName: 'Broadsword' },
        matchedInventoryItemIds: ['w1'],
        weaponMatchStatus: 'one',
      },
      {
        sourceKind: 'trait',
        sourceName: 'Puissance',
        sourceId: '22222222-2222-4222-8222-222222222222',
        target: 'weapon_damage',
        value: 2,
        active: true,
        weaponSelector: { kind: 'weapon_name', weaponName: 'Broadsword' },
        matchedInventoryItemIds: ['w1'],
        weaponMatchStatus: 'one',
      },
      {
        sourceKind: 'trait',
        sourceName: 'Accuracy',
        sourceId: '33333333-3333-4333-8333-333333333333',
        target: 'weapon_accuracy',
        value: 1,
        active: true,
        weaponSelector: { kind: 'weapon_name', weaponName: 'Broadsword' },
        matchedInventoryItemIds: ['w1'],
        weaponMatchStatus: 'one',
      },
    ];
    const openRoll = vi.fn();
    render(<AttacksCard character={character} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: '1d imp' }));
    expect(openRoll.mock.calls[0]?.[0].damage.dice).toEqual({ dice: 1, adds: 0 });
    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    expect(openRoll.mock.calls[1]?.[0].baseTarget).toBe(15);
    expect(openRoll.mock.calls[1]?.[0].presets[0]).toEqual({ label: 'Aim (+3)', mod: 3 });
    expect(screen.getAllByText('Weapon Bond').length).toBeGreaterThan(0);
    expect(screen.getByText('Accuracy')).toBeInTheDocument();
    expect(screen.getByText('Puissance')).toBeInTheDocument();
  });

  function scopedEffect(
    target: 'weapon_attack' | 'weapon_damage' | 'weapon_accuracy',
    value: number,
    modeName: string,
  ): ResolvedEffectOut {
    return {
      sourceKind: 'trait',
      sourceId: '11111111-1111-4111-8111-111111111111',
      sourceName: `${modeName} ${target}`,
      target,
      value,
      active: true,
      weaponSelector: { kind: 'weapon_name', weaponName: 'Broadsword', modeName },
      matchedInventoryItemIds: ['w1'],
      weaponMatchStatus: 'one',
    };
  }

  it('keeps alternate-mode attack, damage and Aim bonuses scoped while carrying effective armor divisors', () => {
    const character = makeCharacter('sw+1 cut', { ranged: { acc: 2 } });
    const weapon = character.inventory[0];
    if (!weapon?.weaponData) throw new Error('Missing weapon fixture');
    weapon.weaponData.alternateModes = [{ name: 'Thrust', damage: 'thr(2) imp' }];
    weapon.effectiveArmorDivisor = 5;
    character.effects = [
      scopedEffect('weapon_attack', 1, 'primary'),
      scopedEffect('weapon_attack', 3, 'Thrust'),
      scopedEffect('weapon_accuracy', 2, 'Thrust'),
      scopedEffect('weapon_damage', 4, 'Thrust'),
    ];
    const openRoll = vi.fn();
    render(<AttacksCard character={character} openRoll={openRoll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Broadsword 15' }));
    expect(openRoll.mock.calls.at(-1)?.[0]).toMatchObject({
      baseTarget: 15,
      presets: expect.arrayContaining([{ label: 'Aim (+2)', mod: 2 }]),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Broadsword · Thrust 17' }));
    expect(openRoll.mock.calls.at(-1)?.[0]).toMatchObject({
      baseTarget: 17,
      presets: expect.arrayContaining([{ label: 'Aim (+4)', mod: 4 }]),
    });
    fireEvent.click(screen.getByRole('button', { name: '1d+1 cut (5)' }));
    expect(openRoll.mock.calls.at(-1)?.[0].damage).toEqual({
      dice: { dice: 1, adds: 1 },
      damageType: 'cut',
      armorDivisor: '5',
    });
    fireEvent.click(screen.getByRole('button', { name: '1d+2 imp (5)' }));
    expect(openRoll.mock.calls.at(-1)?.[0].damage).toEqual({
      dice: { dice: 1, adds: 2 },
      damageType: 'imp',
      armorDivisor: '5',
    });
    expect(screen.getByText('Thrust weapon_damage')).toBeInTheDocument();
  });

  it('offers an unmodified alternate roll when only the primary mode gets an attack bonus', () => {
    const character = makeCharacter('sw+1 cut');
    const weapon = character.inventory[0];
    if (!weapon?.weaponData) throw new Error('Missing weapon fixture');
    weapon.weaponData.alternateModes = [{ name: 'Thrust', damage: 'thr imp' }];
    character.effects = [scopedEffect('weapon_attack', 2, 'primary')];
    const openRoll = vi.fn();
    render(<AttacksCard character={character} openRoll={openRoll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Broadsword · Thrust 14' }));
    expect(openRoll.mock.calls.at(-1)?.[0].baseTarget).toBe(14);
  });

  it('retains weapon selector diagnostics alongside the sortable table', () => {
    const character = withMultipleWeapons();
    character.effects = [
      {
        ...scopedEffect('weapon_attack', 1, 'primary'),
        weaponMatchStatus: 'zero',
        matchedInventoryItemIds: [],
      },
      {
        ...scopedEffect('weapon_damage', 1, 'primary'),
        weaponMatchStatus: 'multiple',
        matchedInventoryItemIds: ['w1', 'w2'],
      },
    ];
    render(<AttacksCard character={character} openRoll={vi.fn()} />);
    expect(screen.getByText('Weapon effect matches (2)')).toBeInTheDocument();
    expect(screen.getByText(/selector matches no equipped weapons/)).toBeInTheDocument();
    expect(
      screen.getByText(/selector matches 2 equipped weapons \(Sword, Bow\)/),
    ).toBeInTheDocument();
    expect(weaponOrder()).toEqual(['Sword', 'Bow', 'Axe']);
  });

  it('withholds ST-based damage while effects are unknown, keeping fixed dice usable', () => {
    const character = {
      ...makeCharacter('thr+1 imp / sw+1 cut / 2d pi'),
      libraryEffectsKnown: false,
    };
    const openRoll = vi.fn();
    const view = render(<AttacksCard character={character} openRoll={openRoll} />);
    expect(screen.getByText(/ST-based damage is unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1d-1 imp' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1d+1 cut' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2d pi' }));
    expect(openRoll.mock.calls[0]?.[0].damage.dice).toEqual({ dice: 2, adds: 0 });
    view.rerender(
      <AttacksCard character={{ ...character, libraryEffectsKnown: true }} openRoll={openRoll} />,
    );
    expect(screen.getByRole('button', { name: '1d-1 imp' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '1d+1 cut' })).toBeEnabled();
  });

  it('retains high-ST damage and fixed weapon modes independently', () => {
    const character = makeCharacter('2d+1 pi / sw+1 cut');
    character.derived = {
      ...character.derived,
      effectiveSt: 1000,
      thrust: '101d',
      swing: '103d+2',
    };
    const openRoll = vi.fn();
    const view = render(<AttacksCard character={character} openRoll={openRoll} />);
    fireEvent.click(screen.getByRole('button', { name: '2d+1 pi' }));
    expect(openRoll.mock.calls.at(-1)?.[0].damage.dice).toEqual({ dice: 2, adds: 1 });
    fireEvent.click(screen.getByRole('button', { name: '103d+3 cut' }));
    expect(openRoll.mock.calls.at(-1)?.[0].damage.dice).toEqual({ dice: 103, adds: 3 });
    // An unavailable unrelated derived mode cannot block valid fixed/swing modes.
    view.rerender(
      <AttacksCard
        character={{ ...character, derived: { ...character.derived, thrust: 'unknown' } }}
        openRoll={openRoll}
      />,
    );
    expect(screen.getByRole('button', { name: '2d+1 pi' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '103d+3 cut' })).toBeEnabled();
  });

  it.each([
    ['thr+1 imp', '1d+3 imp', { dice: 1, adds: 3 }],
    ['sw-1 cut', '2d+2 cut', { dice: 2, adds: 2 }],
    ['2d+1 pi', '2d+1 pi', { dice: 2, adds: 1 }],
  ] as const)(
    'dispatches the shared adjusted dice for %s with weapon adds applied once',
    (damage, label, dice) => {
      const character = makeCharacter(damage);
      const effects = resolveEffects(
        [
          {
            id: 'power',
            name: 'Power',
            level: 1,
            libraryEffects: [
              { target: 'damage_thrust', value: 1, scaling: 'flat' },
              { target: 'damage_swing', value: 2, scaling: 'flat' },
            ],
          },
        ],
        [],
        new Set(),
      );
      character.derived = computeDerived(
        applyEffectsToAttrs(
          {
            st: 10,
            dx: 10,
            iq: 10,
            ht: 10,
            hpMod: 0,
            fpMod: 0,
            perMod: 0,
            willMod: 0,
            speedQuarterMod: 0,
            moveMod: 0,
            dodgeMod: 0,
            parryMod: 0,
            blockMod: 0,
            drMod: 0,
            frightCheckMod: 0,
            tempEffects: [{ id: 'might', name: 'Might', mods: { st: 5 } }],
          },
          effects,
        ),
      );
      expect(character.derived.thrust).toBe('1d+2');
      expect(character.derived.swing).toBe('2d+3');
      const openRoll = vi.fn();
      render(<AttacksCard character={character} openRoll={openRoll} />);
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(openRoll).toHaveBeenCalledTimes(1);
      expect(openRoll.mock.calls[0]?.[0].damage.dice).toEqual(dice);
    },
  );

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

  it('binds to the correct specialization when two skill rows share a name', () => {
    const openRoll = vi.fn();
    // Two "Guns" rows distinguished only by specialization; the rifle must
    // bind to its own (lower-level) row, not the higher-level pistol row.
    const character = {
      id: 'char-1',
      derived: { effectiveSt: 10, thrust: '1d-2', swing: '1d' },
      skills: [
        { id: 's1', name: 'Guns', specialization: 'Pistol', level: 15 },
        { id: 's2', name: 'Guns', specialization: 'Rifle', level: 12 },
      ],
      inventory: [
        {
          id: 'w1',
          name: 'Hunting Rifle',
          equipped: true,
          weaponData: {
            damage: '6d pi',
            reach: null,
            parry: null,
            stRequired: null,
            skill: 'Guns (Rifle)',
            ranged: null,
          },
        },
      ],
    } as unknown as CharacterDetail;
    render(<AttacksCard character={character} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Guns\/Rifle/ }));
    const call = openRoll.mock.calls[0] as [RollRequest];
    expect(call[0].baseTarget).toBe(12);
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

  it('uses the enchanted armor divisor in both the damage chip and roll payload', () => {
    const openRoll = vi.fn();
    const character = makeCharacter('1d(2) pi');
    const weapon = character.inventory[0];
    if (!weapon) throw new Error('expected weapon fixture');
    weapon.effectiveArmorDivisor = 5;
    render(<AttacksCard character={character} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: '1d pi (5)' }));
    const call = openRoll.mock.calls[0] as [RollRequest];
    expect(call[0].damage?.armorDivisor).toBe('5');
  });

  it('renders each alternate mode as its own damage chip, reach inherited when unset', () => {
    const openRoll = vi.fn();
    // Primary: swing; alternates: thrust (reach set) + thrown (reach unset
    // => inherited from the weapon's "1").
    const character = {
      id: 'char-1',
      derived: { effectiveSt: 10, thrust: '1d-2', swing: '1d' },
      skills: [{ id: 's1', name: 'Broadsword', level: 14 }],
      inventory: [
        {
          id: 'w1',
          name: 'Rapier',
          equipped: true,
          weaponData: {
            damage: 'sw-1 cut',
            reach: '1',
            parry: '0',
            stRequired: null,
            skill: 'Broadsword',
            ranged: null,
            alternateModes: [
              { name: 'Thrust', damage: 'thr imp', reach: '2' },
              { name: 'Thrown', damage: 'thr imp' },
            ],
          },
        },
      ],
    } as unknown as CharacterDetail;
    render(<AttacksCard character={character} openRoll={openRoll} />);

    // Primary chip (swing) plus two mode chips.
    expect(screen.getByRole('button', { name: '1d-1 cut' })).toBeInTheDocument();
    // Mode names render as labels.
    expect(screen.getByText('Thrust')).toBeInTheDocument();
    expect(screen.getByText('Thrown')).toBeInTheDocument();

    // Two impulse damage chips (thrust + thrown) at ST 10 (thr = 1d-2).
    expect(screen.getAllByRole('button', { name: '1d-2 imp' })).toHaveLength(2);

    // Dedicated reach cells align each mode's inherited or overridden reach.
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: '1' })).toHaveLength(2);

    // Rolling the thrust mode labels the roll with "Rapier (Thrust)".
    const thrustChips = screen.getAllByRole('button', { name: '1d-2 imp' });
    fireEvent.click(thrustChips[0] as HTMLElement);
    const call = openRoll.mock.calls[0] as [RollRequest];
    expect(call[0].label).toBe('Rapier (Thrust) damage');
  });

  it('a weapon with a cut-only primary but impaling alternates still offers Vitals/Eye', () => {
    const openRoll = vi.fn();
    const character = {
      id: 'char-1',
      derived: { effectiveSt: 10, thrust: '1d-2', swing: '1d' },
      skills: [{ id: 's1', name: 'Broadsword', level: 14 }],
      inventory: [
        {
          id: 'w1',
          name: 'Broadsword',
          equipped: true,
          weaponData: {
            damage: 'sw+1 cut',
            reach: '1',
            parry: '0',
            stRequired: null,
            skill: 'Broadsword',
            ranged: null,
            alternateModes: [{ name: 'Thrust', damage: 'thr imp' }],
          },
        },
      ],
    } as unknown as CharacterDetail;
    render(<AttacksCard character={character} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    const presets = presetsFrom(openRoll);
    expect(presets.some((p: { label: string }) => p.label.startsWith('Vitals'))).toBe(true);
    expect(presets.some((p: { label: string }) => p.label.startsWith('Eye'))).toBe(true);
  });
});
