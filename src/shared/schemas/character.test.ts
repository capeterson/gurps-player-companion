import { describe, expect, it } from 'bun:test';
import type { z } from 'zod';
import { characterSyncPatch, characterUpdate, dismissedWarningsField } from './character.ts';

describe('characterSyncPatch', () => {
  it('includes every REST-updatable field plus dismissedWarnings', () => {
    const restFields = Object.keys(characterUpdate.shape);
    const syncFields = Object.keys(characterSyncPatch.shape);
    for (const f of restFields) expect(syncFields).toContain(f);
    expect(syncFields).toContain('dismissedWarnings');
  });

  it('exposes a per-field validator for dismissedWarnings (the sync dispatcher carves .shape[field])', () => {
    const shape = characterSyncPatch.shape as Record<string, z.ZodTypeAny>;
    const validator = shape.dismissedWarnings;
    expect(validator).toBeDefined();
    expect(validator?.parse(['attr-st-low', 'points-over-target'])).toEqual([
      'attr-st-low',
      'points-over-target',
    ]);
  });

  it('rejects non-string warning codes and oversized codes', () => {
    expect(dismissedWarningsField.safeParse([42]).success).toBe(false);
    expect(dismissedWarningsField.safeParse(['x'.repeat(81)]).success).toBe(false);
    expect(dismissedWarningsField.safeParse(['']).success).toBe(false);
  });

  it('rejects an unbounded list (cap 200)', () => {
    const many = Array.from({ length: 201 }, (_, i) => `code-${i}`);
    expect(dismissedWarningsField.safeParse(many).success).toBe(false);
  });
});
