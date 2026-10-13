import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../../lib/tokenStore.ts';
import { LandingPage } from '../home/LandingPage.tsx';
import { PreviewEntryPage } from './PreviewEntryPage.tsx';

const CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-00000000ca01';

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/preview" element={<PreviewEntryPage />} />
        <Route path="/campaigns/:id" element={<h1>Campaign page</h1>} />
        <Route path="/home" element={<h1>Signed-in home</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tokenStore.clear();
});

describe('Try without an account', () => {
  it('offers the preview on the landing page only when the server provides it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { available: true })));
    renderAt('/');
    const link = await screen.findByRole('link', { name: 'Try without an account' });
    expect(link).toHaveAttribute('href', '/preview');
    expect(
      screen.getByText(
        'Explore the Lantern Coast sample campaign, its party, and their character sheets in a read-only preview.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Take a look' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your account' })).toBeInTheDocument();
  });

  it('hides the preview when the server does not offer it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { available: false }));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Try without an account' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your account' })).toBeInTheDocument();
  });

  it('starts a guest session and opens the preview campaign', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        accessToken: 'guest',
        accessTokenExpiresIn: 7200,
        campaignId: CAMPAIGN_ID,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/preview');

    expect(await screen.findByRole('heading', { name: 'Campaign page' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(tokenStore.read()?.guest).toEqual({ campaignId: CAMPAIGN_ID });
  });

  it('explains a failure and retries on request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: 'preview_unavailable' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: 'guest',
          accessTokenExpiresIn: 7200,
          campaignId: CAMPAIGN_ID,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/preview');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The preview is not available right now.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Campaign page' })).toBeInTheDocument();
  });

  it('keeps a signed-in session instead of replacing it with a guest', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    tokenStore.write({ accessToken: 'mine', refreshToken: 'refresh', accessTokenExpiresIn: 900 });
    render(
      <MemoryRouter initialEntries={['/preview']}>
        <Routes>
          <Route path="/" element={<h1>Signed-in home</h1>} />
          <Route path="/preview" element={<PreviewEntryPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Signed-in home' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tokenStore.read()?.accessToken).toBe('mine');
  });
});
