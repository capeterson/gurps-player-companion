/**
 * The update prompt is the only thing standing between a week-old tab
 * and stale JS, so it has to survive the two orderings that actually
 * happen: the update arriving after mount, and the update having
 * already been found during startup (before React rendered).
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPendingSwUpdate, registerSwLifecycle, swEvents } from '../../sw/registerSW.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { SwUpdatePrompt } from './SwUpdatePrompt.tsx';

function renderPrompt() {
  return render(
    <ToastProvider>
      <SwUpdatePrompt />
    </ToastProvider>,
  );
}

function fireUpdateReady(reload: () => void) {
  act(() => {
    window.dispatchEvent(new CustomEvent(swEvents.UPDATE_READY, { detail: { reload } }));
  });
}

afterEach(() => {
  clearPendingSwUpdate();
  vi.restoreAllMocks();
});

describe('SwUpdatePrompt', () => {
  it('offers a reload when an update is announced', () => {
    const reload = vi.fn();
    renderPrompt();
    expect(screen.queryByText(/new version/i)).toBeNull();

    fireUpdateReady(reload);

    expect(screen.getByText('A new version of the app is available.')).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('never reloads on its own', () => {
    const reload = vi.fn();
    renderPrompt();
    fireUpdateReady(reload);
    // Reloading out from under someone mid-edit is worse than being
    // one build behind. The user decides.
    expect(reload).not.toHaveBeenCalled();
  });

  it('stays put instead of auto-dismissing', () => {
    vi.useFakeTimers();
    try {
      renderPrompt();
      fireUpdateReady(vi.fn());
      act(() => {
        vi.advanceTimersByTime(120_000);
      });
      expect(screen.getByText('A new version of the app is available.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be dismissed', () => {
    renderPrompt();
    fireUpdateReady(vi.fn());
    act(() => {
      fireEvent.click(screen.getByLabelText('Dismiss notification'));
    });
    expect(screen.queryByText('A new version of the app is available.')).toBeNull();
  });

  it('does not stack when the same update is announced twice', () => {
    renderPrompt();
    fireUpdateReady(vi.fn());
    fireUpdateReady(vi.fn());
    expect(screen.getAllByText('A new version of the app is available.')).toHaveLength(1);
  });

  it('picks up an update found before React mounted', async () => {
    // `registerSwLifecycle()` runs at module load in main.tsx, well
    // before this component exists. An update discovered in that window
    // would be lost without the latch.
    const waiting = { postMessage: vi.fn() };
    const registration = Object.assign(new EventTarget(), {
      installing: null,
      waiting,
      update: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: Object.assign(new EventTarget(), {
        controller: {},
        getRegistration: () => Promise.resolve(registration),
      }),
      configurable: true,
      writable: true,
    });

    const teardown = registerSwLifecycle();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    renderPrompt();

    expect(screen.getByText('A new version of the app is available.')).toBeInTheDocument();
    teardown();
  });
});
