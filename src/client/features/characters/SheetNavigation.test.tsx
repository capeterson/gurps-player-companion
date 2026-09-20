import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SHEET_TABS, SheetNavigation } from './SheetNavigation.tsx';

function installMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const matchMedia = vi.fn((query: string) => ({
    matches: query === '(min-width: 768px)' ? matches : false,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: (event: Event) => {
      for (const listener of listeners) listener(event as MediaQueryListEvent);
      return true;
    },
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia });
  return matchMedia;
}

describe('SheetNavigation', () => {
  it('renders the labelled desktop dock and reports section selection', async () => {
    installMatchMedia(true);
    const onSelect = vi.fn();
    render(
      <SheetNavigation
        tabs={SHEET_TABS}
        active="Combat"
        counts={{ Skills: 3 }}
        onSelect={onSelect}
      />,
    );

    const navigation = screen.getByRole('navigation', { name: 'Character sections' });
    expect(navigation).toBeVisible();
    expect(navigation.getElementsByTagName('button')).toHaveLength(SHEET_TABS.length);
    expect(screen.getByRole('button', { name: 'Combat' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Skills' })).toHaveTextContent('3');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Skills' }));
    expect(onSelect).toHaveBeenCalledWith('Skills');
  });

  it('keeps mobile petals unreachable while closed and dismisses on escape/outside', async () => {
    installMatchMedia(false);
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SheetNavigation tabs={SHEET_TABS} active="Combat" counts={{}} onSelect={onSelect} />);

    const navigation = screen.getByRole('navigation', { name: 'Character sections' });
    const toggle = screen.getByRole('button', { name: 'Open character navigation' });
    const petals = navigation.querySelector('.sheet-petals');
    expect(toggle).toBeVisible();
    expect(petals).toHaveAttribute('hidden');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Close character navigation' })).toBeVisible();
    expect(navigation.querySelectorAll('.sheet-petals button')).toHaveLength(SHEET_TABS.length);
    expect(screen.getByRole('tooltip', { name: 'Skills' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open character navigation' })).toHaveFocus();
    expect(petals).toHaveAttribute('hidden');

    await user.click(toggle);
    fireEvent.pointerDown(document.body, { target: document.body });
    expect(petals).toHaveAttribute('hidden');

    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Identity' }));
    expect(onSelect).toHaveBeenCalledWith('Identity');
    expect(petals).toHaveAttribute('hidden');
  });
});
