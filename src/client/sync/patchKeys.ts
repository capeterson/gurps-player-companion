import type { OutboxEntry } from '../db/dexie.ts';

export function patchKeys(
  op: Pick<OutboxEntry, 'command' | 'fieldPath' | 'attemptedValue'>,
): string[] {
  if (op.command !== 'patch') return [];
  if (op.fieldPath !== undefined) return [op.fieldPath];
  return op.attemptedValue &&
    typeof op.attemptedValue === 'object' &&
    !Array.isArray(op.attemptedValue)
    ? Object.keys(op.attemptedValue)
    : [];
}
export function patchesOverlap(a: OutboxEntry, b: OutboxEntry): boolean {
  return (
    a.entityId === b.entityId &&
    a.entityClass === b.entityClass &&
    patchKeys(a).some((key) => patchKeys(b).includes(key))
  );
}
export function unsettledPatch(op: OutboxEntry): boolean {
  return op.command === 'patch' && ['pending', 'in_flight', 'transient_retry'].includes(op.status);
}
