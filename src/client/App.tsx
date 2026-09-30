import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { appBreadcrumbPage, useAppEntityBreadcrumb } from './components/AppBreadcrumbs.ts';
import { CharacterHeaderChromeContext } from './components/CharacterHeaderChromeContext.tsx';
import { NotificationsBell } from './components/NotificationsBell.tsx';
import { SyncStatusIndicator } from './components/SyncStatusIndicator.tsx';
import { AppIcon } from './components/ui/AppIcon.tsx';
import { BrandMark } from './components/ui/BrandMark.tsx';
import { clearAllTableFilters } from './components/ui/Table.tsx';
import { clearAllAttackTablePreferences } from './features/characters/sections/combat/attackTablePreferences.ts';
import { clearAllDefenseTablePreferences } from './features/characters/sections/combat/defenseTablePreferences.ts';
import { clearAllRollHistory } from './features/characters/sections/rollHistory.ts';
import { clearAllSkillTablePreferences } from './features/characters/sections/skillTablePreferences.ts';
import { clearAllSpellTablePreferences } from './features/characters/sections/spellTablePreferences.ts';
import { clearAllTraitTablePreferences } from './features/characters/sections/traitTablePreferences.ts';
import { clearAllLibraryTablePreferences } from './features/library/libraryTablePreferences.ts';
import { useUnsyncedChangesGuard } from './hooks/useUnsyncedChangesGuard.tsx';
import { useViewportBoundedOverlay } from './hooks/useViewportBoundedOverlay.ts';
import { api } from './lib/api.ts';
import { clearSessionQueryCache } from './lib/sessionQueryCache.tsx';
import {
  clearPendingThemePreferences,
  modeLabel,
  oppositeMode,
  setThemeMode,
  useThemeState,
} from './lib/theme.ts';
import { useThemePreferenceSync } from './lib/themeSync.ts';
import { tokenStore } from './lib/tokenStore.ts';
import { getSyncOrchestrator } from './sync/orchestrator.ts';

