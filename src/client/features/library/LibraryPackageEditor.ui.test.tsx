import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LocalCampaign } from '../../db/dexie.ts';
import { LibraryPackageEditor } from './LibraryPackageEditor.tsx';
import type { LocalLibrary } from './useLocalLibrary.ts';

const campaign = {
  id: '0193b3c0-f1f0-7000-8000-000000000002',
  name: 'Test campaign',
  description: null,
  ownerId: '0193b3c0-f1f0-7000-8000-000000000003',
  pointTarget: null,
  disadvantageCap: null,
  quirkCap: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  revision: 1,
} as LocalCampaign;

const library = {
  sources: [],
  modifiers: [],
  races: [],
  traits: [
    {
      id: '0193b3c0-f1f0-7000-8000-000000000010',
      campaignId: campaign.id,
      revision: 1,
      name: 'Night Vision',
      kind: 'advantage',
      basePoints: 2,
      tags: [],
      availableModifiers: [],
      variants: [],
      effects: [],
    },
    {
      id: '0193b3c0-f1f0-7000-8000-000000000011',
      campaignId: campaign.id,
      revision: 1,
      name: 'High Jump',
      kind: 'advantage',
      basePoints: 2,
      tags: [],
      availableModifiers: [],
      variants: [],
      effects: [],
    },
  ],
  skills: [],
  spells: [],
  items: [
    {
      id: '0193b3c0-f1f0-7000-8000-000000000012',
      campaignId: campaign.id,
      revision: 1,
      name: 'Iron vest',
      category: 'armor',
      defaultQuantity: 1,
      weightLbs: 1,
      cost: 1,
      isArmor: true,
      armor: { locations: ['torso'], dr: 2, flexible: false, concealable: false },
    },
    {
      id: '0193b3c0-f1f0-7000-8000-000000000013',
      campaignId: campaign.id,
      revision: 1,
      name: 'Mail underlayer',
      category: 'armor',
      defaultQuantity: 1,
      weightLbs: 1,
      cost: 1,
      isArmor: true,
      armor: { locations: ['torso'], dr: 1, flexible: true, concealable: true },
    },
  ],
  languages: [],
  techniques: [],
  styles: [],
  enchantments: [],
  activeEffects: [],
} as unknown as LocalLibrary;

describe('LibraryPackageEditor draft retention', () => {
  it('names each invalid row that blocks package review until corrected', async () => {
    const onReview = vi.fn();
    render(
      <LibraryPackageEditor
        campaign={campaign}
        library={library}
        onReview={onReview}
        onCancel={vi.fn()}
      />,
    );
    const openBasePoints = () => {
      const input = screen
        .getAllByLabelText('Base points')
        .find((candidate) => !candidate.closest('[hidden]'));
      if (!input) throw new Error('no open Base points field');
      return input;
    };

    fireEvent.click(screen.getByRole('button', { name: 'Night Vision' }));
    const points = openBasePoints();
    fireEvent.change(points, { target: { value: 'not a number' } });
    fireEvent.blur(points);
    fireEvent.click(screen.getByRole('button', { name: 'High Jump' }));
    const highJumpPoints = openBasePoints();
    fireEvent.change(highJumpPoints, { target: { value: '-2' } });
    fireEvent.blur(highJumpPoints);
    fireEvent.change(screen.getByLabelText('Edit category'), { target: { value: 'skills' } });
    fireEvent.change(screen.getByLabelText('Edit category'), { target: { value: 'traits' } });

    fireEvent.click(screen.getByRole('button', { name: 'Night Vision' }));
    expect(openBasePoints()).toHaveValue('not a number');
    fireEvent.click(screen.getByRole('button', { name: 'Review package' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Traits: Night Vision — Base points: Expected number, received string',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('library.traits.0.basePoints');
    expect(onReview).not.toHaveBeenCalled();

    fireEvent.change(openBasePoints(), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'High Jump' }));
    fireEvent.change(openBasePoints(), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review package' }));
    await waitFor(() => expect(onReview).toHaveBeenCalledTimes(1));
  });

  it('names multiple invalid item rows that block package review', async () => {
    const onReview = vi.fn();
    const libraryWithOrdinaryError = {
      ...library,
      traits: library.traits.map((trait, index) =>
        index === 0 ? { ...trait, basePoints: 'not a number' } : trait,
      ),
    } as unknown as LocalLibrary;
    render(
      <LibraryPackageEditor
        campaign={campaign}
        library={libraryWithOrdinaryError}
        onReview={onReview}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Edit category'), { target: { value: 'items' } });
    const openDr = () => {
      const input = screen
        .getAllByLabelText('Damage resistance (DR)')
        .find((candidate) => !candidate.closest('[hidden]'));
      if (!input) throw new Error('no open Damage resistance (DR) field');
      return input;
    };

    fireEvent.click(screen.getByRole('button', { name: 'Iron vest' }));
    fireEvent.change(openDr(), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mail underlayer' }));
    fireEvent.change(openDr(), { target: { value: '-1' } });

    const alert = screen
      .getAllByRole('alert')
      .find((candidate) => candidate.textContent?.includes('Correct invalid fields'));
    expect(alert).toBeDefined();
    expect(alert).toHaveTextContent(
      'Correct invalid fields before reviewing this package: Items: Iron vest; Items: Mail underlayer.',
    );
    expect(alert).toHaveTextContent(
      'Traits: Night Vision — Base points: Expected number, received string',
    );
    expect(screen.getByRole('button', { name: 'Review package' })).toBeDisabled();
    expect(screen.queryByText(/library\.items\.0\.armor/)).not.toBeInTheDocument();
    expect(onReview).not.toHaveBeenCalled();
  });

  it('opens lens removals and reviews unchanged when a race has omitted profile arrays', async () => {
    const onReview = vi.fn();
    const libraryWithRaceAndLens = {
      ...library,
      races: [
        {
          id: '0193b3c0-f1f0-7000-8000-000000000020',
          campaignId: campaign.id,
          revision: 1,
          key: 'elf',
          name: 'Elf',
          kind: 'race',
          points: 0,
          attributeModifiers: {},
          tags: [],
        },
        {
          id: '0193b3c0-f1f0-7000-8000-000000000021',
          campaignId: campaign.id,
          revision: 1,
          key: 'keen-senses',
          name: 'Keen senses lens',
          kind: 'lens',
          compatibleRaceKeys: ['elf'],
          removesTraits: ['night-vision'],
          removesSkills: ['bow'],
          tags: [],
        },
      ],
    } as unknown as LocalLibrary;
    render(
      <LibraryPackageEditor
        campaign={campaign}
        library={libraryWithRaceAndLens}
        onReview={onReview}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Edit category'), { target: { value: 'races' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keen senses lens' }));
    const summary = screen.getByText('Racial profile and options', { selector: 'summary' });
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    fireEvent.click(summary);
    await waitFor(() => expect(details).toHaveProperty('open', true));

    expect(screen.getByLabelText('Removes Traits 1 name')).toHaveValue('night-vision');
    expect(screen.getByLabelText('Removes Skills 1 name')).toHaveValue('bow');
    fireEvent.click(screen.getByRole('button', { name: 'Review package' }));
    await waitFor(() => expect(onReview).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
