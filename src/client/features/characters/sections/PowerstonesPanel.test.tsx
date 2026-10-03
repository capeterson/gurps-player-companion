import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';
import { MagicItemsPanel, PowerstonesPanel } from './PowerstonesPanel.tsx';

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
    worn: false,
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
const chargedWand = item(WAND_ID, 'Ash wand', {
  magicItemData: {
    spellName: 'Light',
    spellSkillLevel: 15,
    mode: 'charged',
    chargesCurrent: 2,
    chargesMax: 4,
  },
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
const character = {
  id: CHARACTER_ID,
  inventory: [stone, chargedWand, poweredTalisman, continuousRing],
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
    expect(
      screen.getByText('No powerstones owned. Add one in Inventory to track its energy here.'),
    ).toBeVisible();
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

  it('offers charge controls only for charged magic items and preserves their outbox patches', () => {
    render(<MagicItemsPanel character={character} canWrite />);
    expect(screen.getByRole('table', { name: 'Magic items' })).toBeVisible();
    expect(screen.getByText('Ash wand')).toBeVisible();
    expect(screen.getByText('Light').closest('em')?.parentElement).toHaveTextContent(
      'casts Light at skill 15 · charged',
    );
    expect(screen.getByText(/powered by user/)).toBeVisible();
    expect(screen.getByText(/always-on/)).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Use one charge from Ash wand' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Sun talisman/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Glow ring/ })).not.toBeInTheDocument();

    const useCharge = screen.getAllByRole('button', { name: 'Use one charge from Ash wand' })[0];
    if (!useCharge) throw new Error('Missing magic-item charge action');
    fireEvent.click(useCharge);
    expect(enqueueFieldPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        entityClass: 'character_inventory',
        entityId: WAND_ID,
        fieldPath: 'magicItemData',
        attemptedValue: {
          spellName: 'Light',
          spellSkillLevel: 15,
          mode: 'charged',
          chargesCurrent: 1,
          chargesMax: 4,
        },
        characterId: CHARACTER_ID,
      }),
    );
  });

  it('keeps manual controls out of the read-only view', () => {
    render(
      <>
        <PowerstonesPanel character={character} canWrite={false} />
        <MagicItemsPanel character={character} canWrite={false} />
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
      screen.queryByRole('button', { name: 'Use one charge from Ash wand' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Recharge Ash wand to full' }),
    ).not.toBeInTheDocument();
  });
});
