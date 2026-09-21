import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveEffects } from '../../../../../shared/domain/traitEffects.ts';
import { campaignHouseRules } from '../../../../../shared/schemas/campaign.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { type ArmorData, weaponData } from '../../../../../shared/schemas/inventory.ts';
import { getLocalDb } from '../../../../db/dexie.ts';
import { useCombatPatch } from '../useCombatPatch.ts';
import { usePoolBumpers } from '../usePoolBumpers.ts';
import { DrSummaryCard } from './DrSummaryCard.tsx';
vi.mock('../../../../lib/toast.tsx', () => ({ useToasts: () => ({ push: vi.fn() }) }));

function makeCharacter(
  armor: Array<{ dr: number; locations: string[]; typedDr?: ArmorData['typedDr'] }>,
): CharacterDetail {
  return {
    id: 'char-1',
    houseRules: campaignHouseRules.parse({ protectNaturalDr: false }),
    inventory: armor.map((a, i) => ({
      id: `a${i}`,
      name: `Armor ${i}`,
      equipped: true,
      isArmor: true,
      armor: {
        locations: a.locations,
        dr: a.dr,
        drCrushing: null,
        typedDr: a.typedDr ?? {},
        flexible: false,
        frontOnly: false,
        backOnly: false,
        db: null,
        notes: null,
      },
      weaponData: null,
    })),
  } as unknown as CharacterDetail;
}

