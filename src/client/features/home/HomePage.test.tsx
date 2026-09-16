import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api.ts';
import { useCharactersList } from '../characters/useCharacterDetail.ts';
import { HomePage } from './HomePage.tsx';

vi.mock('../../lib/api.ts', () => ({ api: vi.fn() }));
vi.mock('../characters/useCharacterDetail.ts', () => ({ useCharactersList: vi.fn() }));

function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada',
    });
    vi.mocked(useCharactersList).mockReturnValue([
      {
        id: 'character-1',
        ownerId: 'user-1',
        campaignId: null,
        name: 'Marin',
        st: 11,
        dx: 12,
        iq: 13,
        ht: 10,
        updatedAt: '2026-09-15T12:00:00.000Z',
        revision: 1,
      },
    ]);
  });

  it('keeps recent characters without duplicating persistent navigation', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Ada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Marin/ })).toHaveAttribute(
      'href',
      '/characters/character-1',
    );
    expect(screen.queryByRole('link', { name: 'Open Sheet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Adventure Log' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Campaigns' })).not.toBeInTheDocument();
  });
});
