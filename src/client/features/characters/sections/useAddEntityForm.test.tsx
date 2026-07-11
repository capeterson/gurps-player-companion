/**
 * Tests for useAddEntityForm — the submit/creating/toast mechanics
 * shared by AddSkillForm, AddSpellForm, and AddTraitForm. Unlike
 * useDraftField this isn't a draft-on-blur field (creates are
 * one-shot and, per AGENTS.md S3, are never coalesced), so the
 * covered scenarios are the create-flow analogues:
 *
 *   1. success: enqueueCreate fires with the right shape, `onCreated`
 *      runs, `creating` returns to false,
 *   2. failure: toasts `Couldn't add ${label} — ${reason}`, `onCreated`
 *      does NOT run, `creating` still returns to false,
 *   3. `creating` is true for the duration of a slow create and false
 *      once it settles (so the submit button's "Adding…" label tracks
 *      the actual in-flight state),
 *   4. two submits in flight at once both fire (no coalescing of
 *      creates, per AGENTS.md S3) and each runs its own `onCreated`.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../lib/toast.tsx';
import { useAddEntityForm } from './useAddEntityForm.ts';

const enqueueCreate = vi.hoisted(() => vi.fn());
const newClientId = vi.hoisted(() => vi.fn(() => 'client-id-1'));

vi.mock('../../../sync/outbox.ts', () => ({
  enqueueCreate,
  newClientId,
}));

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000f001';

interface HarnessProps {
  onCreated: () => void;
  attemptedValue?: Record<string, unknown>;
}

/** Exposes useAddEntityForm's state/actions through a minimal DOM surface. */
function Harness({ onCreated, attemptedValue = { name: 'Broadsword' } }: HarnessProps) {
  const { creating, submit } = useAddEntityForm({
    entityClass: 'character_skill',
    characterId: CHAR_ID,
    label: 'skill',
  });
  return (
    <button type="button" onClick={() => void submit(attemptedValue, onCreated)}>
      {creating ? 'Adding…' : 'Add'}
    </button>
  );
}

function renderHarness(props: Partial<HarnessProps> = {}) {
  const onCreated = props.onCreated ?? vi.fn();
  render(
    <ToastProvider>
      <Harness
        onCreated={onCreated}
        {...(props.attemptedValue ? { attemptedValue: props.attemptedValue } : {})}
      />
    </ToastProvider>,
  );
  return { onCreated };
}

describe('useAddEntityForm', () => {
  beforeEach(() => {
    enqueueCreate.mockReset();
    newClientId.mockClear();
  });

  it('success: enqueues a create with the right shape and runs onCreated', async () => {
    enqueueCreate.mockResolvedValue(undefined);
    const { onCreated } = renderHarness({ attemptedValue: { name: 'Broadsword', points: 8 } });

    act(() => {
      screen.getByRole('button', { name: 'Add' }).click();
    });

    await waitFor(() =>
      expect(enqueueCreate).toHaveBeenCalledWith({
        entityClass: 'character_skill',
        entityId: 'client-id-1',
        humanName: 'skill',
        characterId: CHAR_ID,
        attemptedValue: { name: 'Broadsword', points: 8 },
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Add'));
  });

  it('failure: toasts and does not run onCreated', async () => {
    enqueueCreate.mockRejectedValue(new Error('name cannot be empty'));
    const { onCreated } = renderHarness();

    act(() => {
      screen.getByRole('button', { name: 'Add' }).click();
    });

    await waitFor(() =>
      expect(screen.getByText("Couldn't add skill — name cannot be empty")).toBeInTheDocument(),
    );
    expect(onCreated).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument());
  });

  it('creating is true while the create is in flight and false once it settles', async () => {
    let resolveCreate: (() => void) | null = null;
    enqueueCreate.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveCreate = res;
        }),
    );
    renderHarness();

    act(() => {
      screen.getByRole('button', { name: 'Add' }).click();
    });

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Adding…'));

    await act(async () => {
      resolveCreate?.();
    });

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Add'));
  });

  it('two submits in flight at once both fire and each runs its own onCreated (creates are never coalesced)', async () => {
    enqueueCreate.mockResolvedValue(undefined);
    const onCreatedA = vi.fn();
    const onCreatedB = vi.fn();

    function TwoHarness() {
      const { submit } = useAddEntityForm({
        entityClass: 'character_skill',
        characterId: CHAR_ID,
        label: 'skill',
      });
      return (
        <>
          <button type="button" onClick={() => void submit({ name: 'Broadsword' }, onCreatedA)}>
            A
          </button>
          <button type="button" onClick={() => void submit({ name: 'Fencing' }, onCreatedB)}>
            B
          </button>
        </>
      );
    }

    render(
      <ToastProvider>
        <TwoHarness />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'A' }).click();
      screen.getByRole('button', { name: 'B' }).click();
    });

    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onCreatedA).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCreatedB).toHaveBeenCalledTimes(1));
  });
});
