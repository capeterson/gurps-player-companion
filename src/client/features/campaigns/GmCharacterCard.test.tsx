import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { GmCharacterCard } from './GmCharacterCard.tsx';

it('hides attributes when linked mechanics are unavailable', () => {
  const character = {
    id: 'character-1',
    name: 'Marin Vale',
    portraitAssetId: null,
    campaignId: 'campaign-1',
    st: 11,
    dx: 12,
    iq: 13,
    ht: 14,
    libraryEffectsKnown: false,
  } as unknown as CharacterDetail;

  render(
    <MemoryRouter>
      <ToastProvider>
        <GmCharacterCard character={character} campaignName="The Long March" />
      </ToastProvider>
    </MemoryRouter>,
  );

  expect(screen.getByRole('heading', { level: 2, name: 'Marin Vale' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'The Long March' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Calculated stats and rolls are paused');
  expect(screen.queryByText(/\b(?:ST 11|DX 12|IQ 13|HT 14)\b/)).not.toBeInTheDocument();
});
