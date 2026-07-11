/**
 * Tests for useEntityRowPatch / useEntityNameField / useEntityPointsField
 * — the shared row-editor plumbing extracted from SkillRow/SpellRow/
 * TraitRow's hand-rolled `patchX(field, value)` closures.  Routes
 * through `useCharacterFieldSave` instead of a bespoke
 * `enqueueFieldPatch` call, so these tests re-verify the AGENTS.md
 * rule 1-3 scenarios end-to-end through the new wiring (crib'd from
 * useDraftField.test.tsx's structure):
 *
 *   1. save success: the value sticks
 *   2. save failure: rollback + toast + flash on the right input
 *   3. slow save on one field does not clobber a parallel edit on a
 *      different field on the same row
 *   4. a same-field follow-up edit queues and fires after the
 *      in-flight save settles
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_FIELD_CLASS } from '../../../hooks/useDraftField.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import {
  useEntityNameField,
  useEntityPointsField,
  useEntityRowPatch,
} from './useEntityRowPatch.ts';

const enqueueFieldPatch = vi.hoisted(() => vi.fn());

vi.mock('../../../sync/outbox.ts', () => ({
  enqueueFieldPatch,
}));

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000e001';
const SKILL_ID = '0193b3c0-f1f0-7000-8000-00000000e002';

function SkillLikeRow({ name, points }: { name: string; points: number }) {
  const rowPatch = useEntityRowPatch('character_skill', SKILL_ID, CHAR_ID, name);
  const nameField = useEntityNameField(rowPatch, name);
  const pointsField = useEntityPointsField(rowPatch, name, points, (s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error('non-negative integer only');
    }
    return n;
  });
  return (
    <>
      <input aria-label={`${name} name`} className={DRAFT_FIELD_CLASS} {...nameField.inputProps} />
      <input
        aria-label={`${name} points`}
        className={DRAFT_FIELD_CLASS}
        {...pointsField.inputProps}
      />
    </>
  );
}

function renderRow(name = 'Broadsword', points = 8) {
  return render(
    <ToastProvider>
      <SkillLikeRow name={name} points={points} />
    </ToastProvider>,
  );
}

describe('useEntityRowPatch', () => {
  beforeEach(() => {
    enqueueFieldPatch.mockReset();
  });

  it('enqueues via enqueueFieldPatch with the same shape the old patchX closures used', async () => {
    enqueueFieldPatch.mockResolvedValue(undefined);
    renderRow();
    const input = screen.getByLabelText('Broadsword name') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Fencing' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(enqueueFieldPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          entityClass: 'character_skill',
          entityId: SKILL_ID,
          fieldPath: 'name',
          attemptedValue: 'Fencing',
          humanName: 'Broadsword name',
          flashKey: `character_skill:${SKILL_ID}:name`,
          characterId: CHAR_ID,
        }),
      ),
    );
    await waitFor(() => expect(input.value).toBe('Fencing'));
  });

  it('save failure: rollback to server value, toast, flash', async () => {
    enqueueFieldPatch.mockRejectedValue(new Error('name cannot be empty'));
    renderRow();
    const input = screen.getByLabelText('Broadsword name') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Oops' } });
    fireEvent.blur(input);

    await waitFor(() => expect(input.value).toBe('Broadsword'));
    await waitFor(() => expect(input.dataset.flashing).toBe('true'));
    expect(
      screen.getByText(/Couldn't save Broadsword name — name cannot be empty/),
    ).toBeInTheDocument();
  });

  it('a slow save on the name field does not clobber a parallel points edit', async () => {
    let resolveName: (() => void) | null = null;
    enqueueFieldPatch.mockImplementation((args: { fieldPath: string }) => {
      if (args.fieldPath === 'name') {
        return new Promise<void>((res) => {
          resolveName = res;
        });
      }
      return Promise.resolve();
    });

    renderRow();
    const nameInput = screen.getByLabelText('Broadsword name') as HTMLInputElement;
    const pointsInput = screen.getByLabelText('Broadsword points') as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: 'Fencing' } });
    fireEvent.blur(nameInput);
    await waitFor(() => expect(enqueueFieldPatch).toHaveBeenCalledTimes(1));

    fireEvent.change(pointsInput, { target: { value: '12' } });
    fireEvent.blur(pointsInput);
    await waitFor(() => expect(enqueueFieldPatch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(pointsInput.value).toBe('12'));

    await act(async () => {
      resolveName?.();
    });
    await waitFor(() => expect(nameInput.value).toBe('Fencing'));
  });

  it('a same-field follow-up edit queues and fires after the in-flight save settles', async () => {
    const calls: unknown[] = [];
    let resolveFirst: (() => void) | null = null;
    enqueueFieldPatch.mockImplementation((args: { fieldPath: string; attemptedValue: unknown }) => {
      if (args.fieldPath !== 'points') return Promise.resolve();
      calls.push(args.attemptedValue);
      if (calls.length === 1) {
        return new Promise<void>((res) => {
          resolveFirst = res;
        });
      }
      return Promise.resolve();
    });

    renderRow();
    const pointsInput = screen.getByLabelText('Broadsword points') as HTMLInputElement;

    fireEvent.change(pointsInput, { target: { value: '10' } });
    fireEvent.blur(pointsInput);
    await waitFor(() => expect(calls).toEqual([10]));

    fireEvent.change(pointsInput, { target: { value: '11' } });
    fireEvent.blur(pointsInput);
    // First save still in flight — the second commit must queue, not fire in parallel.
    expect(calls).toEqual([10]);

    await act(async () => {
      resolveFirst?.();
    });

    await waitFor(() => expect(calls).toEqual([10, 11]));
    await waitFor(() => expect(pointsInput.value).toBe('11'));
  });
});
