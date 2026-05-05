/**
 * Persistent toasts (issue #12) must NOT auto-dismiss.  This guards
 * against a regression where the durationMs default kicks in even
 * when `persistent: true` is set.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ToastApi, ToastProvider, useToasts } from './toast.tsx';

let captured: ToastApi | null = null;

function Capture() {
  captured = useToasts();
  return null;
}

beforeEach(() => {
  captured = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastProvider persistent option', () => {
  it('auto-dismisses non-persistent error toasts', async () => {
    render(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    expect(captured).not.toBeNull();
    act(() => {
      captured?.push('flake', { kind: 'error' });
    });
    expect(screen.getByText('flake')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.queryByText('flake')).toBeNull();
  });

  it('keeps persistent toasts on screen indefinitely', async () => {
    render(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    act(() => {
      captured?.push("Couldn't sync ST — value out of range", {
        kind: 'error',
        persistent: true,
      });
    });
    expect(screen.getByText("Couldn't sync ST — value out of range")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Couldn't sync ST — value out of range")).toBeInTheDocument();
  });

  it('dismisses persistent toasts on explicit click', () => {
    render(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    act(() => {
      captured?.push('persistent', { kind: 'error', persistent: true });
    });
    act(() => {
      fireEvent.click(screen.getByLabelText('Dismiss notification'));
    });
    expect(screen.queryByText('persistent')).toBeNull();
  });
});
