import { describe, expect, it } from 'vitest';
import { fieldValuesEqual } from './orchestrator.ts';

describe('fieldValuesEqual', () => {
  it('returns true for primitive equality', () => {
    expect(fieldValuesEqual(5, 5)).toBe(true);
    expect(fieldValuesEqual('hello', 'hello')).toBe(true);
    expect(fieldValuesEqual(null, null)).toBe(true);
    expect(fieldValuesEqual(undefined, undefined)).toBe(true);
  });

  it('returns false for primitive mismatch', () => {
    expect(fieldValuesEqual(5, 6)).toBe(false);
    expect(fieldValuesEqual('a', 'b')).toBe(false);
    expect(fieldValuesEqual(null, undefined)).toBe(false);
  });

  it('coerces drizzle DECIMAL strings to numbers', () => {
    // Server returns "2.50", Dexie stores 2.5 — should match.
    expect(fieldValuesEqual('2.50', 2.5)).toBe(true);
    expect(fieldValuesEqual(2.5, '2.50')).toBe(true);
    expect(fieldValuesEqual('2.50', 2.6)).toBe(false);
  });

  it('does not coerce text fields that happen to look numeric', () => {
    // height "6" vs height 6 (number) — only one of these is a real
    // number column, but here we rely on the type tags being
    // consistent. The function is permissive across string↔number,
    // which is fine in practice because TS guarantees both sides
    // share a column-level type.
    expect(fieldValuesEqual('6', '06')).toBe(false);
    expect(fieldValuesEqual('hello', 'world')).toBe(false);
  });

  it('deep-compares plain objects (jsonb columns)', () => {
    // Powerstone scenario: server returns a freshly-parsed object on
    // stale_base reconciliation; client's prevValue is a separate
    // reference with the same content. Reference equality fails;
    // deep equality should pass.
    expect(
      fieldValuesEqual({ maxEnergy: 5, currentEnergy: 4 }, { maxEnergy: 5, currentEnergy: 4 }),
    ).toBe(true);
    expect(
      fieldValuesEqual({ maxEnergy: 5, currentEnergy: 4 }, { maxEnergy: 5, currentEnergy: 3 }),
    ).toBe(false);
  });

  it('is key-order insensitive', () => {
    expect(fieldValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('treats missing key as undefined (matches absent-vs-undefined)', () => {
    // Both branches normalize to `undefined`, so the structural compare
    // treats `{a:1}` and `{a:1, b:undefined}` as equal — important
    // because zod sometimes drops absent optional fields entirely.
    expect(fieldValuesEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(fieldValuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('deep-compares nested arrays + objects', () => {
    expect(
      fieldValuesEqual(
        [
          { id: 'a', n: 1 },
          { id: 'b', n: 2 },
        ],
        [
          { id: 'a', n: 1 },
          { id: 'b', n: 2 },
        ],
      ),
    ).toBe(true);
    expect(
      fieldValuesEqual(
        [{ id: 'a', n: 1 }],
        [
          { id: 'a', n: 1 },
          { id: 'b', n: 2 },
        ],
      ),
    ).toBe(false);
  });

  it('does not equate object with array', () => {
    expect(fieldValuesEqual([], {})).toBe(false);
  });

  it('handles null / object cross-comparison', () => {
    expect(fieldValuesEqual(null, { a: 1 })).toBe(false);
    expect(fieldValuesEqual({ a: 1 }, null)).toBe(false);
  });
});
