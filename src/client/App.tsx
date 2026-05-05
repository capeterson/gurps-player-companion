import { useIsMutating, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { api } from './lib/api.ts';
import { applyTheme, oppositeTheme, readStoredTheme, storeTheme, themeLabel } from './lib/theme.ts';
import type { ThemeName } from './lib/theme.ts';
import { tokenStore } from './lib/tokenStore.ts';

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
}

export function App() {
  const navigate = useNavigate();
  const isMutating = useIsMutating();
  const [theme, setTheme] = useState<ThemeName>(() => readStoredTheme());
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });

  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
  }, [theme]);

  function signOut() {
    const tokens = tokenStore.read();
    if (tokens) {
      // Best-effort: revoke the refresh token server-side so it can't be reused.
      api('/auth/logout', {
        method: 'POST',
        body: { refreshToken: tokens.refreshToken },
        authenticated: false,
      }).catch(() => {});
    }
    tokenStore.clear();
    navigate('/login');
  }

  function toggleTheme() {
    setTheme((current) => oppositeTheme(current));
  }

  return (
    <div className="arcane-edge min-h-screen bg-base-100 text-base-content">
      <header className="navbar relative z-50 bg-base-200/95 border-b border-base-300 backdrop-blur">
        <div className="flex-1 flex items-center gap-4 px-4">
          <Link to="/" className="font-display text-xl">
            GURPS Player Companion
          </Link>
          <nav className="flex gap-2">
            <Link to="/characters" className="btn btn-ghost btn-sm">
              Characters
            </Link>
          </nav>
        </div>
        <div className="flex-none flex items-center gap-3 px-4">
          {isMutating > 0 && (
            <span className="badge badge-primary badge-sm" aria-live="polite" aria-label="Saving">
              <span className="inline-block w-2 h-2 bg-current rounded-full animate-pulse mr-1" />
              saving · {isMutating}
            </span>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={toggleTheme}>
            {themeLabel(theme)} mode
          </button>
          <details className="dropdown dropdown-end relative z-50">
            <summary className="btn btn-ghost btn-sm" aria-label="Open user menu">
              <span className="hidden sm:inline text-muted">Signed in as</span>
              <span>{me.data?.displayName ?? 'Account'}</span>
              <span aria-hidden="true">▾</span>
            </summary>
            <ul className="menu dropdown-content z-50 mt-2 w-56 rounded-box border border-base-300 bg-base-200 p-2 shadow-xl">
              <li className="menu-title px-3 py-2">
                <span>{me.data?.email ?? 'Loading account…'}</span>
              </li>
              <li>
                <Link to="/settings">Settings</Link>
              </li>
              <li>
                <button type="button" onClick={signOut}>
                  Logout
                </button>
              </li>
            </ul>
          </details>
        </div>
      </header>
      <main className="relative z-0 container mx-auto p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
