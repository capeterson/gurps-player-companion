import { QueryClientProvider } from '@tanstack/react-query';
import { polyfill as mobileDragDropPolyfill } from 'mobile-drag-drop';
import 'mobile-drag-drop/default.css';
import { type ComponentType, StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { registerSwLifecycle } from '../sw/registerSW.ts';
import { App } from './App.tsx';
import { AppErrorPage } from './components/AppErrorPage.tsx';
import { SwUpdatePrompt } from './components/SwUpdatePrompt.tsx';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage.tsx';
import { LoginPage } from './features/auth/LoginPage.tsx';
import { OAuthConsentPage } from './features/auth/OAuthConsentPage.tsx';
import { RegisterPage } from './features/auth/RegisterPage.tsx';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage.tsx';
import { SuspendedPage } from './features/auth/SuspendedPage.tsx';
import { HomePage } from './features/home/HomePage.tsx';
import { SessionQueryCacheBoundary, createSessionQueryClient } from './lib/sessionQueryCache.tsx';
import { applyTheme, readStoredTheme } from './lib/theme.ts';
import { ToastProvider } from './lib/toast.tsx';
import { RequireAuth } from './routes/RequireAuth.tsx';
import { RequireSessionOnly } from './routes/RequireSessionOnly.tsx';
import './styles/theme.css';

applyTheme(readStoredTheme());
registerSwLifecycle();

// Touch-device support for the inventory's HTML5 drag-and-drop.
// holdToDrag: a 350 ms long-press initiates drag, so quick swipes
// still scroll normally. forceApply: false skips browsers that
// already support touch DnD.
mobileDragDropPolyfill({ forceApply: false, holdToDrag: 350 });
// The polyfill fires contextmenu on long-press; suppress it inside
// draggable rows so iOS Safari's selection callout doesn't intercept
// the drag.
window.addEventListener('contextmenu', (e) => {
  if ((e.target as Element | null)?.closest('[draggable="true"]')) {
    e.preventDefault();
  }
});

/**
 * Route-level code splitting: each authenticated page (and heavy
 * dependencies only it uses, like the markdown editor or YAML parser)
 * loads as its own chunk, so the first screen downloads far less. Navigation
 * is immediate: the router applies updates outside transitions (see
 * `RouterProvider` below), so a page whose chunk is still loading shows
 * `PageLoading` rather than leaving the previous page on screen. Every page
 * chunk is warmed once the app is idle (`preloadPages`), so that spinner is
 * rare. Workbox precaches every chunk, so offline navigation still works.
 */
const pageLoaders: Array<() => Promise<unknown>> = [];

function page<M, N extends keyof M>(load: () => Promise<M>, name: N) {
  pageLoaders.push(load);
  const Page = lazy(async () => ({ default: (await load())[name] as ComponentType }));
  return (
    <Suspense fallback={<PageLoading />}>
      <Page />
    </Suspense>
  );
}

function preloadPages() {
  for (const load of pageLoaders) {
    // A failed warm-up is retried by the page's own lazy import on navigation.
    load().catch(() => undefined);
  }
}

function PageLoading() {
  return (
    <output className="flex justify-center py-16" aria-label="Loading page">
      <span className="loading loading-spinner loading-lg text-primary" aria-hidden="true" />
    </output>
  );
}

const queryClient = createSessionQueryClient();

const router = createBrowserRouter([
  {
    errorElement: <AppErrorPage />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/suspended', element: <SuspendedPage /> },
      {
        element: <RequireSessionOnly />,
        children: [{ path: '/oauth/consent', element: <OAuthConsentPage /> }],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <App />,
            children: [
              { path: '/', element: <HomePage /> },
              {
                path: '/characters',
                element: page(
                  () => import('./features/characters/CharactersPage.tsx'),
                  'CharactersPage',
                ),
              },
              {
                path: '/characters/:id',
                element: page(
                  () => import('./features/characters/CharacterSheetPage.tsx'),
                  'CharacterSheetPage',
                ),
              },
              {
                path: '/campaigns',
                element: page(
                  () => import('./features/campaigns/CampaignsPage.tsx'),
                  'CampaignsPage',
                ),
              },
              {
                path: '/campaigns/:id',
                element: page(
                  () => import('./features/campaigns/CampaignDetailPage.tsx'),
                  'CampaignDetailPage',
                ),
              },
              {
                path: '/campaigns/:id/library',
                element: page(
                  () => import('./features/campaigns/CampaignLibraryPage.tsx'),
                  'CampaignLibraryPage',
                ),
              },
              {
                path: '/campaigns/:id/gm',
                element: page(
                  () => import('./features/campaigns/GmCampaignDashboardPage.tsx'),
                  'GmCampaignDashboardPage',
                ),
              },
              {
                path: '/campaigns/:id/encounters/:encounterId',
                element: page(
                  () => import('./features/encounters/EncounterPage.tsx'),
                  'EncounterPage',
                ),
              },
              {
                path: '/log',
                element: page(() => import('./features/log/LogPage.tsx'), 'LogPage'),
              },
              {
                path: '/library',
                element: page(() => import('./features/library/LibraryPage.tsx'), 'LibraryPage'),
              },
              {
                path: '/about',
                element: page(() => import('./features/about/AboutPage.tsx'), 'AboutPage'),
              },
              {
                path: '/settings',
                element: page(() => import('./features/settings/SettingsPage.tsx'), 'SettingsPage'),
              },
            ],
          },
        ],
      },
    ],
  },
]);

if (typeof window.requestIdleCallback === 'function') {
  window.requestIdleCallback(preloadPages, { timeout: 2_000 });
} else {
  setTimeout(preloadPages, 1_000);
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionQueryCacheBoundary />
      <ToastProvider>
        {/* Inside ToastProvider: it announces SW updates through the
            toast API. Outside the router so the prompt survives
            navigation. */}
        <SwUpdatePrompt />
        {/* Plain (non-transition) navigation updates: a transition would keep the
            previous page on screen, still interactive, while a lazy page chunk
            loads; this shows the page spinner at once instead. */}
        <RouterProvider router={router} unstable_useTransitions={false} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
