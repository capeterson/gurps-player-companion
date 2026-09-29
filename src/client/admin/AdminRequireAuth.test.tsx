import { act, render, screen } from '@testing-library/react';
import { type ReactNode, StrictMode, useLayoutEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { tokenStore } from '../lib/tokenStore.ts';
import { AdminRequireAuth } from './AdminRequireAuth.tsx';

function renderAdmin(child: ReactNode = <h1>Admin users</h1>) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/login" element={<h1>Sign in</h1>} />
          <Route element={<AdminRequireAuth />}>
            <Route path="/admin/users" element={child} />
          </Route>
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

const tokens = { accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresIn: 900 };

describe('AdminRequireAuth', () => {
  beforeEach(() => tokenStore.clear());

  it('sends a signed-out visitor to the admin sign-in page', () => {
    renderAdmin();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Admin users' })).not.toBeInTheDocument();
  });

  it('opens authenticated admin routes without a player-data bootstrap', () => {
    tokenStore.write(tokens);
    renderAdmin();
    expect(screen.getByRole('heading', { name: 'Admin users' })).toBeVisible();
    expect(screen.queryByText('Bringing local data in sync…')).not.toBeInTheDocument();
  });

  it('returns to sign-in when the current session is cleared', () => {
    tokenStore.write(tokens);
    renderAdmin();
    expect(screen.getByRole('heading', { name: 'Admin users' })).toBeVisible();
    act(() => tokenStore.clear());
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Admin users' })).not.toBeInTheDocument();
  });
  it('observes a session cleared before its subscription is attached', () => {
    function ClearSession() {
      useLayoutEffect(() => tokenStore.clear(), []);
      return <h1>Admin users</h1>;
    }
    tokenStore.write(tokens);
    renderAdmin(<ClearSession />);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Admin users' })).not.toBeInTheDocument();
  });
});
