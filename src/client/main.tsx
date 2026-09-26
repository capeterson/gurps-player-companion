import { QueryClientProvider } from '@tanstack/react-query';
import { polyfill as mobileDragDropPolyfill } from 'mobile-drag-drop';
import 'mobile-drag-drop/default.css';
import { StrictMode } from 'react';
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
 * loads as its own chunk. Workbox precaches every chunk, so offline
 * navigation still works.
 */
function page<M, N extends keyof M>(
  load: () => Promise<M>,
  name: N,
): () => Promise<{ Component: M[N] }> {
  return async () => ({ Component: (await load())[name] });
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
                lazy: page(
                  () => import('./features/characters/CharactersPage.tsx'),
                  'CharactersPage',
                ),
              },
              {
                path: '/characters/:id',
                lazy: page(
                  () => import('./features/characters/CharacterSheetPage.tsx'),
                  'CharacterSheetPage',
                ),
              },
              {
                path: '/campaigns',
                lazy: page(() => import('./features/campaigns/CampaignsPage.tsx'), 'CampaignsPage'),
              },
              {
                path: '/campaigns/:id',
                lazy: page(
                  () => import('./features/campaigns/CampaignDetailPage.tsx'),
                  'CampaignDetailPage',
                ),
              },
              {
                path: '/campaigns/:id/library',
                lazy: page(
                  () => import('./features/campaigns/CampaignLibraryPage.tsx'),
                  'CampaignLibraryPage',
                ),
              },
              {
                path: '/campaigns/:id/gm',
                lazy: page(
                  () => import('./features/campaigns/GmCampaignDashboardPage.tsx'),
                  'GmCampaignDashboardPage',
                ),
              },
              {
                path: '/campaigns/:id/encounters/:encounterId',
                lazy: page(
                  () => import('./features/encounters/EncounterPage.tsx'),
                  'EncounterPage',
                ),
              },
              { path: '/log', lazy: page(() => import('./features/log/LogPage.tsx'), 'LogPage') },
              {
                path: '/library',
                lazy: page(() => import('./features/library/LibraryPage.tsx'), 'LibraryPage'),
              },
              {
                path: '/about',
                lazy: page(() => import('./features/about/AboutPage.tsx'), 'AboutPage'),
              },
              {
                path: '/settings',
                lazy: page(() => import('./features/settings/SettingsPage.tsx'), 'SettingsPage'),
              },
            ],
          },
        ],
      },
    ],
  },
]);

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
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
