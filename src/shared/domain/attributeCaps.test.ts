import { describe, expect, it } from 'bun:test';
import {
  findAttributeCapViolation,
  maxIqWithMentalSecondaryCaps,
  maxMentalSecondaryModifier,
} from './attributeCaps.ts';

const normal = { dx: 10, iq: 10, ht: 10, willMod: 0, perMod: 0 };

describe('attribute caps', () => {
  it('allows ordinary purchased attributes at the cap', () => {
    expect(findAttributeCapViolation({ dx: 20, iq: 20, ht: 20, willMod: 0, perMod: 0 })).toBeNull();
  });

  it.each([
    ['dx', { ...normal, dx: 21 }],
    ['iq', { ...normal, iq: 21 }],
    ['ht', { ...normal, ht: 21 }],
    ['willMod', { ...normal, iq: 18, willMod: 3 }],
    ['perMod', { ...normal, iq: 19, perMod: 2 }],
  ] as const)('rejects a %s cap violation', (field, attrs) => {
    expect(findAttributeCapViolation(attrs)?.field).toBe(field);
  });

  it('derives dynamic IQ, Will, and Per input maxima', () => {
    expect(maxMentalSecondaryModifier(17)).toBe(3);
    expect(maxIqWithMentalSecondaryCaps(2, 4)).toBe(16);
  });
});
