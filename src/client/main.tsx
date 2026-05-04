import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { LoginPage } from './features/auth/LoginPage.tsx';
import { RegisterPage } from './features/auth/RegisterPage.tsx';
import { CharacterSheetPage } from './features/characters/CharacterSheetPage.tsx';
import { CharactersPage } from './features/characters/CharactersPage.tsx';
import { HomePage } from './features/home/HomePage.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { applyTheme, readStoredTheme } from './lib/theme.ts';
import { ToastProvider } from './lib/toast.tsx';
import { RequireAuth } from './routes/RequireAuth.tsx';
import './styles/theme.css';

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
  {
    element: <RequireAuth />,
    children: [
      {
        element: <App />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/characters', element: <CharactersPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/characters/:id', element: <CharacterSheetPage /> },
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
