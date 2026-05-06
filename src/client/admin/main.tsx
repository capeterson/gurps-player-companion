/**
 * Admin app entry — separate Vite entrypoint at /admin.html that loads
 * only when an admin navigates to /admin/*.  Per AGENTS.md the admin
 * surface must not ship in the regular PWA bundle, so this file (and
 * everything it imports) is split out from src/client/main.tsx.
 *
 * Differences from the player app entry:
 *  - No service-worker registration.
 *  - No PWA manifest reference.
 *  - Stripped React Router tree: only /admin/... routes plus the auth
 *    pages so unauthenticated admins can sign in.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage.tsx';
import { RegisterPage } from '../features/auth/RegisterPage.tsx';
import { SuspendedPage } from '../features/auth/SuspendedPage.tsx';
import { applyTheme, readStoredTheme } from '../lib/theme.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { RequireAuth } from '../routes/RequireAuth.tsx';
import '../styles/theme.css';
import { AdminLayout } from './AdminLayout.tsx';
import { CampaignDetailPage } from './pages/CampaignDetailPage.tsx';
import { CampaignsPage } from './pages/CampaignsPage.tsx';
import { UserDetailPage } from './pages/UserDetailPage.tsx';
import { UsersPage } from './pages/UsersPage.tsx';

applyTheme(readStoredTheme());

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
        element: <AdminLayout />,
        children: [
          { path: '/admin', element: <Navigate to="/admin/users" replace /> },
          { path: '/admin/users', element: <UsersPage /> },
          { path: '/admin/users/:id', element: <UserDetailPage /> },
          { path: '/admin/campaigns', element: <CampaignsPage /> },
          { path: '/admin/campaigns/:id', element: <CampaignDetailPage /> },
        ],
      },
    ],
  },
  // Anything else served by admin.html that isn't an /admin route
  // bounces back to the player app via a hard nav.
  {
    path: '*',
    loader: () => {
      window.location.assign('/');
      return null;
    },
    element: null,
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
