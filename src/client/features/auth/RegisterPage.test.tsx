import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api.ts';
import { tokenStore } from '../../lib/tokenStore.ts';
import { RegisterPage } from './RegisterPage.tsx';

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

function renderRegister() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fakeTokens = { accessToken: 'access-abc', refreshToken: 'refresh-xyz', accessTokenExpiresIn: 3600 };

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/email/i), 'new@example.com');
  await user.type(screen.getByLabelText(/display name/i), 'Test User');
  await user.type(screen.getByLabelText(/password/i), 'password123');
  await user.click(screen.getByRole('button', { name: /create account/i }));
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the registration form', () => {
    renderRegister();
    expect(screen.getByRole('heading', { name: /create an account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('shows "email already in use" when server returns 409', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(409, 'email already in use'));
    const user = userEvent.setup();
    renderRegister();

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(screen.getByText('email already in use')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows generic fallback error for non-ApiError failures', async () => {
    vi.mocked(api).mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderRegister();

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(screen.getByText('registration failed')).toBeInTheDocument();
    });
  });

  it('clears previous error before a new submission attempt', async () => {
    vi.mocked(api)
      .mockRejectedValueOnce(new ApiError(409, 'email already in use'))
      .mockResolvedValue(fakeTokens);
    const user = userEvent.setup();
    renderRegister();

    await fillAndSubmit(user);
    await waitFor(() => expect(screen.getByText('email already in use')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() =>
      expect(screen.queryByText('email already in use')).not.toBeInTheDocument(),
    );
  });

  it('stores tokens and navigates to / on successful registration', async () => {
    vi.mocked(api).mockResolvedValue(fakeTokens);
    const user = userEvent.setup();
    renderRegister();

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(vi.mocked(tokenStore.write)).toHaveBeenCalledWith(fakeTokens);
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });
});
