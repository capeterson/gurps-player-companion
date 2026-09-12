/**
 * Purchased-attribute caps from GURPS Basic Set: Characters pp. B14-B16.
 *
 * These limits apply to permanent character-sheet purchases only. Temporary
 * effects and trait-derived bonuses are deliberately outside this check.
 * ST is also deliberately uncapped: B14 explicitly calls it the exception to
 * the usual 1-20 attribute range.
 */

export interface CappedAttributeValues {
  readonly dx: number;
  readonly iq: number;
  readonly ht: number;
  readonly willMod: number;
  readonly perMod: number;
}

export type AttributeCapField = 'dx' | 'iq' | 'ht' | 'willMod' | 'perMod';

export const ATTRIBUTE_CAP_FIELDS: readonly AttributeCapField[] = [
  'dx',
  'iq',
  'ht',
  'willMod',
  'perMod',
];

export interface AttributeCapViolation {
  readonly field: AttributeCapField;
  readonly message: string;
}

/** Return the first canonical cap violation, in sheet display order. */
export function findAttributeCapViolation(
  attrs: CappedAttributeValues,
): AttributeCapViolation | null {
  if (attrs.dx > 20) {
    return { field: 'dx', message: 'DX cannot exceed 20 while attribute caps are enforced (B14).' };
  }
  if (attrs.iq > 20) {
    return { field: 'iq', message: 'IQ cannot exceed 20 while attribute caps are enforced (B14).' };
  }
  if (attrs.ht > 20) {
    return { field: 'ht', message: 'HT cannot exceed 20 while attribute caps are enforced (B14).' };
  }
  if (attrs.iq + attrs.willMod > 20) {
    return {
      field: 'willMod',
      message: 'Will cannot exceed 20 while attribute caps are enforced (B16).',
    };
  }
  if (attrs.iq + attrs.perMod > 20) {
    return {
      field: 'perMod',
      message: 'Per cannot exceed 20 while attribute caps are enforced (B16).',
    };
  }
  return null;
}

/** Highest permanent Will/Per modifier compatible with the hard total of 20. */
export function maxMentalSecondaryModifier(iq: number): number {
  return 20 - iq;
}

/** IQ also has to leave room for already-purchased Will and Per modifiers. */
export function maxIqWithMentalSecondaryCaps(willMod: number, perMod: number): number {
  return Math.min(20, 20 - willMod, 20 - perMod);
}
