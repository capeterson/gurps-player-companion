import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { NotificationsBell } from './components/NotificationsBell.tsx';
import { SyncStatusIndicator } from './components/SyncStatusIndicator.tsx';
import { api } from './lib/api.ts';
import { applyTheme, oppositeTheme, readStoredTheme, storeTheme, themeLabel } from './lib/theme.ts';
import type { ThemeName } from './lib/theme.ts';
import { tokenStore } from './lib/tokenStore.ts';
import { getSyncOrchestrator } from './sync/orchestrator.ts';

const NAV_TABS = [{ to: '/characters', label: 'Sheet' }] as const;

const CAMPAIGN_ROOT = '/campaigns';
const CAMPAIGN_SUBNAV = [
  { to: '/log', label: 'Log' },
  { to: '/library', label: 'Library' },
] as const;

const CAMPAIGN_PATHS = new Set<string>([CAMPAIGN_ROOT, ...CAMPAIGN_SUBNAV.map((t) => t.to)]);

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  isSuperuser: boolean;
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const campaignActive = CAMPAIGN_PATHS.has(location.pathname);
  const [theme, setTheme] = useState<ThemeName>(() => readStoredTheme());
  const campaignMenuRef = useRef<HTMLDetailsElement>(null);
  const userMenuRef = useRef<HTMLDetailsElement>(null);
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });

  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
  }, [theme]);

  // Close header dropdowns when the route changes — the <details> element
  // doesn't auto-close, so navigating from a menu item leaves it open otherwise.
  const pathname = location.pathname;
  useEffect(() => {
    void pathname;
    if (campaignMenuRef.current) campaignMenuRef.current.open = false;
    if (userMenuRef.current) userMenuRef.current.open = false;
  }, [pathname]);

  // Close header dropdowns on outside click, matching standard menu UX.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (campaignMenuRef.current?.open && !campaignMenuRef.current.contains(target)) {
        campaignMenuRef.current.open = false;
      }
      if (userMenuRef.current?.open && !userMenuRef.current.contains(target)) {
        userMenuRef.current.open = false;
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

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
      <header className="sticky top-0 z-50 flex w-full items-center justify-between gap-2 border-b border-base-300 bg-base-100/95 px-3 py-2 backdrop-blur sm:gap-6 sm:px-7 sm:py-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link to="/" className="flex items-center gap-2 no-cap sm:gap-3">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-primary font-display text-base font-bold text-primary-content"
            >
              G
            </span>
            <span className="hidden font-display text-base font-semibold sm:inline">
              Player Companion
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV_TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  `rounded-field px-3 py-2 text-sm font-medium transition sm:px-3.5 ${
                    isActive
                      ? 'bg-base-200 text-base-content'
                      : 'text-muted hover:bg-base-200 hover:text-base-content'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
            <div
              className={`flex items-center rounded-field transition ${
                campaignActive ? 'bg-base-200' : ''
              }`}
            >
              <NavLink
                to={CAMPAIGN_ROOT}
                end
                className={({ isActive }) =>
                  `rounded-l-field px-3 py-2 text-sm font-medium transition sm:px-3.5 ${
                    isActive || campaignActive
                      ? 'text-base-content'
                      : 'text-muted hover:bg-base-200 hover:text-base-content'
                  }`
                }
              >
                Campaign
              </NavLink>
              <details ref={campaignMenuRef} className="dropdown relative z-50">
                <summary
                  className={`flex cursor-pointer list-none items-center rounded-r-field px-2 py-2 text-sm transition ${
                    campaignActive
                      ? 'text-base-content'
                      : 'text-muted hover:bg-base-200 hover:text-base-content'
                  }`}
                  aria-label="Campaign sub-menu"
                >
                  <span aria-hidden="true">▾</span>
                </summary>
                <ul className="menu dropdown-content z-50 mt-2 w-40 rounded-box border border-base-300 bg-base-100 p-2 shadow-arcane-lg">
                  {CAMPAIGN_SUBNAV.map((tab) => (
                    <li key={tab.to}>
                      <NavLink
                        to={tab.to}
                        className={({ isActive }) => (isActive ? 'active' : undefined)}
                      >
                        {tab.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <SyncStatusIndicator />
          <NotificationsBell />
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-2 px-2 sm:px-3"
            onClick={toggleTheme}
            aria-label={`Switch to ${themeLabel(oppositeTheme(theme))} mode`}
            title={`Switch to ${themeLabel(oppositeTheme(theme))} mode`}
          >
            {themeLabel(theme) === 'Dark' ? <SunIcon /> : <MoonIcon />}
            <span className="hidden sm:inline">{themeLabel(theme)} mode</span>
          </button>
          <details ref={userMenuRef} className="dropdown dropdown-end relative z-50">
            <summary className="btn btn-ghost btn-sm" aria-label="Open user menu">
              <span className="hidden sm:inline text-muted">Signed in as</span>
              <span className="max-w-[8rem] truncate sm:max-w-none">
                {me.data?.displayName ?? 'Account'}
              </span>
              <span aria-hidden="true">▾</span>
            </summary>
            <ul className="menu dropdown-content z-50 mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-arcane-lg">
              <li className="menu-title px-3 py-2">
                <span>{me.data?.email ?? 'Loading account…'}</span>
              </li>
              <li>
                <Link to="/settings">Settings</Link>
              </li>
              {me.data?.isSuperuser && (
                <>
                  <li className="menu-title px-3 pt-2">
                    <span>Admin</span>
                  </li>
                  {/* Hard-anchor: admin lives in a separate Vite entry
                      (see src/client/admin/main.tsx) so SPA Link won't
                      cross the bundle boundary. */}
                  <li>
                    <a href="/admin/users">Users</a>
                  </li>
                  <li>
                    <a href="/admin/campaigns">Campaigns</a>
                  </li>
                </>
              )}
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

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m4.93 19.07 1.41-1.41" />
      <path d="m17.66 6.34 1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}
