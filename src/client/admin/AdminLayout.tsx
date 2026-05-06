/**
 * Minimal layout for the admin app.  Provides a thin header with a
 * "Back to app" hard link (it's a separate Vite entry — Link wouldn't
 * cross bundles), the admin's display name, and a sign-out action.
 *
 * No service-worker registration, no notifications bell, no sync UI —
 * the admin surface stays as small as possible per AGENTS.md.
 */

import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api.ts';
import { tokenStore } from '../lib/tokenStore.ts';

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  isSuperuser: boolean;
}

export function AdminLayout() {
  const navigate = useNavigate();
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });

  // Hard guard: a non-superuser who somehow lands here gets bounced to
  // the player app.  The server-side requireSuperuser is the real gate;
  // this just stops a brief flicker of admin chrome.
  if (me.data && !me.data.isSuperuser) {
    window.location.assign('/');
    return null;
  }

  async function signOut() {
    const tokens = tokenStore.read();
    if (tokens) {
      api('/auth/logout', {
        method: 'POST',
        body: { refreshToken: tokens.refreshToken },
        authenticated: false,
      }).catch((err: unknown) => {
        if (err instanceof ApiError) return; // best-effort revoke
      });
    }
    tokenStore.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="arcane-edge min-h-screen bg-base-200 text-base-content">
      <header className="sticky top-0 z-50 flex w-full items-center justify-between gap-2 border-b border-base-300 bg-base-100/95 px-3 py-3 backdrop-blur sm:gap-6 sm:px-7">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <a href="/" className="flex items-center gap-2 no-cap sm:gap-3">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-primary font-display text-base font-bold text-primary-content"
            >
              G
            </span>
            <span className="hidden font-display text-base font-semibold sm:inline">
              Player Companion · Admin
            </span>
          </a>
          <nav className="flex items-center gap-1">
            <NavLink
              to="/admin/users"
              className={({ isActive }) =>
                `rounded-field px-3 py-2 text-sm font-medium transition sm:px-3.5 ${
                  isActive
                    ? 'bg-base-200 text-base-content'
                    : 'text-muted hover:bg-base-200 hover:text-base-content'
                }`
              }
            >
              Users
            </NavLink>
            <NavLink
              to="/admin/campaigns"
              className={({ isActive }) =>
                `rounded-field px-3 py-2 text-sm font-medium transition sm:px-3.5 ${
                  isActive
                    ? 'bg-base-200 text-base-content'
                    : 'text-muted hover:bg-base-200 hover:text-base-content'
                }`
              }
            >
              Campaigns
            </NavLink>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a href="/" className="btn btn-ghost btn-sm">
            ← Back to app
          </a>
          <span className="text-xs text-base-content/60 hidden sm:inline">
            {me.data?.displayName ?? '…'}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="relative z-0 mx-auto w-full max-w-[80rem] p-4 sm:p-7">
        <Outlet />
      </main>
    </div>
  );
}
