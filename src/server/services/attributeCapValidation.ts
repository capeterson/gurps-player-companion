import { HTTPException } from 'hono/http-exception';
import {
  ATTRIBUTE_CAP_FIELDS,
  type CappedAttributeValues,
  findAttributeCapViolation,
} from '../../shared/domain/attributeCaps.ts';

export interface AttributeCapPatch {
  readonly dx?: number | undefined;
  readonly iq?: number | undefined;
  readonly ht?: number | undefined;
  readonly willMod?: number | undefined;
  readonly perMod?: number | undefined;
  readonly campaignId?: string | null | undefined;
}

export function touchesAttributeCaps(patch: AttributeCapPatch): boolean {
  return (
    patch.campaignId !== undefined ||
    ATTRIBUTE_CAP_FIELDS.some((field) => patch[field] !== undefined)
  );
}

/** Merge a validated patch over a character row and enforce the campaign rule. */
export function assertAttributeCaps(
  enabled: boolean,
  current: CappedAttributeValues,
  patch: AttributeCapPatch = {},
): void {
  if (!enabled) return;
  const prospective: CappedAttributeValues = {
    dx: patch.dx ?? current.dx,
    iq: patch.iq ?? current.iq,
    ht: patch.ht ?? current.ht,
    willMod: patch.willMod ?? current.willMod,
    perMod: patch.perMod ?? current.perMod,
  };
  const violation = findAttributeCapViolation(prospective);
  if (violation) throw new HTTPException(422, { message: violation.message });
}
