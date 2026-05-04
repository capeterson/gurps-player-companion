import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api.ts';
import { tokenStore } from '../../lib/tokenStore.ts';
import { LoginPage } from './LoginPage.tsx';

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...orig, api: vi.fn() };
});

vi.mock('../../lib/tokenStore.ts', () => ({
  tokenStore: {
    read: vi.fn().mockReturnValue(null),
    write: vi.fn(),
    clear: vi.fn(),
    hasToken: vi.fn().mockReturnValue(false),
  },
}));

function renderLogin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fakeTokens = {
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
  accessTokenExpiresIn: 3600,
};

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the sign-in form', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows the API error message on failed login', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(401, 'invalid credentials'));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('invalid credentials')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows generic fallback error for non-ApiError failures', async () => {
    vi.mocked(api).mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('login failed')).toBeInTheDocument();
    });
  });

  it('clears previous error before a new submission attempt', async () => {
    vi.mocked(api)
      .mockRejectedValueOnce(new ApiError(401, 'invalid credentials'))
      .mockResolvedValue(fakeTokens);
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('invalid credentials')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.queryByText('invalid credentials')).not.toBeInTheDocument());
  });

  it('stores tokens and navigates to / on successful login', async () => {
    vi.mocked(api).mockResolvedValue(fakeTokens);
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(vi.mocked(tokenStore.write)).toHaveBeenCalledWith(fakeTokens);
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
