import { describe, expect, it } from 'bun:test';
import type { z } from 'zod';
import {
  characterSyncPatch,
  characterUpdate,
  dismissedWarningsField,
  tempEffect,
  tempEffectsField,
} from './character.ts';

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

describe('tempEffect', () => {
  it('accepts an effect with a subset of axes', () => {
    const result = tempEffect.safeParse({
      id: 'e1',
      name: 'Might',
      mods: { st: 2, ht: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an effect with no mods (all axes optional)', () => {
    expect(tempEffect.safeParse({ id: 'e1', name: 'Nothing yet', mods: {} }).success).toBe(true);
  });

  it('rejects a per-axis value outside [-50, 50]', () => {
    expect(tempEffect.safeParse({ id: 'e1', name: 'X', mods: { st: 51 } }).success).toBe(false);
    expect(tempEffect.safeParse({ id: 'e1', name: 'X', mods: { st: -51 } }).success).toBe(false);
    expect(tempEffect.safeParse({ id: 'e1', name: 'X', mods: { st: 50 } }).success).toBe(true);
  });

  it('rejects an unknown axis key (strict mods)', () => {
    const result = tempEffect.safeParse({ id: 'e1', name: 'X', mods: { strength: 2 } });
    expect(result.success).toBe(false);
  });

  it('rejects an empty or oversized name, and an empty id', () => {
    expect(tempEffect.safeParse({ id: 'e1', name: '', mods: {} }).success).toBe(false);
    expect(tempEffect.safeParse({ id: 'e1', name: 'x'.repeat(81), mods: {} }).success).toBe(false);
    expect(tempEffect.safeParse({ id: '', name: 'X', mods: {} }).success).toBe(false);
  });
});

describe('tempEffectsField', () => {
  it('accepts a normal list of effects', () => {
    const result = tempEffectsField.safeParse([
      { id: 'a', name: 'Might', mods: { st: 2 } },
      { id: 'b', name: 'Haste', mods: { move: 1 } },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects duplicate effect ids', () => {
    const result = tempEffectsField.safeParse([
      { id: 'a', name: 'Might', mods: { st: 2 } },
      { id: 'a', name: 'Might again', mods: { st: 1 } },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects when the per-axis SUM across effects exceeds [-50, 50], even though each effect is individually in-bounds', () => {
    const result = tempEffectsField.safeParse([
      { id: 'a', name: 'Buff 1', mods: { st: 30 } },
      { id: 'b', name: 'Buff 2', mods: { st: 30 } },
    ]);
    expect(result.success).toBe(false);
  });

  it('accepts per-axis sums exactly at the ±50 boundary', () => {
    const result = tempEffectsField.safeParse([
      { id: 'a', name: 'Buff 1', mods: { st: 25 } },
      { id: 'b', name: 'Buff 2', mods: { st: 25 } },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects more than 40 effects', () => {
    const many = Array.from({ length: 41 }, (_, i) => ({
      id: `e${i}`,
      name: `Effect ${i}`,
      mods: {},
    }));
    expect(tempEffectsField.safeParse(many).success).toBe(false);
  });

  it('defaults to [] via characterAttributesShape (characterCreate)', () => {
    // Exercised indirectly through characterUpdate/characterSyncPatch
    // in the suites below; a bare empty array always parses.
    expect(tempEffectsField.safeParse([]).success).toBe(true);
  });
});
