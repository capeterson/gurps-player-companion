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
import { discardPendingToggles } from '../lib/pendingToggles.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { tokenStore } from '../lib/tokenStore.ts';
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
    <input
      type="checkbox"
      aria-label={name}
      checked={t.checked}
      onChange={() => t.toggle()}
      {...t.flashProps}
    />
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

  it('save failure with no queue rolls back local, toasts, and flashes', async () => {
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
    // Per AGENTS.md rule 2: rollback drives the flash too.
    await waitFor(() => expect(cb.dataset.flashing).toBe('true'));
  });

  it('queued click failing after a successful click rolls back to the successful value, not the pre-save value', async () => {
    // Regression: when an in-flight save succeeds and the queued
    // follow-up fails, rollback target must be the value just
    // committed (true) — not the value that was server before either
    // save (false).  Otherwise a durable persisted toggle gets
    // visually erased.
    const calls: boolean[] = [];
    let resolveFirst: (() => void) | null = null;
    const onSave = vi.fn().mockImplementation((v: boolean) => {
      calls.push(v);
      if (calls.length === 1) {
        return new Promise<void>((res) => {
          resolveFirst = res;
        });
      }
      return Promise.reject(new Error('server hated this'));
    });

    render(
      <Wrap>
        <Toggle name="worn" initial={false} onSave={onSave} syncOnSave={false} />
      </Wrap>,
    );
    const cb = screen.getByLabelText('worn') as HTMLInputElement;

    // First click (slow): false -> true.
    fireEvent.click(cb);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    // Queue another click while save 1 is still pending: true -> false.
    fireEvent.click(cb);
    expect(onSave).toHaveBeenCalledTimes(1);

    // Release first save: true persists.  Then queued (false) fires
    // and is rejected.
    await act(async () => {
      resolveFirst?.();
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(calls).toEqual([true, false]);
    // Rollback to the value the FIRST save committed (true), not the
    // initial server value (false).
    await waitFor(() => expect(cb.checked).toBe(true));
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

describe('session ownership', () => {
  const tokens = { accessToken: 'access-a', refreshToken: 'refresh-a', accessTokenExpiresIn: 900 };

  for (const reject of [false, true]) {
    it(`does not dispatch a queued edit after replacement when the first save ${reject ? 'fails' : 'succeeds'}`, async () => {
      tokenStore.write(tokens);
      let settle!: () => void;
      const save = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve, rejectPromise) => {
              settle = () => (reject ? rejectPromise(new Error('rejected')) : resolve());
            }),
        )
        .mockResolvedValue(undefined);
      const view = render(
        <Wrap>
          <Toggle name="session toggle" initial={false} onSave={save} />
        </Wrap>,
      );
      const input = screen.getByLabelText('session toggle');
      fireEvent.click(input);
      fireEvent.click(input);
      act(() => tokenStore.write({ ...tokens, accessToken: 'access-b' }));
      await act(async () => settle());
      expect(save).toHaveBeenCalledTimes(1);
      expect((input as HTMLInputElement).checked).toBe(false);
      view.unmount();
      tokenStore.clear();
    });
  }

  it('drains after navigation and same-session token rotation', async () => {
    tokenStore.write(tokens);
    const original = tokenStore.read();
    if (!original) throw new Error('Expected an authenticated session');
    let settle!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const view = render(
      <Wrap>
        <Toggle name="navigation toggle" initial={false} onSave={save} />
      </Wrap>,
    );
    const input = screen.getByLabelText('navigation toggle');
    fireEvent.click(input);
    fireEvent.click(input);
    view.unmount();
    tokenStore.replaceIfCurrent(original, { ...tokens, accessToken: 'rotated' });
    await act(async () => settle());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith(false);
    tokenStore.clear();
  });
});

it('does not dispatch queued work after logout, even after the same account signs in again', async () => {
  const tokens = { accessToken: 'account', refreshToken: 'refresh', accessTokenExpiresIn: 900 };
  tokenStore.write(tokens);
  let settle!: () => void;
  const save = vi.fn().mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  const view = render(
    <Wrap>
      <Toggle name="logout toggle" initial={false} onSave={save} />
    </Wrap>,
  );
  fireEvent.click(screen.getByLabelText('logout toggle'));
  fireEvent.click(screen.getByLabelText('logout toggle'));
  act(() => {
    tokenStore.clear();
    tokenStore.write(tokens);
  });
  await act(async () => settle());
  expect(save).toHaveBeenCalledTimes(1);
  view.unmount();
  tokenStore.clear();
});

it('drains a queued follow-up after a failure and same-session rotation', async () => {
  const tokens = { accessToken: 'account', refreshToken: 'refresh', accessTokenExpiresIn: 900 };
  tokenStore.write(tokens);
  const original = tokenStore.read();
  if (!original) throw new Error('Expected an authenticated session');
  let fail!: () => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = () => reject(new Error('offline'));
        }),
    )
    .mockResolvedValue(undefined);
  const view = render(
    <Wrap>
      <Toggle name="rotation toggle" initial={false} onSave={save} />
    </Wrap>,
  );
  fireEvent.click(screen.getByLabelText('rotation toggle'));
  fireEvent.click(screen.getByLabelText('rotation toggle'));
  act(() => {
    tokenStore.replaceIfCurrent(original, { ...tokens, accessToken: 'rotated' });
  });
  await act(async () => fail());
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  view.unmount();
  tokenStore.clear();
});

it('revokes an old queue and allows a fresh save after discard without old settlement affecting it', async () => {
  const tokens = { accessToken: 'account', refreshToken: 'refresh', accessTokenExpiresIn: 900 };
  tokenStore.write(tokens);
  let settleOld!: () => void;
  let settleNew!: () => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settleOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settleNew = resolve;
        }),
    );
  const view = render(
    <Wrap>
      <Toggle name="discard toggle" initial={false} onSave={save} />
    </Wrap>,
  );
  const input = screen.getByLabelText('discard toggle') as HTMLInputElement;
  fireEvent.click(input);
  fireEvent.click(input);
  const session = tokenStore.read();
  if (!session) throw new Error('Expected an authenticated session');
  act(() => discardPendingToggles(session.sessionId));
  expect(input.checked).toBe(false);
  fireEvent.click(input);
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => settleOld());
  expect(input.checked).toBe(true);
  await act(async () => settleNew());
  expect(input.checked).toBe(true);
  expect(save).toHaveBeenCalledTimes(2);
  view.unmount();
  tokenStore.clear();
});
