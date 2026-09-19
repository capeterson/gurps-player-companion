import { render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { AppErrorPage } from './AppErrorPage.tsx';

const USER_ID = '018f47de-4b4f-7a27-9e9f-4cb978edcafe';
const REQUEST_ID = '8d952a62-ee65-4faa-bce0-64b55ac56a96';

function jwtFor(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('AppErrorPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    tokenStore.clear();
  });

  it('replaces the default router 404 with a styled diagnostic page', async () => {
    const router = createMemoryRouter(
      [
        {
          errorElement: <AppErrorPage />,
          children: [{ path: '/', element: <p>Home</p> }],
        },
      ],
      { initialEntries: ['/missing-page'] },
    );

    const { container } = render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText(/^gpcerr_/)).toBeInTheDocument();
    expect(screen.getByText('/missing-page')).toBeInTheDocument();
    expect(screen.queryByText('User ID')).not.toBeInTheDocument();
    expect(container.querySelector('.arcane-edge')).not.toBeNull();
    await waitFor(() => expect(console.error).toHaveBeenCalled());
  });

  it('surfaces server and current-user IDs without exposing the raw error', async () => {
    tokenStore.write({
      accessToken: jwtFor(USER_ID),
      refreshToken: 'refresh-token',
      accessTokenExpiresIn: 900,
    });
    function BrokenPage(): never {
      throw new ApiError(500, 'sensitive internal detail', undefined, REQUEST_ID);
    }
    const router = createMemoryRouter([
      {
        path: '/',
        element: <BrokenPage />,
        errorElement: <AppErrorPage />,
      },
    ]);

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', { name: 'The app hit an unexpected error' }),
    ).toBeInTheDocument();
    expect(screen.getByText(REQUEST_ID)).toBeInTheDocument();
    expect(screen.getByText(USER_ID)).toBeInTheDocument();
    expect(screen.queryByText('sensitive internal detail')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        'client route error',
        expect.objectContaining({ requestId: REQUEST_ID, userId: USER_ID }),
        expect.any(ApiError),
      ),
    );
  });
});
