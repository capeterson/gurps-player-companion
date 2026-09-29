import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '../../lib/toast.tsx';
import { CharacterCard } from './CharacterCard.tsx';

const character = {
  id: 'character-1',
  name: 'Marin Vale',
  campaignId: 'campaign-1',
  campaignName: 'The Long March',
  st: 11,
  dx: 12,
  iq: 13,
  ht: 14,
};

function renderCard(props: Partial<Parameters<typeof CharacterCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <CharacterCard character={character} {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('CharacterCard', () => {
  it('shows the character, independent campaign link, and attributes', () => {
    renderCard();

    expect(screen.getByRole('heading', { level: 2, name: 'Marin Vale' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Marin Vale' })).toHaveAttribute(
      'href',
      '/characters/character-1',
    );
    expect(screen.getByRole('link', { name: 'The Long March' })).toHaveAttribute(
      'href',
      '/campaigns/campaign-1',
    );
    const card = screen.getByRole('article');
    expect(within(card).getByText('ST 11')).toBeInTheDocument();
    expect(within(card).getByText('DX 12')).toBeInTheDocument();
    expect(within(card).getByText('IQ 13')).toBeInTheDocument();
    expect(within(card).getByText('HT 14')).toBeInTheDocument();
  });

  it('hides attributes for a minimal viewer while retaining character navigation', () => {
    renderCard({ hideAttributes: true });

    expect(screen.getByRole('link', { name: 'Marin Vale' })).toHaveAttribute(
      'href',
      '/characters/character-1',
    );
    expect(screen.getByRole('link', { name: 'The Long March' })).toBeInTheDocument();
    expect(screen.queryByText(/\b(?:ST 11|DX 12|IQ 13|HT 14)\b/)).not.toBeInTheDocument();
  });

  it('keeps a campaignless character card free of an empty campaign row', () => {
    renderCard({ character: { ...character, campaignId: null, campaignName: null } });

    expect(screen.getByRole('heading', { level: 2, name: 'Marin Vale' })).toBeInTheDocument();
    expect(screen.queryByText(/^Campaign:/)).not.toBeInTheDocument();
    expect(screen.getByText('ST 11')).toBeInTheDocument();
  });

  it('supports card children and a new-tab character link', () => {
    renderCard({
      openInNewTab: true,
      children: <button type="button">Open status</button>,
    });

    expect(screen.getByRole('link', { name: 'Marin Vale' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: 'Open status' })).toBeInTheDocument();
  });
});
