import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const guestState = vi.hoisted(() => ({ guest: false }));

vi.mock('./lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api.ts')>();
  return {
    ...actual,
    api: vi.fn(async () => ({
      id: 'u1',
      email: 'rowan@example.invalid',
      displayName: 'Rowan',
      isSuperuser: false,
    })),
  };
});
vi.mock('./lib/guestSession.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/guestSession.ts')>();
  return { ...actual, useIsGuestSession: () => guestState.guest };
});
vi.mock('./lib/themeSync.ts', () => ({ useThemePreferenceSync: () => undefined }));
vi.mock('./components/SyncStatusIndicator.tsx', () => ({
  SyncStatusIndicator: () => <button type="button">All changes saved</button>,
}));
vi.mock('./components/NotificationsBell.tsx', () => ({
  NotificationsBell: () => <button type="button">Notifications</button>,
}));
vi.mock('./components/AppBreadcrumbs.ts', () => ({
  appBreadcrumbPage: () => null,
  useAppEntityBreadcrumb: (pathname: string) =>
    pathname.startsWith('/characters/')
      ? { kind: 'character', id: 'c1', name: 'Kestrel Vale' }
      : null,
}));
vi.mock('./hooks/useEntityDocumentTitle.ts', () => ({ useEntityDocumentTitle: () => undefined }));
vi.mock('./hooks/useUnsyncedChangesGuard.tsx', () => ({
  useUnsyncedChangesGuard: () => ({ guard: vi.fn(), dialog: null }),
}));

import { App } from './App.tsx';
import { useCharacterHeaderChrome } from './components/CharacterHeaderChromeContext.tsx';
import { resetThemeStoreForTests } from './lib/theme.ts';

/** Stands in for the character status bar, which renders the compact chrome. */
function CompactChrome() {
  const chrome = useCharacterHeaderChrome();
  return (
    <div data-testid="compact-bar">
      <div data-testid="compact-first">{chrome?.menu}</div>
      <div data-testid="compact-last">{chrome?.actions}</div>
    </div>
  );
}

function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<App />}>
            <Route path="/campaigns" element={<p>Campaigns page</p>} />
            <Route path="/characters/:id" element={<CompactChrome />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gpc.theme', 'light');
  guestState.guest = false;
  resetThemeStoreForTests();
});

describe('App header theme control', () => {
  it('moves light/dark into the user menu and keeps the brand mark linked home', async () => {
    const user = userEvent.setup();
    renderApp('/campaigns');
    const header = screen.getByRole('banner');
    expect(
      within(header)
        .getAllByRole('link', { name: /sunbolt/i })[0]
        ?.getAttribute('href'),
    ).toBe('/');
    // Nothing in the bar itself switches modes; the item lives in the menu.
    expect(header.querySelectorAll('button[aria-label^="Switch to"]')).toHaveLength(1);
    expect(header.querySelector('ul button[aria-label^="Switch to"]')).not.toBeNull();

    const item = within(header).getByRole('button', { name: 'Switch to Dark mode' });
    expect(item.textContent).toBe('Dark mode');
    expect(item.closest('ul')).not.toBeNull();
    await user.click(item);
    expect(document.documentElement.dataset.theme).toBe('gilded-tome');
    const back = within(header).getByRole('button', { name: 'Switch to Light mode' });
    expect(back.textContent).toBe('Light mode');
    await user.click(back);
    expect(document.documentElement.dataset.theme).toBe('sunbolt');
  });

  it('lets guests switch mode from the menu too', () => {
    guestState.guest = true;
    renderApp('/campaigns');
    expect(screen.getByRole('button', { name: 'Switch to Dark mode' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });
});

describe('compact character header chrome', () => {
  it('leads with the brand link and ends with an icon-only hamburger holding the theme item', async () => {
    const user = userEvent.setup();
    renderApp('/characters/c1');
    const first = screen.getByTestId('compact-first');
    const brand = within(first).getByRole('link', { name: 'Sunbolt home' });
    expect(brand.getAttribute('href')).toBe('/');
    expect(brand.querySelector('img.brand-mark')).not.toBeNull();

    const last = screen.getByTestId('compact-last');
    const hamburger = within(last).getByLabelText('Open navigation for Kestrel Vale');
    expect(hamburger.textContent).toBe('');
    const controls = [...last.querySelectorAll('button, summary')].filter(
      (el) => !el.closest('ul'),
    );
    expect(controls.map((el) => el.textContent || el.getAttribute('aria-label'))).toEqual([
      'All changes saved',
      'Notifications',
      'Open navigation for Kestrel Vale',
    ]);

    await user.click(hamburger);
    const panel = hamburger.closest('details')?.querySelector('ul') as HTMLElement;
    expect(panel.textContent).not.toContain('Kestrel Vale');
    expect(hamburger.closest('details')?.className).toContain('dropdown-end');
    const item = within(panel).getByRole('button', { name: 'Switch to Dark mode' });
    expect(item.textContent).toBe('Dark mode');
    await user.click(item);
    expect(document.documentElement.dataset.theme).toBe('gilded-tome');
  });

  it('omits the bell for guests and keeps the hamburger last', () => {
    guestState.guest = true;
    renderApp('/characters/c1');
    const last = screen.getByTestId('compact-last');
    expect(within(last).queryByRole('button', { name: 'Notifications' })).toBeNull();
    const controls = [...last.querySelectorAll('button, summary')].filter(
      (el) => !el.closest('ul'),
    );
    expect(controls.at(-1)?.getAttribute('aria-label')).toBe('Open navigation for Kestrel Vale');
  });
});
