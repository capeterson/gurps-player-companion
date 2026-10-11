import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';
import { ItemSpellsPanel } from './ItemSpellsPanel.tsx';
import { PowerstonesPanel } from './PowerstonesPanel.tsx';

vi.mock('../../../lib/toast.tsx', () => ({ useToasts: () => ({ push: vi.fn() }) }));
vi.mock('../../../sync/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../sync/outbox.ts')>()),
  enqueueFieldPatch: vi.fn().mockResolvedValue(undefined),
}));

const CHARACTER_ID = '0193b3c0-f1f0-7000-8000-00000000a101';
const STONE_ID = '0193b3c0-f1f0-7000-8000-00000000a102';
const WAND_ID = '0193b3c0-f1f0-7000-8000-00000000a103';
const TALISMAN_ID = '0193b3c0-f1f0-7000-8000-00000000a104';
const RING_ID = '0193b3c0-f1f0-7000-8000-00000000a105';

function item(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    characterId: CHARACTER_ID,
    name,
    quantity: 1,
    weightLbs: 0,
    cost: 0,
    notes: null,
    parentId: null,
    externalLocation: null,
    worn: true,
    equipped: false,
    isContainer: false,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    isArmor: false,
    armor: null,
    weaponData: null,
    powerstoneData: null,
    magicItemData: null,
    enchantments: [],
    libraryItemId: null,
    effectiveWeightLbs: 0,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
}

const stone = item(STONE_ID, 'Amber focus', {
  powerstoneData: { currentEnergy: 3, maxEnergy: 5, notes: 'A compact reserve' },
});
const wand = item(WAND_ID, 'Ash wand', {
  magicItemData: { spellName: 'Light', spellSkillLevel: 15, mode: 'powered', energyCost: 1 },
});
const poweredTalisman = item(TALISMAN_ID, 'Sun talisman', {
  magicItemData: {
    spellName: 'Sunlight',
    spellSkillLevel: 14,
    mode: 'powered',
    energyCost: 2,
  },
});
const continuousRing = item(RING_ID, 'Glow ring', {
  magicItemData: { spellName: 'Glow', spellSkillLevel: 13, mode: 'continuous' },
});
const STASHED_ID = '0193b3c0-f1f0-7000-8000-00000000a106';
const stashedWand = item(STASHED_ID, 'Stashed wand', {
  externalLocation: 'At home',
  magicItemData: { spellName: 'Spark', spellSkillLevel: 12, mode: 'powered' },
});
const character = {
  id: CHARACTER_ID,
  derived: { hp: 10, fp: 10 },
  combat: null,
  manaLevel: 'normal',
  manaLevelKnown: true,
  traits: [],
  inventory: [stone, wand, poweredTalisman, continuousRing, stashedWand],
} as unknown as CharacterDetail;

beforeEach(() => {
  vi.mocked(enqueueFieldPatch).mockReset().mockResolvedValue(undefined);
});