describe('DrSummaryCard', () => {
  it('combines defense bonus context with damage resistance controls', () => {
    const character = makeCharacter([{ dr: 4, locations: ['torso'] }]);
    character.derived = {
      hp: 10,
      fp: 10,
      dodge: 9,
      basicMove: 5,
      effectiveSt: 10,
    } as CharacterDetail['derived'];
    character.encumbrance = {
      dodgePenalty: 0,
      moveMultiplier: 1,
      label: 'None',
      ratio: 1,
    } as CharacterDetail['encumbrance'];
    character.skills = [];
    const item = character.inventory[0];
    if (!item?.armor) throw new Error('missing armor fixture');
    item.name = 'Deflect Plate';
    item.armor = { ...item.armor, db: 2, frontOnly: true };
    const onFacingChange = vi.fn();
    render(<DrSummaryCard character={character} facing="front" onFacingChange={onFacingChange} />);
    expect(
      screen.getByRole('heading', { name: 'Defense & Damage Resistance' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Defense and damage resistance' })).getByRole(
        'table',
        { name: 'Defenses' },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Armor DB \+2 from Deflect Plate/)).toBeInTheDocument();
    expect(screen.getByText(/Applied to Dodge, Parry, and Block/)).toBeInTheDocument();
    expect(screen.getByLabelText('Armor facing')).toHaveValue('front');
    expect(screen.getByLabelText('Armor facing')).not.toHaveTextContent('Unknown');
    expect(screen.getByRole('option', { name: 'Left' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Right' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Armor facing'), { target: { value: 'back' } });
    expect(onFacingChange).toHaveBeenCalledWith('back');
  });

  it('uses the selected facing for both DR and armor DB', () => {
    const character = makeCharacter([
      { dr: 4, locations: ['torso'] },
      { dr: 2, locations: ['torso'] },
    ]);
    const directional = character.inventory[1];
    if (!directional?.armor) throw new Error('missing directional armor fixture');
    directional.name = 'Front plate';
    directional.armor = { ...directional.armor, frontOnly: true, db: 1 };

    render(<DrSummaryCard character={character} />);
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('6');
    expect(screen.getByText(/Armor DB \+1 from Front plate/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Armor facing'), { target: { value: 'left' } });
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('4');
    expect(screen.getByText(/No armor DB for this location and facing/)).toBeInTheDocument();
  });

  it('applies a side-specific shield DB to the front and matching side', () => {
    const character = makeCharacter([]);
    character.inventory.push({
      id: 'left-shield',
      name: 'Left Shield',
      equipped: true,
      isArmor: false,
      armor: null,
      weaponData: weaponData.parse({ db: 2, wieldedSide: 'left' }),
    } as CharacterDetail['inventory'][number]);

    render(<DrSummaryCard character={character} />);
    expect(screen.getByText(/Shield DB \+2 from Left Shield/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Armor facing'), { target: { value: 'right' } });
    expect(screen.queryByText(/Shield DB \+2 from Left Shield/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Armor facing'), { target: { value: 'left' } });
    expect(screen.getByText(/Shield DB \+2 from Left Shield/)).toBeInTheDocument();
  });

  it.each(['cr', 'imp', 'burn', 'cut', ' CUT '])(
    'only describes severing when destruction uses cutting damage (%s)',
    (type) => {
      render(<DrSummaryCard character={makeCharacter([])} canWrite hpMax={10} bumpHp={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
      fireEvent.change(screen.getByLabelText('Basic damage'), { target: { value: '20' } });
      fireEvent.change(
        within(screen.getByRole('dialog', { hidden: true })).getByLabelText('Hit location'),
        { target: { value: 'arm_left' } },
      );
      fireEvent.change(screen.getByLabelText('Type'), {
        target: { value: type === ' CUT ' ? '__other' : type },
      });
      if (type === ' CUT ')
        fireEvent.change(screen.getByLabelText('Custom type'), { target: { value: type } });
      const hint = screen.getByText(/body part is destroyed/);
      if (type.trim().toLowerCase() === 'cut')
        expect(hint).toHaveTextContent('severed by cutting damage');
      else expect(hint).not.toHaveTextContent('severed');
      expect(screen.getByRole('button', { name: 'Apply −6 HP' })).toBeEnabled();
    },
  );

  it('blocks damage while linked effects are unavailable, then uses the loaded DR', () => {
    const bumpHp = vi.fn();
    const character = { ...makeCharacter([]), libraryEffectsKnown: false };
    const { rerender } = render(
      <DrSummaryCard character={character} canWrite hpMax={10} bumpHp={bumpHp} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('DR unavailable');
    expect(screen.queryByText('All locations and DR types')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
    fireEvent.change(screen.getByLabelText('Basic damage'), { target: { value: '12' } });
    expect(screen.getByRole('button', { name: 'Damage unavailable' })).toBeDisabled();
    fireEvent.submit(
      screen.getByRole('button', { name: 'Damage unavailable' }).closest('form') as HTMLFormElement,
    );
    expect(bumpHp).not.toHaveBeenCalled();
    rerender(
      <DrSummaryCard
        character={{
          ...character,
          libraryEffectsKnown: true,
          effects: resolveEffects(
            [
              {
                id: 'skin',
                name: 'Skin',
                level: 1,
                libraryEffects: [{ target: 'dr', value: 5, scaling: 'flat' }],
              },
            ],
            [],
            new Set(),
          ),
        }}
        canWrite
        hpMax={10}
        bumpHp={bumpHp}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply −7 HP' }));
    expect(bumpHp).toHaveBeenCalledWith(-7);
  });

  it.each([
    ['arm_left', 6],
    ['hand_right', 4],
  ] as const)('caps actual HP loss for a destroyed %s', async (location, cap) => {
    const character = makeCharacter([]);
    character.id = '0193b3c0-f1f0-7000-8000-00000000d046';
    character.derived = { hp: 10, fp: 10 } as CharacterDetail['derived'];
    character.combat = null;
    function Sheet() {
      const patch = useCombatPatch(character);
      const pools = usePoolBumpers(character, true, patch);
      return <DrSummaryCard character={character} canWrite hpMax={10} bumpHp={pools.bumpHp} />;
    }
    render(<Sheet />);
    fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
    fireEvent.change(screen.getByLabelText('Basic damage'), { target: { value: '20' } });
    fireEvent.change(screen.getAllByLabelText('Hit location').at(-1) as HTMLElement, {
      target: { value: location },
    });
    expect(screen.getByText(/20 injury; capped/)).toBeInTheDocument();
    expect(screen.getByText(/body part is destroyed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Apply −${cap} HP` }));
    await waitFor(async () =>
      expect((await getLocalDb().characterCombat.get(character.id))?.currentHp).toBe(10 - cap),
    );
    expect((await getLocalDb().outbox.toArray())[0]?.attemptedValue).toBe(10 - cap);
  });

  it.each([
    ['torso', false, 'cr', '', 5, 1],
    ['skull', false, 'cr', '', 9, 0],
    ['torso', true, 'cut', '2', 9, 1],
    ['eye', false, 'cr', '', 0, 24],
  ] as const)(
    'displays effective DR and applies actual HP loss at %s (armor %s)',
    async (location, armored, type, divisor, dr, injury) => {
      const character = makeCharacter(
        armored ? [{ dr: 4, locations: ['torso'], typedDr: { cut: 5 } }] : [],
      );
      character.id = '0193b3c0-f1f0-7000-8000-00000000d044';
      character.derived = { hp: 30, fp: 10 } as CharacterDetail['derived'];
      character.combat = null;
      character.effects = resolveEffects(
        [
          {
            id: 'skin',
            name: 'Skin',
            level: 1,
            libraryEffects: [
              { target: 'dr', value: 5, scaling: 'flat' },
              { target: 'dr', value: 2, scaling: 'flat', hitLocation: 'skull' },
              { target: 'dr', value: 10, scaling: 'flat', conditionGroup: 'shield' },
            ],
          },
        ],
        [],
        new Set(),
      );
      function Sheet() {
        const patch = useCombatPatch(character);
        const { bumpHp } = usePoolBumpers(character, true, patch);
        return <DrSummaryCard character={character} canWrite hpMax={30} bumpHp={bumpHp} />;
      }
      render(<Sheet />);
      const label = location === 'torso' ? 'Torso' : location === 'skull' ? 'Skull' : 'Eye';
      if (dr > 0)
        expect(screen.getAllByRole('button', { name: `${label}, DR ${dr}` })).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
      fireEvent.change(screen.getByLabelText('Basic damage'), { target: { value: '6' } });
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: type } });
      fireEvent.change(screen.getAllByLabelText('Hit location').at(-1) as HTMLElement, {
        target: { value: location },
      });
      if (divisor)
        fireEvent.change(screen.getByLabelText('Armor divisor'), { target: { value: divisor } });
      const apply = screen.getByRole('button', { name: `Apply −${injury} HP` });
      if (injury === 0) {
        expect(apply).toBeDisabled();
        expect(await getLocalDb().outbox.count()).toBe(0);
      } else {
        fireEvent.click(apply);
        await waitFor(async () =>
          expect((await getLocalDb().characterCombat.get(character.id))?.currentHp).toBe(
            30 - injury,
          ),
        );
        expect((await getLocalDb().outbox.toArray())[0]).toMatchObject({
          fieldPath: 'currentHp',
          attemptedValue: 30 - injury,
        });
      }
    },
  );

  it('shows natural skull protection when no equipped armor exists', () => {
    render(<DrSummaryCard character={{ id: 'c', inventory: [] } as unknown as CharacterDetail} />);
    expect(screen.getAllByRole('button', { name: 'Skull, DR 2' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Skull, DR 2' })).toHaveLength(2);
  });

  it('aggregates and displays DR per hit location', () => {
    render(
      <DrSummaryCard
        character={makeCharacter([
          { dr: 2, locations: ['torso'] },
          { dr: 3, locations: ['torso', 'arm_left'] },
        ])}
      />,
    );
    expect(screen.getAllByRole('button', { name: /^Torso, DR/ })).toHaveLength(2);
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('5');
    expect(screen.getAllByRole('button', { name: 'Left Arm, DR 3' })).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Protection layers' })).toHaveTextContent('3 DR');
  });

  it('nests Fortify DR under base armor and identifies the highest-only winner', () => {
    const character = makeCharacter([{ dr: 3, locations: ['torso'] }]);
    const armor = character.inventory[0];
    if (!armor?.armor) throw new Error('missing armor fixture');
    armor.baseArmor = { ...armor.armor, dr: 3 };
    armor.armor = { ...armor.armor, dr: 6 };
    armor.enchantmentBreakdown = [
      {
        sourceName: 'Armor 0: Fortify I',
        target: 'dr',
        value: 1,
        active: true,
        stackingKey: 'fortify',
        suppressedByStacking: true,
      },
      {
        sourceName: 'Armor 0: Fortify III',
        target: 'dr',
        value: 1,
        active: true,
        stackingKey: 'fortify',
        suppressedByStacking: false,
      },
      {
        sourceName: 'Armor 0: Fortify III',
        target: 'dr',
        value: 2,
        active: true,
        stackingKey: 'fortify',
        suppressedByStacking: false,
      },
    ];

    render(<DrSummaryCard character={character} />);

    const breakdown = screen.getByRole('list', { name: 'Armor 0 DR breakdown' });
    expect(breakdown).toHaveTextContent('Base armor3 DR');
    expect(within(breakdown).getByText('Fortify I').closest('li')).toHaveTextContent(
      /suppressed — Fortify III wins.*\+1 DR/,
    );
    const applied = within(breakdown).getByText('Fortify III').closest('li');
    expect(applied).toHaveTextContent(/\+3 DR/);
    expect(applied).not.toHaveTextContent('winning');
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('6');
  });

  it('shows which armor layer wins a highest-only Fortify conflict', () => {
    const character = makeCharacter([
      { dr: 5, locations: ['torso'] },
      { dr: 3, locations: ['torso'] },
    ]);
    const coif = character.inventory[0];
    const hat = character.inventory[1];
    if (!coif?.armor || !hat?.armor) throw new Error('missing armor fixtures');
    coif.baseArmor = { ...coif.armor, dr: 2 };
    hat.baseArmor = { ...hat.armor, dr: 1 };
    coif.enchantmentBreakdown = [
      {
        sourceName: 'Armor 0: Fortify',
        target: 'dr',
        value: 3,
        active: true,
        stackingKey: 'fortify',
        suppressedByStacking: false,
      },
    ];
    hat.enchantmentBreakdown = [
      {
        sourceName: 'Armor 1: Fortify',
        target: 'dr',
        value: 2,
        active: true,
        stackingKey: 'fortify',
        suppressedByStacking: false,
      },
    ];

    render(<DrSummaryCard character={character} />);

    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('6');
    const applied = within(screen.getByRole('list', { name: 'Armor 0 DR breakdown' }))
      .getByText('Fortify')
      .closest('li');
    expect(applied).toHaveTextContent(/\+3 DR/);
    expect(applied).not.toHaveTextContent('winning');
    expect(
      within(screen.getByRole('list', { name: 'Armor 1 DR breakdown' }))
        .getByText('Fortify')
        .closest('li'),
    ).toHaveTextContent(/suppressed — Armor 0: Fortify wins.*\+2 DR/);
    expect(screen.getByRole('list', { name: 'Protection layers' })).toHaveTextContent(
      /Armor 0.*5 DR.*Armor 1.*1 DR/,
    );
  });

  it('does not mislabel effective DR when the base armor snapshot is unavailable', () => {
    const character = makeCharacter([{ dr: 6, locations: ['torso'] }]);
    const armor = character.inventory[0];
    if (!armor) throw new Error('missing armor fixture');
    armor.enchantmentBreakdown = [
      {
        sourceName: 'Armor 0: Fortify III',
        target: 'dr',
        value: 3,
        active: true,
        stackingKey: 'fortify',
        suppressedByStacking: false,
      },
    ];

    render(<DrSummaryCard character={character} />);

    const breakdown = screen.getByRole('list', { name: 'Armor 0 DR breakdown' });
    expect(breakdown).toHaveTextContent('Base armor unavailable');
    expect(breakdown).not.toHaveTextContent('Base armor6 DR');
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('6');
  });

  it('keeps effective DR when a partial payload omits the enchantment breakdown', () => {
    const character = makeCharacter([{ dr: 5, locations: ['torso'] }]);
    const armor = character.inventory[0];
    if (!armor?.armor) throw new Error('missing armor fixture');
    armor.baseArmor = { ...armor.armor, dr: 2 };

    render(<DrSummaryCard character={character} />);

    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('5');
    expect(screen.getByRole('list', { name: 'Protection layers' })).toHaveTextContent(
      'Armor 05 DR',
    );
  });

  it.each([
    ['cr', 3],
    ['cut', 1],
  ] as const)('explains the zero floor for negative enchantment DR using %s DR', (type, baseDr) => {
    const character = makeCharacter([{ dr: 3, locations: ['torso'], typedDr: { cut: 1 } }]);
    const armor = character.inventory[0];
    if (!armor?.armor) throw new Error('missing armor fixture');
    armor.baseArmor = { ...armor.armor };
    armor.armor = {
      ...armor.armor,
      dr: 0,
      typedDr: { ...armor.armor.typedDr, cut: 0 },
    };
    armor.enchantmentBreakdown = [
      {
        sourceName: 'Armor 0: Frailty',
        target: 'dr',
        value: -5,
        active: true,
        stackingKey: null,
        suppressedByStacking: false,
      },
    ];

    render(<DrSummaryCard character={character} />);
    fireEvent.change(screen.getByLabelText('Damage type'), { target: { value: type } });

    const breakdown = screen.getByRole('list', { name: 'Armor 0 DR breakdown' });
    expect(breakdown).toHaveTextContent(`Base armor${baseDr} DR`);
    expect(breakdown).toHaveTextContent('Frailty-5 DR');
    expect(breakdown).toHaveTextContent(`Minimum DR floor+${5 - baseDr} DR`);
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('0');
  });

  it('resolves incoming damage through DR and applies injury to HP', () => {
    const bumpHp = vi.fn();
    // Torso DR 4; 12 cut => 8 penetrating × 1.5 = 12 injury.
    render(
      <DrSummaryCard
        character={makeCharacter([{ dr: 4, locations: ['torso'] }])}
        canWrite
        hpMax={10}
        bumpHp={bumpHp}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '12' } });
    // Type defaults to 'cr'; switch to cut for the ×1.5 multiplier.
    const typeSelect = screen.getByLabelText('Type');
    fireEvent.change(typeSelect as HTMLElement, { target: { value: 'cut' } });

    const apply = screen.getByRole('button', { name: /Apply −12 HP/ });
    fireEvent.click(apply);
    expect(bumpHp).toHaveBeenCalledWith(-12);
  });

  it('shows the winning armor DB as defense information without reducing injury', () => {
    const bumpHp = vi.fn();
    const character = makeCharacter([
      { dr: 0, locations: ['torso'] },
      { dr: 0, locations: ['torso'] },
    ]);
    const first = character.inventory[0];
    const second = character.inventory[1];
    if (!first?.armor || !second?.armor) throw new Error('missing armor fixture');
    first.name = 'Deflect Coat';
    first.armor = { ...first.armor, db: 1 };
    second.name = 'Deflect Plate';
    second.armor = { ...second.armor, db: 3 };
    render(<DrSummaryCard character={character} canWrite hpMax={20} bumpHp={bumpHp} />);
    fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
    fireEvent.change(screen.getByLabelText('Basic damage'), { target: { value: '10' } });
    expect(screen.getByText(/Armor DB 3 \(Deflect Plate\).*defense only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply −10 HP' }));
    expect(bumpHp).toHaveBeenCalledWith(-10);
  });

  it('offers no incoming-damage button without write access', () => {
    render(<DrSummaryCard character={makeCharacter([{ dr: 4, locations: ['torso'] }])} />);
    expect(screen.queryByRole('button', { name: /Incoming damage/ })).not.toBeInTheDocument();
  });

  it('skips unequipped armor', () => {
    const character = {
      id: 'c',
      inventory: [
        {
          id: 'a0',
          name: 'Unequipped',
          equipped: false,
          isArmor: true,
          armor: {
            locations: ['torso'],
            dr: 10,
            drCrushing: null,
            typedDr: {},
            flexible: false,
            frontOnly: false,
            backOnly: false,
            db: null,
            notes: null,
          },
          weaponData: null,
        },
      ],
    } as unknown as CharacterDetail;
    render(<DrSummaryCard character={character} />);
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('0');
    expect(screen.getAllByRole('button', { name: 'Skull, DR 2' })).toHaveLength(2);
  });

  it('shows typed DR overrides on the graphical armor map', () => {
    render(
      <DrSummaryCard
        character={makeCharacter([{ dr: 4, locations: ['torso'], typedDr: { cut: 7, imp: 10 } }])}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Torso, DR 4' })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Damage type'), { target: { value: 'cut' } });
    expect(screen.getAllByRole('button', { name: 'Torso, DR 7' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Vitals, DR 7' })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Damage type'), { target: { value: 'imp' } });
    expect(screen.getAllByRole('button', { name: 'Torso, DR 10' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Vitals, DR 10' })).toHaveLength(2);
  });

  it('resolves typed DR through the incoming-damage dialog', () => {
    const bumpHp = vi.fn();
    // Torso base DR 4, cut override 6: 12 cut => 6 penetrating × 1.5 = 9 injury.
    render(
      <DrSummaryCard
        character={makeCharacter([{ dr: 4, locations: ['torso'], typedDr: { cut: 6 } }])}
        canWrite
        hpMax={10}
        bumpHp={bumpHp}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '12' } });
    const typeSelect = screen.getByLabelText('Type');
    fireEvent.change(typeSelect as HTMLElement, { target: { value: 'cut' } });
    // Base DR is 4 but the cut override stops 6 — the breakdown shows DR 6.
    expect(screen.getByText(/− DR 6 →/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply −9 HP/ })).toBeInTheDocument();
  });
});

it.each([
  [true, '2', 7, 52],
  [false, '2', 4, 64],
  [true, 'ignore', 5, 60],
  [false, 'ignore', 0, 80],
] as const)(
  'keeps the map and actual HP outbox consistent with house rule %s and divisor %s',
  async (enabled, divisor, dr, injury) => {
    const character = makeCharacter([{ dr: 4, locations: ['skull'] }]);
    character.id = '0193b3c0-f1f0-7000-8000-00000000d048';
    character.derived = { hp: 100, fp: 10 } as CharacterDetail['derived'];
    character.combat = null;
    character.houseRules = campaignHouseRules.parse({ protectNaturalDr: enabled });
    character.effects = resolveEffects(
      [
        {
          id: 'skin',
          name: 'Tough Skin',
          level: 1,
          libraryEffects: [{ target: 'dr', value: 3, scaling: 'flat' }],
        },
      ],
      [],
      new Set(),
    );
    function Sheet() {
      const patch = useCombatPatch(character);
      const pools = usePoolBumpers(character, true, patch);
      return <DrSummaryCard character={character} canWrite hpMax={100} bumpHp={pools.bumpHp} />;
    }
    render(<Sheet />);
    fireEvent.change(screen.getByLabelText('Hit location'), { target: { value: 'skull' } });
    fireEvent.change(screen.getByLabelText('Armor penetration'), { target: { value: divisor } });
    expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent(String(dr));
    expect(screen.getAllByRole('button', { name: `Skull, DR ${dr}` })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
    fireEvent.change(screen.getByLabelText('Basic damage'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: `Apply −${injury} HP` }));
    await waitFor(async () =>
      expect((await getLocalDb().characterCombat.get(character.id))?.currentHp).toBe(100 - injury),
    );
    expect((await getLocalDb().outbox.toArray())[0]?.attemptedValue).toBe(100 - injury);
  },
);

it('defaults the natural DR house rule on and updates both views when campaign rules change', () => {
  const bumpHp = vi.fn();
  const character = { id: 'c', inventory: [] } as unknown as CharacterDetail;
  const view = render(<DrSummaryCard character={character} canWrite hpMax={10} bumpHp={bumpHp} />);
  fireEvent.change(screen.getByLabelText('Hit location'), { target: { value: 'skull' } });
  fireEvent.change(screen.getByLabelText('Armor penetration'), { target: { value: 'ignore' } });
  expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('2');
  fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
  fireEvent.change(screen.getByLabelText('Basic damage'), { target: { value: '3' } });
  expect(screen.getByRole('button', { name: 'Apply −4 HP' })).toBeEnabled();
  view.rerender(
    <DrSummaryCard
      character={{
        ...character,
        houseRules: campaignHouseRules.parse({ protectNaturalDr: false }),
      }}
      canWrite
      hpMax={10}
      bumpHp={bumpHp}
    />,
  );
  expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('0');
  expect(screen.getByRole('button', { name: 'Apply −12 HP' })).toBeEnabled();
});

it('blocks damage when campaign rules are not yet known', () => {
  const bumpHp = vi.fn();
  render(
    <DrSummaryCard
      character={{ ...makeCharacter([]), houseRulesKnown: false }}
      canWrite
      hpMax={10}
      bumpHp={bumpHp}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Incoming damage/ }));
  fireEvent.change(screen.getByLabelText('Basic damage'), { target: { value: '10' } });
  const button = screen.getByRole('button', { name: 'Damage unavailable' });
  expect(button).toBeDisabled();
  fireEvent.submit(button.closest('form') as HTMLFormElement);
  expect(bumpHp).not.toHaveBeenCalled();
});

it('shows fractional-divisor minimum DR and removes skull protection for toxic damage', () => {
  render(<DrSummaryCard character={makeCharacter([])} />);
  fireEvent.change(screen.getByLabelText('Armor penetration'), { target: { value: '0.5' } });
  expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('1');
  expect(screen.getByText(/Unprotected target: DR 1/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Hit location'), { target: { value: 'skull' } });
  fireEvent.change(screen.getByLabelText('Damage type'), { target: { value: 'tox' } });
  expect(screen.getByLabelText('Selected effective DR')).toHaveTextContent('1');
  expect(screen.queryByText('Natural skull protection')).not.toBeInTheDocument();
});
