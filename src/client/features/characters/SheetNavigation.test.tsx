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
    expect(
      Array.from(navigation.querySelectorAll('button')).map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(SHEET_TABS);
    expect(SHEET_TABS.slice(0, 2)).toEqual(['Overview', 'Combat']);
    expect(navigation.getElementsByTagName('button')).toHaveLength(SHEET_TABS.length);
    expect(screen.queryByRole('button', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Combat' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Skills' })).toHaveTextContent('3');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Skills' }));
    expect(onSelect).toHaveBeenCalledWith('Skills');
  });

  it('keeps mobile petals unreachable while closed and shows labelled non-tooltip petals when open', async () => {
    installMatchMedia(false);
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SheetNavigation
        tabs={SHEET_TABS}
        active="Combat"
        counts={{ Skills: 3, Inventory: 2 }}
        onSelect={onSelect}
      />,
    );

    const navigation = screen.getByRole('navigation', { name: 'Character sections' });
    const toggle = screen.getByRole('button', { name: 'Open character navigation' });
    const petals = navigation.querySelector('.sheet-petals');
    expect(toggle).toBeVisible();
    expect(petals).toHaveAttribute('hidden');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Close character navigation' })).toBeVisible();
    const petalGroups = navigation.querySelectorAll('.sheet-petal');
    expect(petalGroups).toHaveLength(SHEET_TABS.length);
    expect(screen.queryByRole('button', { name: 'Notes' })).not.toBeInTheDocument();
    expect(navigation.querySelectorAll('[role="tooltip"]')).toHaveLength(0);
    for (const tab of SHEET_TABS) {
      const petal = Array.from(petalGroups).find(
        (group) => group.querySelector(`button[aria-label="${tab}"]`) !== null,
      );
      expect(petal, `${tab} petal`).not.toBeNull();
      if (!petal) continue;
      const label = petal.querySelector('.sheet-petal-label');
      expect(label, `${tab} visible label`).not.toBeNull();
      expect(label).toBeVisible();
      expect(label).toHaveTextContent(tab);
      expect(petal.querySelector('button')).toHaveAttribute('aria-label', tab);
      if (tab === 'Skills') {
        expect(petal.querySelector('.sheet-petal-count')).toHaveTextContent('3');
      }
    }

    await user.hover(screen.getByRole('button', { name: 'Skills' }));
    await expect(navigation.querySelector('[role="tooltip"]')).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Skills' }).focus();
    expect(navigation.querySelector('[role="tooltip"]')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open character navigation' })).toHaveFocus();
    expect(petals).toHaveAttribute('hidden');

    await user.click(toggle);
    fireEvent.pointerDown(document.body, { target: document.body });
    expect(petals).toHaveAttribute('hidden');

    await user.click(toggle);
    const overviewLabel = Array.from(navigation.querySelectorAll('.sheet-petal'))
      .find((group) => group.querySelector('button[aria-label="Overview"]') !== null)
      ?.querySelector('.sheet-petal-label');
    expect(overviewLabel).not.toBeNull();
    await user.click(overviewLabel as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('Overview');
    expect(petals).toHaveAttribute('hidden');
  });
});
