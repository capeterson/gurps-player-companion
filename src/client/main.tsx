import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { polyfill as mobileDragDropPolyfill } from 'mobile-drag-drop';
import 'mobile-drag-drop/default.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { registerSwLifecycle } from '../sw/registerSW.ts';
import { App } from './App.tsx';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage.tsx';
import { LoginPage } from './features/auth/LoginPage.tsx';
import { RegisterPage } from './features/auth/RegisterPage.tsx';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage.tsx';
import { SuspendedPage } from './features/auth/SuspendedPage.tsx';
import { CampaignDetailPage } from './features/campaigns/CampaignDetailPage.tsx';
import { CampaignLibraryPage } from './features/campaigns/CampaignLibraryPage.tsx';
import { CampaignsPage } from './features/campaigns/CampaignsPage.tsx';
import { GmCampaignDashboardPage } from './features/campaigns/GmCampaignDashboardPage.tsx';
import { CharacterSheetPage } from './features/characters/CharacterSheetPage.tsx';
import { CharactersPage } from './features/characters/CharactersPage.tsx';
import { HomePage } from './features/home/HomePage.tsx';
import { LibraryPage } from './features/library/LibraryPage.tsx';
import { LogPage } from './features/log/LogPage.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { applyTheme, readStoredTheme } from './lib/theme.ts';
import { ToastProvider } from './lib/toast.tsx';
import { RequireAuth } from './routes/RequireAuth.tsx';
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/suspended', element: <SuspendedPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <App />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/characters', element: <CharactersPage /> },
          { path: '/characters/:id', element: <CharacterSheetPage /> },
          { path: '/campaigns', element: <CampaignsPage /> },
          { path: '/campaigns/:id', element: <CampaignDetailPage /> },
          { path: '/campaigns/:id/library', element: <CampaignLibraryPage /> },
          { path: '/campaigns/:id/gm', element: <GmCampaignDashboardPage /> },
          { path: '/log', element: <LogPage /> },
          { path: '/library', element: <LibraryPage /> },
          { path: '/settings', element: <SettingsPage /> },
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
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
