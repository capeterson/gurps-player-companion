import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { SyncStatusIndicator } from './components/SyncStatusIndicator.tsx';
import { api } from './lib/api.ts';
import { applyTheme, oppositeTheme, readStoredTheme, storeTheme, themeLabel } from './lib/theme.ts';
import type { ThemeName } from './lib/theme.ts';
import { tokenStore } from './lib/tokenStore.ts';
import { getSyncOrchestrator } from './sync/orchestrator.ts';

const NAV_TABS = [
  { to: '/characters', label: 'Sheet' },
  { to: '/log', label: 'Log' },
  { to: '/library', label: 'Library' },
  { to: '/campaigns', label: 'Campaign' },
] as const;

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
}

export function App() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeName>(() => readStoredTheme());
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });

  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
  }, [theme]);

  async function signOut() {
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
    // Wipe the local Dexie before navigating so account switching on
    // the same device never leaks the previous user's rows into a
    // useLiveQuery render.
    await getSyncOrchestrator().purge();
    navigate('/login');
  }

  function toggleTheme() {
    setTheme((current) => oppositeTheme(current));
  }

  return (
    <div className="arcane-edge min-h-screen bg-base-200 text-base-content">
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-base-300 bg-base-100/95 px-4 py-3 backdrop-blur sm:px-7">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3 no-cap">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary font-display text-base font-bold text-primary-content"
            >
              G
            </span>
            <span className="font-display text-base font-semibold">Player Companion</span>
          </Link>
          <nav className="flex gap-1">
            {NAV_TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  `rounded-field px-3.5 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-base-200 text-base-content'
                      : 'text-muted hover:bg-base-200 hover:text-base-content'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <SyncStatusIndicator />
          <button type="button" className="btn btn-ghost btn-sm" onClick={toggleTheme}>
            {themeLabel(theme)} mode
          </button>
          <details className="dropdown dropdown-end relative z-50">
            <summary className="btn btn-ghost btn-sm" aria-label="Open user menu">
              <span className="hidden sm:inline text-muted">Signed in as</span>
              <span>{me.data?.displayName ?? 'Account'}</span>
              <span aria-hidden="true">▾</span>
            </summary>
            <ul className="menu dropdown-content z-50 mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-arcane-lg">
              <li className="menu-title px-3 py-2">
                <span>{me.data?.email ?? 'Loading account…'}</span>
              </li>
              <li>
                <Link to="/settings">Settings</Link>
              </li>
              <li>
                <button type="button" onClick={() => void signOut()}>
                  Logout
                </button>
              </li>
            </ul>
          </details>
        </div>
      </header>
      <main className="relative z-0 mx-auto w-full max-w-[80rem] p-4 sm:p-7">
        <Outlet />
      </main>
    </div>
  );
}
