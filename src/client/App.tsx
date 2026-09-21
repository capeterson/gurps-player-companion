import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppEntityBreadcrumb } from './components/AppBreadcrumbs.ts';
import { NotificationsBell } from './components/NotificationsBell.tsx';
import { SyncStatusIndicator } from './components/SyncStatusIndicator.tsx';
import { AppIcon } from './components/ui/AppIcon.tsx';
import { clearAllAttackTablePreferences } from './features/characters/sections/combat/attackTablePreferences.ts';
import { clearAllDefenseTablePreferences } from './features/characters/sections/combat/defenseTablePreferences.ts';
import { clearAllRollHistory } from './features/characters/sections/rollHistory.ts';
import { api } from './lib/api.ts';
import { clearSessionQueryCache } from './lib/sessionQueryCache.tsx';
import { applyTheme, oppositeTheme, readStoredTheme, storeTheme, themeLabel } from './lib/theme.ts';
import type { ThemeName } from './lib/theme.ts';
import { tokenStore } from './lib/tokenStore.ts';
import { getSyncOrchestrator } from './sync/orchestrator.ts';

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
  const queryClient = useQueryClient();
  const location = useLocation();
  const entityBreadcrumb = useAppEntityBreadcrumb(location.pathname);
  const characterActive =
    location.pathname === '/characters' || entityBreadcrumb?.kind === 'character';
  const campaignActive =
    CAMPAIGN_PATHS.has(location.pathname) || entityBreadcrumb?.kind === 'campaign';
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
    clearSessionQueryCache(queryClient);
    tokenStore.clear();
    // Wipe the local Dexie before navigating so account switching on
    // the same device never leaks the previous user's rows into a
    // useLiveQuery render.
    await getSyncOrchestrator().purge();
    // Clear the browser-local roll history too — roll labels are
    // character/scene context the next user shouldn't see.
    clearAllRollHistory();
    clearAllAttackTablePreferences();
    clearAllDefenseTablePreferences();
    navigate('/login');
  }

  function toggleTheme() {
    setTheme((current) => oppositeTheme(current));
  }

  return (
    <div className="arcane-edge min-h-screen bg-base-200 text-base-content">
      <header className="sticky top-0 z-50 flex w-full flex-wrap items-center justify-between gap-2 border-b border-base-300 bg-base-100/95 px-3 py-2 backdrop-blur sm:gap-6 sm:px-7 sm:py-3">
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
          <nav
            aria-label="Primary navigation"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
          >
            <div
              className={`flex min-w-0 items-center rounded-field transition ${
                characterActive ? 'bg-base-200' : ''
              }`}
            >
              <Link
                to="/characters"
                className={`rounded-field px-3 py-2 text-sm font-medium transition sm:px-3.5 ${
                  characterActive
                    ? 'text-base-content'
                    : 'text-muted hover:bg-base-200 hover:text-base-content'
                }`}
              >
                <AppIcon
                  name="identity"
                  size={16}
                  className="inline-block align-text-bottom mr-1.5"
                />
                Character
              </Link>
              {entityBreadcrumb?.kind === 'character' && (
                <>
                  <span aria-hidden="true" className="text-dim">
                    ›
                  </span>
                  <Link
                    to={`/characters/${entityBreadcrumb.id}`}
                    className="max-w-28 truncate rounded-field px-2 py-2 text-sm font-medium text-base-content transition hover:bg-base-300 sm:max-w-48 lg:max-w-80"
                    title={entityBreadcrumb.name}
                  >
                    {entityBreadcrumb.name ?? 'Loading…'}
                  </Link>
                </>
              )}
            </div>
            <div
              className={`flex min-w-0 items-center rounded-field transition ${
                campaignActive ? 'bg-base-200' : ''
              }`}
            >
              <Link
                to={CAMPAIGN_ROOT}
                className={`rounded-field px-3 py-2 text-sm font-medium transition sm:px-3.5 ${
                  campaignActive
                    ? 'text-base-content'
                    : 'text-muted hover:bg-base-200 hover:text-base-content'
                }`}
              >
                <AppIcon
                  name="campaign"
                  size={16}
                  className="inline-block align-text-bottom mr-1.5"
                />
                Campaign
              </Link>
              {entityBreadcrumb?.kind === 'campaign' && (
                <>
                  <span aria-hidden="true" className="text-dim">
                    ›
                  </span>
                  <Link
                    to={`/campaigns/${entityBreadcrumb.id}`}
                    className="max-w-28 truncate rounded-field px-2 py-2 text-sm font-medium text-base-content transition hover:bg-base-300 sm:max-w-48 lg:max-w-80"
                    title={entityBreadcrumb.name}
                  >
                    {entityBreadcrumb.name ?? 'Loading…'}
                  </Link>
                </>
              )}
              <details ref={campaignMenuRef} className="dropdown dropdown-end relative z-50">
                <summary
                  className={`flex cursor-pointer list-none items-center rounded-field px-2 py-2 text-sm transition ${
                    campaignActive
                      ? 'text-base-content'
                      : 'text-muted hover:bg-base-200 hover:text-base-content'
                  }`}
                  aria-label="Campaign sub-menu"
                >
                  <AppIcon name="chevronDown" size={14} />
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
            <AppIcon name={themeLabel(theme) === 'Dark' ? 'sun' : 'moon'} size={20} />
            <span className="hidden sm:inline">{themeLabel(theme)} mode</span>
          </button>
          <details ref={userMenuRef} className="dropdown dropdown-end relative z-50">
            <summary className="btn btn-ghost btn-sm" aria-label="Open user menu">
              <span className="hidden sm:inline text-muted">Signed in as</span>
              <span className="max-w-[8rem] truncate sm:max-w-none">
                {me.data?.displayName ?? 'Account'}
              </span>
              <AppIcon name="chevronDown" size={14} />
            </summary>
            <ul className="menu dropdown-content z-50 mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-arcane-lg">
              <li className="menu-title px-3 py-2">
                <span>{me.data?.email ?? 'Loading account…'}</span>
              </li>
              <li>
                <Link to="/about">About</Link>
              </li>
              <li>
                <Link to="/settings">
                  <AppIcon name="settings" size={16} />
                  Settings
                </Link>
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
