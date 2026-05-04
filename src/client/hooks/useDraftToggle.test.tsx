/**
 * Tests for useDraftToggle — the boolean-checkbox companion to
 * useDraftField.  Same AGENTS.md guarantees:
 *   1. rapid toggles serialize, last click wins
 *   2. queued click fires when in-flight save settles (success OR
 *      failure)
 *   3. failed save with no queue rolls back local to server value
 *      and surfaces a toast
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../lib/toast.tsx';
import { useDraftToggle } from './useDraftToggle.ts';

function Wrap({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

interface ToggleProps {
  name: string;
  initial: boolean;
  onSave: (v: boolean) => Promise<unknown>;
  syncOnSave?: boolean;
}

function Toggle({ name, initial, onSave, syncOnSave = true }: ToggleProps) {
  const [server, setServer] = useState(initial);
  const wrapped = async (v: boolean) => {
    await onSave(v);
    if (syncOnSave) setServer(v);
  };
  const t = useDraftToggle({ name, serverValue: server, onSave: wrapped });
  return (
    <input type="checkbox" aria-label={name} checked={t.checked} onChange={() => t.toggle()} />
  );
}

describe('useDraftToggle', () => {
  it('single toggle: persists the new value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <Wrap>
        <Toggle name="worn" initial={false} onSave={onSave} />
      </Wrap>,
    );
    const cb = screen.getByLabelText('worn') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(true));
    await waitFor(() => expect(cb.checked).toBe(true));
  });

  it('rapid double-toggle while save is in flight: latest click wins', async () => {
    const calls: boolean[] = [];
    let resolveFirst: (() => void) | null = null;
    const onSave = vi.fn().mockImplementation((v: boolean) => {
      calls.push(v);
      if (calls.length === 1) {
        return new Promise<void>((res) => {
          resolveFirst = res;
        });
      }
      return Promise.resolve();
    });

    render(
      <Wrap>
        <Toggle name="worn" initial={false} onSave={onSave} />
      </Wrap>,
    );
    const cb = screen.getByLabelText('worn') as HTMLInputElement;

    // Click 1: false -> true (slow save).
    fireEvent.click(cb);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([true]);

    // Click 2 while save 1 is still in flight: optimistically false,
    // queued for next save.
    fireEvent.click(cb);
    expect(onSave).toHaveBeenCalledTimes(1);

    // Release first save; queued save fires with the latest value.
    await act(async () => {
      resolveFirst?.();
    });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(calls).toEqual([true, false]);
    await waitFor(() => expect(cb.checked).toBe(false));
  });

  it('save failure with no queue rolls back local + toasts', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('server hated this'));
    render(
      <Wrap>
        <Toggle name="worn" initial={false} onSave={onSave} syncOnSave={false} />
      </Wrap>,
    );
    const cb = screen.getByLabelText('worn') as HTMLInputElement;
    fireEvent.click(cb);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(true));
    // Local rolled back to server value (false).
    await waitFor(() => expect(cb.checked).toBe(false));
    expect(screen.getByText(/Couldn't save worn — server hated this/)).toBeInTheDocument();
  });

  it('queued click fires even when in-flight save fails', async () => {
    const calls: boolean[] = [];
    let rejectFirst: ((err: Error) => void) | null = null;
    const onSave = vi.fn().mockImplementation((v: boolean) => {
      calls.push(v);
      if (calls.length === 1) {
        return new Promise<void>((_res, rej) => {
          rejectFirst = rej;
        });
      }
      return Promise.resolve();
    });

    render(
      <Wrap>
        <Toggle name="worn" initial={false} onSave={onSave} />
      </Wrap>,
    );
    const cb = screen.getByLabelText('worn') as HTMLInputElement;

    fireEvent.click(cb);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    fireEvent.click(cb);
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectFirst?.(new Error('flaky network'));
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(calls).toEqual([true, false]);
    expect(screen.getByText(/Couldn't save worn — flaky network/)).toBeInTheDocument();
    await waitFor(() => expect(cb.checked).toBe(false));
  });
});
