/**
 * Shared draft-field parsers for useDraftField's `parse` option. Moved
 * verbatim out of CharacterSheetPage.tsx so other panels can reuse the
 * exact same validation messages instead of re-inlining copies.
 */

export function intParser(min: number, max: number) {
  return (s: string): number => {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('integer only');
    if (n < min || n > max) throw new Error(`must be between ${min} and ${max}`);
    return n;
  };
}

/**
 * Like intParser but the underlying value is stored in raw integer units
 * while the user-facing input shows values multiplied by `scale`.
 * e.g. scale=0.25 lets the user type "1.25" while storing the integer 5.
 */
export function scaledIntParser(scale: number, min: number, max: number) {
  return (s: string): number => {
    const f = Number.parseFloat(s);
    if (!Number.isFinite(f)) throw new Error('number only');
    const quotient = f / scale;
    const n = Math.round(quotient);
    // Reject values that aren't exact multiples of scale (e.g. 0.13 when scale=0.25).
    if (Math.abs(n - quotient) > 1e-9) throw new Error(`must be a multiple of ${scale.toFixed(2)}`);
    const lo = (min * scale).toFixed(2);
    const hi = (max * scale).toFixed(2);
    if (n < min || n > max) throw new Error(`must be between ${lo} and ${hi}`);
    return n;
  };
}

export function nullableTextParser(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

export function nullableIntParser(min: number, max: number) {
  return (s: string): number | null => {
    const t = s.trim();
    if (t.length === 0) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('integer only');
    if (n < min || n > max) throw new Error(`must be between ${min} and ${max}`);
    return n;
  };
}
