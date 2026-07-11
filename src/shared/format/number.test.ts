import { describe, expect, it } from 'bun:test';
import { formatScaled, formatSigned } from './number.ts';

describe('formatSigned', () => {
  it('prefixes positive numbers with +', () => {
    expect(formatSigned(3)).toBe('+3');
  });

  it('treats zero as non-negative', () => {
    expect(formatSigned(0)).toBe('+0');
  });

  it('renders negative numbers with an ASCII hyphen-minus', () => {
    expect(formatSigned(-2)).toBe('-2');
  });
});

describe('formatScaled', () => {
  it('returns the plain string when scale is 1', () => {
    expect(formatScaled(5, 1)).toBe('5');
    expect(formatScaled(-3, 1)).toBe('-3');
  });

  it('multiplies by scale and fixes to 2 decimals when scale is not 1', () => {
    expect(formatScaled(5, 0.25)).toBe('1.25');
    expect(formatScaled(-4, 0.25)).toBe('-1.00');
  });

  it('handles scale 0 as "not 1" (multiplies to zero)', () => {
    expect(formatScaled(5, 0)).toBe('0.00');
  });
});
