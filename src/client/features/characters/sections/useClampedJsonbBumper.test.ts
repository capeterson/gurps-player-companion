/**
 * useClampedJsonbBumper — the latest-intended-ref + clamp + whole-JSONB
 * patch state machine shared by PowerstoneRow and MagicItemRow in
 * PowerstonesPanel.tsx.  Mirrors usePoolBumpers.test.ts's structure.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useClampedJsonbBumper } from './useClampedJsonbBumper.ts';

const enqueueFieldPatch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../sync/outbox.ts', () => ({
  enqueueFieldPatch,
}));

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000c0c1';
const ITEM_ID = '0193b3c0-f1f0-7000-8000-00000000d0d1';

function renderBumper(opts: {
  current: number;
  max: number;
  canWrite?: boolean;
}) {
  return renderHook(() =>
    useClampedJsonbBumper<{ currentEnergy: number; maxEnergy: number }>({
      characterId: CHAR_ID,
      entityId: ITEM_ID,
      fieldPath: 'powerstoneData',
      humanName: 'Stone charge',
      current: opts.current,
      max: opts.max,
      canWrite: opts.canWrite ?? true,
      buildValue: (clamped) => ({ currentEnergy: clamped, maxEnergy: opts.max }),
    }),
  );
}

describe('useClampedJsonbBumper', () => {
  beforeEach(() => {
    enqueueFieldPatch.mockClear();
  });

  it('bumps within range and patches the whole JSONB field', () => {
    const { result } = renderBumper({ current: 5, max: 10 });

    act(() => {
      result.current.bump(1);
    });

    expect(enqueueFieldPatch).toHaveBeenCalledTimes(1);
    expect(enqueueFieldPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        entityClass: 'character_inventory',
        entityId: ITEM_ID,
        fieldPath: 'powerstoneData',
        attemptedValue: { currentEnergy: 6, maxEnergy: 10 },
        humanName: 'Stone charge',
        flashKey: `character_inventory:${ITEM_ID}:powerstoneData`,
        characterId: CHAR_ID,
      }),
    );
  });

  it('clamps at 0 and at max instead of going out of range', () => {
    const low = renderBumper({ current: 0, max: 10 });
    act(() => {
      low.result.current.bump(-5);
    });
    expect(enqueueFieldPatch).not.toHaveBeenCalled();

    const high = renderBumper({ current: 10, max: 10 });
    act(() => {
      high.result.current.bump(5);
    });
    expect(enqueueFieldPatch).not.toHaveBeenCalled();
  });

  it('compounds rapid same-frame taps against the latest-intended ref, not the stale prop', () => {
    const { result } = renderBumper({ current: 5, max: 10 });

    // Two bumps before any re-render: without the latest-intended ref
    // both would read the render-time current (5) and enqueue 6 twice.
    act(() => {
      result.current.bump(1);
      result.current.bump(1);
    });

    expect(enqueueFieldPatch).toHaveBeenCalledTimes(2);
    expect(enqueueFieldPatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attemptedValue: { currentEnergy: 6, maxEnergy: 10 } }),
    );
    expect(enqueueFieldPatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attemptedValue: { currentEnergy: 7, maxEnergy: 10 } }),
    );
  });

  it('short-circuits a no-op setTo that lands on the same clamped value', () => {
    const { result } = renderBumper({ current: 5, max: 10 });
    act(() => {
      result.current.setTo(5);
    });
    expect(enqueueFieldPatch).not.toHaveBeenCalled();
  });

  it('does nothing when canWrite is false', () => {
    const { result } = renderBumper({ current: 5, max: 10, canWrite: false });
    act(() => {
      result.current.bump(1);
      result.current.setTo(8);
    });
    expect(enqueueFieldPatch).not.toHaveBeenCalled();
  });
});