describe('compact powerstone and magic-item summaries', () => {
  it('describes the panel as an owned-items tracker, not a carried-only list', () => {
    render(
      <PowerstonesPanel
        character={{ id: CHARACTER_ID, inventory: [] } as unknown as CharacterDetail}
        canWrite={false}
      />,
    );
    expect(screen.getByText('No powerstones owned.')).toBeVisible();
  });

  it('shows a compact powerstone summary and keeps its full-object outbox actions', () => {
    render(<PowerstonesPanel character={character} canWrite />);
    expect(screen.getByRole('table', { name: 'Powerstones' })).toBeVisible();
    expect(screen.getByText('3 stored energy')).toBeVisible();
    expect(screen.getByText('Amber focus')).toBeVisible();
    expect(screen.getByText('A compact reserve')).toBeVisible();
    expect(screen.getByLabelText('Amber focus energy')).toHaveTextContent('3 / 5');

    const recharge = screen.getAllByRole('button', { name: 'Recharge 1 to Amber focus' })[0];
    if (!recharge) throw new Error('Missing powerstone recharge action');
    fireEvent.click(recharge);
    expect(enqueueFieldPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        entityClass: 'character_inventory',
        entityId: STONE_ID,
        fieldPath: 'powerstoneData',
        attemptedValue: { maxEnergy: 5, currentEnergy: 4, notes: 'A compact reserve' },
        characterId: CHARACTER_ID,
      }),
    );
  });

  it('lists item spells at item Power with a normal-cost Cast for user-cast items', () => {
    render(<ItemSpellsPanel character={character} canWrite />);
    const table = screen.getByRole('table', { name: 'Item spells' });
    expect(table).toBeVisible();
    const wandRow = screen.getByRole('rowgroup', { name: 'Light from Ash wand' });
    expect(wandRow).toHaveTextContent('Ash wand');
    expect(wandRow).not.toHaveTextContent(/charge/i);
    expect(screen.getByRole('button', { name: 'Roll Light from Ash wand' })).toHaveTextContent(
      '15',
    );
    expect(screen.getByRole('rowgroup', { name: 'Glow from Glow ring' })).toHaveTextContent(
      'Glow ring · Always on',
    );
    expect(screen.queryByRole('button', { name: /^Cast .* from Glow ring$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Refill|Recharge .* wand/ })).toBeNull();
    const stashed = screen.getByRole('rowgroup', { name: 'Spark from Stashed wand' });
    expect(stashed).toHaveTextContent('Not carried');
    const stashedCast = screen.getAllByRole('button', { name: 'Cast Spark from Stashed wand' })[0];
    expect(stashedCast).toBeDisabled();
    expect(stashedCast).toHaveTextContent('Cast—');

    const castWand = screen.getAllByRole('button', { name: 'Cast Light from Ash wand' })[0];
    if (!castWand) throw new Error('Missing item cast action');
    expect(castWand).toHaveTextContent('Cast1');
    fireEvent.click(castWand);
    expect(screen.getByRole('dialog', { name: 'Cast Light from Ash wand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay 1 energy' })).toBeEnabled();
    expect(enqueueFieldPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    const castTalisman = screen.getAllByRole('button', {
      name: 'Cast Sunlight from Sun talisman',
    })[0];
    if (!castTalisman) throw new Error('Missing powered item cast action');
    expect(castTalisman).toHaveTextContent('Cast2');
    fireEvent.click(castTalisman);
    expect(
      screen.getByRole('dialog', { name: 'Cast Sunlight from Sun talisman' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay 2 energy' })).toBeEnabled();
  });

  it('holds item casting in a no-mana zone', () => {
    render(<ItemSpellsPanel character={{ ...character, manaLevel: 'none' }} canWrite />);
    expect(screen.getAllByRole('button', { name: 'Cast Light from Ash wand' })[0]).toBeDisabled();
    expect(
      screen.getAllByRole('button', { name: 'Cast Sunlight from Sun talisman' })[0],
    ).toBeDisabled();
  });

  it('applies the low-mana -5 to item Power (M19)', () => {
    render(<ItemSpellsPanel character={{ ...character, manaLevel: 'low' }} canWrite />);
    expect(screen.getByRole('button', { name: 'Roll Light from Ash wand' })).toHaveTextContent(
      '10',
    );
  });

  it('omits the section when no magic item is owned', () => {
    const { container } = render(
      <ItemSpellsPanel character={{ ...character, inventory: [stone] }} canWrite />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps manual controls out of the read-only view', () => {
    render(
      <>
        <PowerstonesPanel character={character} canWrite={false} />
        <ItemSpellsPanel character={character} canWrite={false} />
      </>,
    );
    expect(screen.getByText('Amber focus')).toBeVisible();
    expect(screen.getByText('Ash wand')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Drain 1 from Amber focus' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Recharge 1 to Amber focus' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cast Light from Ash wand' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Roll Light from Ash wand' })).toBeVisible();
    expect(screen.getByRole('rowgroup', { name: 'Light from Ash wand' })).toHaveTextContent('1');
  });
});
