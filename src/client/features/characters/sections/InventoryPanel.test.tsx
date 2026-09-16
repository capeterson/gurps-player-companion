import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { InventoryPanel } from './InventoryPanel.tsx';

function item(
  id: string,
  name: string,
  parentId: string | null,
  options: { container?: boolean; weapon?: boolean } = {},
): InventoryItemOut {
  return {
    id,
    characterId: 'character',
    name,
    quantity: 1,
    weightLbs: 1,
    cost: 1,
    notes: null,
    parentId,
    externalLocation: null,
    worn: parentId === null,
    equipped: false,
    isContainer: options.container ?? false,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    isArmor: false,
    armor: null,
    weaponData: options.weapon
      ? {
          damage: 'sw+1 cut',
          reach: '1',
          parry: '0',
          stRequired: 10,
          skill: 'Broadsword',
          db: null,
          ranged: null,
          notes: null,
          alternateModes: [],
        }
      : null,
    powerstoneData: null,
    magicItemData: null,
    enchantments: [],
    libraryItemId: null,
    effectiveWeightLbs: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function renderPanel() {
  const inventory = [
    item('pack', 'Backpack', null, { container: true }),
    item('apple', 'Apple', 'pack'),
    item('pouch', 'Small pouch', 'pack', { container: true }),
    item('gem', 'Moon Gem', 'pouch'),
    item('sword', 'Broadsword', 'pack', { weapon: true }),
    item('tent', 'Tent', null),
  ];
  const character = {
    id: 'character',
    campaignId: null,
    inventory,
    skills: [],
    libraryEffectsKnown: false,
    encumbrance: { playerWeightLbs: 0, basicLift: 20, level: 0 },
  } as unknown as CharacterDetail;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <InventoryPanel character={character} canWrite={false} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('InventoryPanel filtering', () => {
  it('shows matches and ancestor containers while hiding unrelated contents', () => {
    renderPanel();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter inventory' }), {
      target: { value: 'gem' },
    });

    expect(screen.getByText('Backpack')).toBeVisible();
    expect(screen.getByText('Small pouch')).toBeVisible();
    expect(screen.getByText('Moon Gem')).toBeVisible();
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
    expect(screen.queryByText('Broadsword')).not.toBeInTheDocument();
    expect(screen.queryByText('Tent')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 6')).toBeVisible();
  });

  it('filters by item tag with the same ancestor-only hierarchy', () => {
    renderPanel();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter inventory by tag' }), {
      target: { value: 'weapon' },
    });

    expect(screen.getByText('Backpack')).toBeVisible();
    expect(screen.getByText('Broadsword')).toBeVisible();
    expect(screen.queryByText('Apple')).not.toBeInTheDocument();
    expect(screen.queryByText('Small pouch')).not.toBeInTheDocument();
    expect(screen.queryByText('Moon Gem')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 6')).toBeVisible();
  });
});