const CAMPAIGN_ROOT = '/campaigns';
const CAMPAIGN_PATHS = new Set<string>([CAMPAIGN_ROOT, '/log', '/library']);

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
  const entityBreadcrumb = useAppEntityBreadcrumb(location.pathname, location.search);
  const campaignPage = appBreadcrumbPage(location.pathname);
  const characterActive =
    location.pathname === '/characters' || entityBreadcrumb?.kind === 'character';
  const characterDetail = /^\/characters\/[^/]+\/?$/.test(location.pathname);
  const campaignActive =
    CAMPAIGN_PATHS.has(location.pathname) || entityBreadcrumb?.kind === 'campaign';
  const { mode } = useThemeState();
  const mobileCharacterMenuRef = useRef<HTMLDetailsElement>(null);
  const userMenuRef = useRef<HTMLDetailsElement>(null);
  const mobileCharacterMenuPanelRef = useViewportBoundedOverlay<HTMLUListElement>();
  const userMenuPanelRef = useViewportBoundedOverlay<HTMLUListElement>();
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });

  useThemePreferenceSync();
  const discardGuard = useUnsyncedChangesGuard();

  // Close header dropdowns when the route changes — the <details> element
  // doesn't auto-close, so navigating from a menu item leaves it open otherwise.
  const pathname = location.pathname;
  useEffect(() => {
    void pathname;
    if (mobileCharacterMenuRef.current) mobileCharacterMenuRef.current.open = false;
    if (userMenuRef.current) userMenuRef.current.open = false;
  }, [pathname]);

  // Close header dropdowns on outside click, matching standard menu UX.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        mobileCharacterMenuRef.current?.open &&
        !mobileCharacterMenuRef.current.contains(target)
      ) {
        mobileCharacterMenuRef.current.open = false;
      }
      if (userMenuRef.current?.open && !userMenuRef.current.contains(target)) {
        userMenuRef.current.open = false;
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (mobileCharacterMenuRef.current) mobileCharacterMenuRef.current.open = false;
      if (userMenuRef.current) userMenuRef.current.open = false;
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
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
    clearPendingThemePreferences();
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
    clearAllSkillTablePreferences();
    clearAllSpellTablePreferences();
    clearAllTraitTablePreferences();
    clearAllLibraryTablePreferences();
    clearAllTableFilters();
    navigate('/login');
  }

  function toggleTheme() {
    setThemeMode(oppositeMode(mode));
  }

  const characterName = entityBreadcrumb?.kind === 'character' ? entityBreadcrumb.name : null;
  const mobileCharacterMenu = (
    <nav aria-label="Character and app navigation" className="min-w-0 overflow-visible">
      <details ref={mobileCharacterMenuRef} className="dropdown relative w-full min-w-0">
        <summary
          className="btn btn-ghost btn-sm min-h-11! w-full min-w-0 max-w-full justify-center gap-1 overflow-hidden rounded-none px-0 min-[480px]:justify-start min-[480px]:px-2"
          aria-label={`Open navigation for ${characterName ?? 'character'}`}
          title={characterName ?? 'Character navigation'}
        >
          <AppIcon name="menu" size={20} />
          <span className="hidden min-w-0 flex-1 truncate text-left text-xs font-medium min-[480px]:block">
            {characterName ?? 'Character'}
          </span>
          <AppIcon name="chevronDown" size={12} className="hidden min-[480px]:block" />
        </summary>
        <ul
          ref={mobileCharacterMenuPanelRef}
          style={{ marginLeft: 'var(--viewport-overlay-shift-x, 0px)' }}
          className="menu dropdown-content z-50 mt-1 w-52 max-w-[calc(100dvw-1rem)] [overflow-wrap:anywhere] rounded-box border border-base-300 bg-base-100 p-2 shadow-arcane-lg"
        >
          <li className="menu-title px-3 py-2">
            <span>{characterName ?? 'Character'}</span>
          </li>
          <li>
            <Link to="/">Home</Link>
          </li>
          <li>
            <Link to="/characters">Characters</Link>
          </li>
          <li>
            <Link to="/campaigns">Campaigns</Link>
          </li>
          <li>
            <Link to="/settings">Settings</Link>
          </li>
          <li>
            <Link to="/about">About</Link>
          </li>
          <li>
            <button type="button" onClick={toggleTheme}>
              Switch to {modeLabel(oppositeMode(mode))} mode
            </button>
          </li>
          <li className="menu-title px-3 py-2">
            <span>{me.data ? `${me.data.displayName} · ${me.data.email}` : 'Account'}</span>
          </li>
          {me.data?.isSuperuser && (
            <>
              <li>
                <a href="/admin/users">Admin users</a>
              </li>
              <li>
                <a href="/admin/campaigns">Admin campaigns</a>
              </li>
            </>
          )}
          <li>
            <button type="button" onClick={() => void discardGuard.guard('signOut', signOut)}>
              Logout
            </button>
          </li>
        </ul>
      </details>
    </nav>
  );

  return (
    <CharacterHeaderChromeContext.Provider
      value={{
        menu: mobileCharacterMenu,
        actions: (
          <div className="relative flex w-full shrink-0 items-center justify-end before:absolute before:inset-y-2 before:left-0 before:w-px before:bg-base-300/70 before:content-[''] [&>details]:shrink-0 [&>span]:shrink-0">
            <SyncStatusIndicator triggerClassName="min-h-11! h-11! w-11! shrink-0! rounded-none! border-0! shadow-none!" />
            <NotificationsBell triggerClassName="min-h-11! h-11! w-11! shrink-0! rounded-none! border-0! shadow-none!" />
          </div>
        ),
      }}
    >
      <div className="arcane-edge min-h-screen bg-base-200 text-base-content">
        <header
          className={`app-header sticky top-0 z-50 flex w-full flex-wrap items-center justify-between gap-2 border-b border-base-300 px-3 py-2 sm:gap-6 sm:px-7 sm:py-3 ${characterDetail ? 'gap-y-0 bg-base-100 max-[1280px]:px-2! max-[1280px]:py-1! sm:gap-y-0' : 'bg-base-100/95 backdrop-blur'}`}
        >
          <div className="app-header-normal flex min-w-0 items-center gap-3 sm:gap-6">
            <Link to="/" className="flex items-center gap-2 no-cap sm:gap-3">
              <BrandMark />
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
                {campaignPage && (
                  <>
                    <span aria-hidden="true" className="text-dim">
                      ›
                    </span>
                    <span
                      aria-current="page"
                      className="max-w-28 truncate px-2 py-2 text-sm font-medium text-base-content sm:max-w-40"
                    >
                      {campaignPage}
                    </span>
                  </>
                )}
              </div>
            </nav>
          </div>
          <div className="app-header-normal flex shrink-0 items-center gap-1 sm:gap-3">
            <SyncStatusIndicator />
            <NotificationsBell />
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-2 px-2 sm:px-3"
              onClick={toggleTheme}
              aria-label={`Switch to ${modeLabel(oppositeMode(mode))} mode`}
              title={`Switch to ${modeLabel(oppositeMode(mode))} mode`}
            >
              <AppIcon name={mode === 'dark' ? 'sun' : 'moon'} size={20} />
              <span className="hidden sm:inline">{modeLabel(mode)} mode</span>
            </button>
            <details ref={userMenuRef} className="dropdown dropdown-end relative z-50">
              <summary className="btn btn-ghost btn-sm" aria-label="Open user menu">
                <span className="hidden sm:inline text-muted">Signed in as</span>
                <span className="max-w-[8rem] truncate sm:max-w-[12rem] lg:max-w-none">
                  {me.data?.displayName ?? 'Account'}
                </span>
                <AppIcon name="chevronDown" size={14} />
              </summary>
              <ul
                ref={userMenuPanelRef}
                style={{ marginRight: 'calc(0px - var(--viewport-overlay-shift-x, 0px))' }}
                className="menu dropdown-content z-50 mt-2 w-56 max-w-[calc(100dvw-1rem)] [overflow-wrap:anywhere] rounded-box border border-base-300 bg-base-100 p-2 shadow-arcane-lg"
              >
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
                  <button type="button" onClick={() => void discardGuard.guard('signOut', signOut)}>
                    Logout
                  </button>
                </li>
              </ul>
            </details>
          </div>
          <div
            id="character-status-header-slot"
            className={characterDetail ? 'empty:hidden w-full' : 'hidden'}
          />
        </header>
        <main className="relative z-0 mx-auto w-full max-w-[80rem] p-4 sm:p-7">
          <Outlet />
        </main>
        {discardGuard.dialog}
      </div>
    </CharacterHeaderChromeContext.Provider>
  );
}
