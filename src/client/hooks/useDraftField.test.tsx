/**
 * Tests for useDraftField — covers the four AGENTS.md scenarios:
 *   1. save success: the value sticks
 *   2. save failure: rollback + toast + flash
 *   3. slow save with follow-up edit on a *different* field — second
 *      edit is not clobbered when the first save returns
 *   4. slow save with follow-up edit on the *same* field — queued
 *      commit fires after the in-flight save settles
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../lib/toast.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from './useDraftField.ts';

function Wrap({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

interface NumericFieldProps {
  name: string;
  initial: number;
  onSave: (v: number) => Promise<unknown>;
  validate?: (v: number) => string | null;
  testId?: string;
}

function NumericField({ name, initial, onSave, validate, testId }: NumericFieldProps) {
  const [serverValue, setServerValue] = useState(initial);
  const wrappedSave = async (v: number) => {
    await onSave(v);
    setServerValue(v);
  };
  const field = useDraftField<number>({
    name,
    serverValue,
    parse: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || !Number.isInteger(n))
        throw new Error(`${name} must be an integer`);
      return n;
    },
    format: (v) => String(v),
    onSave: wrappedSave,
    ...(validate ? { validate } : {}),
  });
  return (
    <input
      data-testid={testId ?? `field-${name}`}
      aria-label={name}
      className={DRAFT_FIELD_CLASS}
      {...field.inputProps}
    />
  );
}

describe('useDraftField', () => {
  it('save success: value sticks on commit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <Wrap>
        <NumericField name="ST" initial={10} onSave={onSave} />
      </Wrap>,
    );
    const input = screen.getByLabelText('ST') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(12));
    await waitFor(() => expect(input.value).toBe('12'));
    expect(input.dataset.flashing).toBe('false');
  });

  it('save failure: rollback to server value, toast, flash', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('ST must be >= 1'));
    render(
      <Wrap>
        <NumericField name="ST" initial={10} onSave={onSave} />
      </Wrap>,
    );
    const input = screen.getByLabelText('ST') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(0));
    // Rolls back to the server value (10).
    await waitFor(() => expect(input.value).toBe('10'));
    // Flash attribute is set.
    await waitFor(() => expect(input.dataset.flashing).toBe('true'));
    // Toast surfaces both the field name and the underlying reason.
    expect(screen.getByText(/Couldn't save ST — ST must be >= 1/)).toBeInTheDocument();
  });

  it('client-side validation: rolls back without calling onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <Wrap>
        <NumericField
          name="ST"
          initial={10}
          onSave={onSave}
          validate={(v) => (v >= 1 ? null : 'ST must be >= 1')}
        />
      </Wrap>,
    );
    const input = screen.getByLabelText('ST') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    await waitFor(() => expect(input.value).toBe('10'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Couldn't save ST — ST must be >= 1/)).toBeInTheDocument();
  });

  it('slow save on field A does not clobber a later edit on field B', async () => {
    let resolveA: (() => void) | null = null;
    const onSaveA = vi.fn().mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveA = res;
        }),
    );
    const onSaveB = vi.fn().mockResolvedValue(undefined);

    render(
      <Wrap>
        <NumericField name="ST" initial={10} onSave={onSaveA} testId="ST" />
        <NumericField name="DX" initial={10} onSave={onSaveB} testId="DX" />
      </Wrap>,
    );
    const inputA = screen.getByTestId('ST') as HTMLInputElement;
    const inputB = screen.getByTestId('DX') as HTMLInputElement;

    // Kick off slow save on ST.
    fireEvent.change(inputA, { target: { value: '12' } });
    fireEvent.blur(inputA);
    await waitFor(() => expect(onSaveA).toHaveBeenCalledWith(12));

    // While ST is still saving, edit DX.
    fireEvent.change(inputB, { target: { value: '14' } });
    fireEvent.blur(inputB);
    await waitFor(() => expect(onSaveB).toHaveBeenCalledWith(14));

    // Now release ST.
    await act(async () => {
      resolveA?.();
    });

    // Both values stuck.
    await waitFor(() => {
      expect(inputA.value).toBe('12');
      expect(inputB.value).toBe('14');
    });
  });

  it('same-field follow-up edit queues and fires after the in-flight save settles', async () => {
    const calls: number[] = [];
    let resolveFirst: (() => void) | null = null;
    const onSave = vi.fn().mockImplementation((v: number) => {
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
        <NumericField name="ST" initial={10} onSave={onSave} />
      </Wrap>,
    );
    const input = screen.getByLabelText('ST') as HTMLInputElement;

    // First commit: 12 (slow).
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([12]);

    // Second commit on same field: 13 (queued).
    fireEvent.change(input, { target: { value: '13' } });
    fireEvent.blur(input);
    // Save 1 still in flight — only one call so far.
    expect(onSave).toHaveBeenCalledTimes(1);

    // Release the first save — queued save fires.
    await act(async () => {
      resolveFirst?.();
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(calls).toEqual([12, 13]);
    await waitFor(() => expect(input.value).toBe('13'));
  });
});
