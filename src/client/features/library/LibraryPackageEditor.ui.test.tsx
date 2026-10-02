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
  ],
  skills: [],
  spells: [],
  items: [],
  languages: [],
  techniques: [],
  styles: [],
  enchantments: [],
  activeEffects: [],
} as unknown as LocalLibrary;

describe('LibraryPackageEditor draft retention', () => {
  it('retains an invalid numeric draft across category switches and blocks review until fixed', async () => {
    const onReview = vi.fn();
    render(
      <LibraryPackageEditor
        campaign={campaign}
        library={library}
        onReview={onReview}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Night Vision' }));
    const points = screen.getByLabelText('Base points');
    fireEvent.change(points, { target: { value: 'not a number' } });
    fireEvent.change(screen.getByLabelText('Edit category'), { target: { value: 'skills' } });
    fireEvent.change(screen.getByLabelText('Edit category'), { target: { value: 'traits' } });

    expect(screen.getByLabelText('Base points')).toHaveValue('not a number');
    fireEvent.click(screen.getByRole('button', { name: 'Review package' }));
    expect(screen.getByRole('alert')).toHaveTextContent('library.traits.0.basePoints');
    expect(onReview).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Base points'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review package' }));
    await waitFor(() => expect(onReview).toHaveBeenCalledTimes(1));
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
