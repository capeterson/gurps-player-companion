import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LocalCampaign } from '../../db/dexie.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { CampaignWorkspaceHeader } from './CampaignWorkspaceHeader.tsx';
import type { CampaignWorkspace } from './useCampaignWorkspace.ts';

vi.mock('../../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api.ts')>()),
  api: vi.fn().mockResolvedValue({ enabled: false }),
}));

const campaign: LocalCampaign = {
  id: 'camp-1',
  name: 'The Lantern Coast',
  description: 'A coast of storms and old magic.',
  ownerId: 'owner',
  pointTarget: 250,
  disadvantageCap: 50,
  quirkCap: 5,
  manaLevel: 'normal',
  techLevel: 3,
  enforceAttributeCaps: true,
  shareCharacterSheets: true,
  allowGmCharacterEditing: false,
  experimentalTurnTracker: true,
  viewerRole: 'member',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  revision: 1,
};

function workspace(overrides: Partial<CampaignWorkspace> = {}): CampaignWorkspace {
  return {
    campaign,
    remoteCampaign: undefined,
    viewerId: 'member',
    viewerRole: 'member',
    canManage: false,
    isLoading: false,
    error: null,
    ...overrides,
  };
}

describe('CampaignWorkspaceHeader', () => {
  it('shows consistent campaign navigation from the local mirror and marks the current page', () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/campaigns/camp-1/library']}>
          <CampaignWorkspaceHeader campaignId="camp-1" workspace={workspace()} />
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(screen.getByRole('heading', { name: 'The Lantern Coast' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Campaign sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'href',
      '/campaigns/camp-1',
    );
    expect(screen.getByRole('link', { name: 'Adventure log' })).toHaveAttribute(
      'href',
      '/campaigns/camp-1/log',
    );
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Encounters' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'GM dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('reveals staff navigation while keeping settings honest when offline', () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/campaigns/camp-1/gm']}>
          <CampaignWorkspaceHeader
            campaignId="camp-1"
            workspace={workspace({ viewerRole: 'owner', canManage: true })}
          />
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(screen.getByRole('link', { name: 'GM dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDisabled();
  });
});
