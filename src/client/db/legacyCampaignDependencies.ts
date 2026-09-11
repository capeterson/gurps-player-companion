import { libraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import type { OutboxEntry } from './dexie.ts';

export const LEGACY_CAMPAIGN_HOLD_REASON =
  'An older unsaved library addition needs its campaign order confirmed in the sync log.';

export const legacyReferenceFields = {
  character_trait: ['characterTraits', 'libraryTraitId'],
  character_skill: ['characterSkills', 'librarySkillId'],
  character_spell: ['characterSpells', 'librarySpellId'],
  character_inventory: ['characterInventory', 'libraryItemId'],
  character_language: ['characterLanguages', 'libraryLanguageId'],
  character_technique: ['characterTechniques', 'libraryTechniqueId'],
} as const;

/** Undefined means lost legacy ordering evidence: retain the operation for user recovery. */
export function inferLegacyCampaignDependency(
  op: OutboxEntry,
  assignments: OutboxEntry[],
  snapshot: unknown,
): boolean | undefined {
  return inferLegacyCampaignOrder(op, assignments, snapshot)?.wait;
}

export function inferLegacyCampaignOrder(
  op: OutboxEntry,
  assignments: OutboxEntry[],
  snapshot: unknown,
): { wait: boolean; campaignId?: string | null } | undefined {
  if (op.localWaitForCampaignAssignment !== undefined)
    return { wait: op.localWaitForCampaignAssignment };
  const mapping = legacyReferenceFields[op.entityClass as keyof typeof legacyReferenceFields];
  const body = op.attemptedValue as Record<string, unknown> | null;
  const sourceId = mapping && body?.[mapping[1]];
  if (!sourceId || assignments.length === 0) return { wait: false };
  const ordered = [...assignments].sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
  const original = ordered[0]?.prevValue;
  const fromCampaign = (campaign: unknown) => {
    if (typeof campaign !== 'string' && campaign !== null) return undefined;
    if (campaign === original) return { wait: false, campaignId: campaign };
    if (ordered.some((assignment) => assignment.attemptedValue === campaign))
      return { wait: true, campaignId: campaign };
    return undefined;
  };
  const saved = libraryMechanics.safeParse(snapshot);
  if (saved.success && saved.data.sourceId === sourceId) {
    const inferred = fromCampaign(saved.data.campaignId);
    if (inferred !== undefined) return inferred;
  }
  for (const assignment of ordered) {
    const undo = assignment.localCampaignTransferUndo?.find(
      (entry) =>
        entry.store === mapping[0] &&
        entry.entityId === op.entityId &&
        entry.before[mapping[1]] === sourceId,
    );
    if (undo) {
      const inferred = fromCampaign(undo.campaignId);
      if (inferred !== undefined) return inferred;
    }
  }
  // Creates keep their enqueue time; assignments can be replaced by coalescing
  // or retries. Only a create strictly after every assignment is unambiguous.
  if (ordered.every((assignment) => assignment.enqueuedAt < op.enqueuedAt)) {
    const campaign = ordered.at(-1)?.attemptedValue;
    if (typeof campaign === 'string' || campaign === null)
      return { wait: true, campaignId: campaign };
  }
  return undefined;
}
