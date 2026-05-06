import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { registerSwLifecycle } from '../sw/registerSW.ts';
import { App } from './App.tsx';
import { LoginPage } from './features/auth/LoginPage.tsx';
import { RegisterPage } from './features/auth/RegisterPage.tsx';
import { SuspendedPage } from './features/auth/SuspendedPage.tsx';
import { CampaignDetailPage } from './features/campaigns/CampaignDetailPage.tsx';
import { CampaignLibraryPage } from './features/campaigns/CampaignLibraryPage.tsx';
import { CampaignsPage } from './features/campaigns/CampaignsPage.tsx';
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
