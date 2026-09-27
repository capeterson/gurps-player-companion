import { canonicalLibraryKey } from '../../shared/domain/libraryIdentity.ts';
import { isLibraryEntityClass } from '../../shared/schemas/sync.ts';
import type { OutboxEntry } from '../db/dexie.ts';

type Reference = { section: string; key: string; sourceKey: string; kind?: string };
type Dependencies = { ids: Set<string>; sources: Set<string>; rules: Reference[] };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const key = (value: unknown) => canonicalLibraryKey(typeof value === 'string' ? value : '');
const sections: Record<string, string> = {
  campaign_library_trait: 'traits',
  campaign_library_item: 'items',
  campaign_library_modifier: 'modifiers',
};
const precedes = (a: OutboxEntry, b: OutboxEntry) =>
  a.enqueuedAt < b.enqueuedAt ||
  (a.enqueuedAt === b.enqueuedAt && (b.command !== 'patch' || a.clientOpId < b.clientOpId));

function dependencies(value: unknown): Dependencies {
  const body = record(value);
  const result: Dependencies = { ids: new Set(), sources: new Set(), rules: [] };
  const reference = (value: unknown) => {
    const ref = record(value);
    if (typeof ref.section !== 'string' || typeof ref.key !== 'string') return;
    result.rules.push({
      section: ref.section,
      key: key(ref.key),
      sourceKey: key(ref.sourceKey),
      ...(typeof ref.kind === 'string' ? { kind: ref.kind } : {}),
    });
  };
  const calculation = (value: unknown) => {
    for (const valueNode of array(record(value).nodes)) {
      const node = record(valueNode);
      if (node.op === 'call') reference(node.reference);
    }
  };
  const snapshot = (value: unknown) => {
    const saved = record(value);
    if (typeof saved.definitionId === 'string') result.ids.add(saved.definitionId);
    reference(saved.reference);
    for (const dependency of array(saved.dependencies)) reference(record(dependency).reference);
  };
  if (typeof body.sourceKey === 'string') result.sources.add(key(body.sourceKey));
  for (const field of [
    'libraryTraitId',
    'librarySkillId',
    'librarySpellId',
    'libraryItemId',
    'libraryLanguageId',
    'libraryTechniqueId',
    'definitionId',
  ]) {
    if (typeof body[field] === 'string') result.ids.add(body[field]);
  }
  calculation(body.calculation);
  snapshot(body.pricingResolution);
  for (const modifier of [...array(body.availableModifiers), ...array(body.modifiers)]) {
    calculation(record(modifier).calculation);
    snapshot(record(modifier).pricingResolution);
  }
  for (const ref of array(record(body.applicability).traits)) reference(ref);
  for (const enchantment of array(body.enchantments)) {
    const id = record(enchantment).definitionId;
    if (typeof id === 'string') result.ids.add(id);
  }
  return result;
}

function matches(
  dependencies: Dependencies,
  target: OutboxEntry,
  body: Record<string, unknown>,
  campaignId: string | undefined,
): boolean {
  if (dependencies.ids.has(target.entityId)) return true;
  if (!campaignId || target.parentId !== campaignId) return false;
  const targetKey = key(body.key || body.name);
  if (!targetKey) return false;
  if (target.entityClass === 'campaign_library_source') return dependencies.sources.has(targetKey);
  return dependencies.rules.some(
    (ref) =>
      ref.section === sections[target.entityClass] &&
      ref.key === targetKey &&
      ref.sourceKey === key(body.sourceKey) &&
      (!ref.kind || ref.kind === body.kind),
  );
}

/** References must wait for durable acknowledgements, not merely an earlier batch position. */
export function libraryDependencyHeld(
  op: OutboxEntry,
  unsettled: readonly OutboxEntry[],
  campaignId: string | undefined,
): boolean {
  const body =
    op.fieldPath === undefined ? op.attemptedValue : { [op.fieldPath]: op.attemptedValue };
  const refs = dependencies(body);
  for (const target of unsettled) {
    if (!isLibraryEntityClass(target.entityClass) || target.entityId === op.entityId) continue;
    const targetBody = { ...record(target.prevValue), ...record(target.attemptedValue) };
    // Creates have no server row yet. Older edits may introduce a source key or
    // rule referenced by this operation. Independent definitions remain parallel.
    if (
      target.command !== 'delete' &&
      (target.command === 'create' || precedes(target, op)) &&
      matches(refs, target, targetBody, campaignId)
    )
      return true;
    // Removing a definition must wait for earlier edits that remove its old
    // references, including when those edits are backing off after a failure.
    if (
      op.command === 'delete' &&
      isLibraryEntityClass(op.entityClass) &&
      target.command === 'patch' &&
      precedes(target, op) &&
      matches(dependencies(target.prevValue), op, record(op.prevValue), target.parentId)
    )
      return true;
  }
  return false;
}
