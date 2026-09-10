import { and, inArray } from 'drizzle-orm';
import { libraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import type { SyncCursorChange } from '../../shared/schemas/sync.ts';
import { getDb } from '../db/client.ts';
import { campaignLibrarySkills, campaignLibraryTraits, characters } from '../db/schema.ts';

/** Only called after the cursor's character share gate. Library reads are additionally campaign-scoped. */
export async function withLibraryMechanics(
  changes: SyncCursorChange[],
  accessibleCampaignIds: string[],
): Promise<SyncCursorChange[]> {
  if (changes.length === 0) return changes;
  const db = getDb();
  const rows = changes.map((change) => change.data as Record<string, unknown>);
  const characterIds = [...new Set(rows.map((row) => String(row.characterId)))];
  const owners = await db
    .select({ id: characters.id, campaignId: characters.campaignId })
    .from(characters)
    .where(inArray(characters.id, characterIds));
  const campaigns = new Map(owners.map((owner) => [owner.id, owner.campaignId]));
  const allowed = new Set(accessibleCampaignIds);
  const isTrait = changes[0]?.entityClass === 'character_trait';
  const field = isTrait ? 'libraryTraitId' : 'librarySkillId';
  const sourceIds = [
    ...new Set(rows.map((row) => row[field]).filter((id): id is string => typeof id === 'string')),
  ];
  const table = isTrait ? campaignLibraryTraits : campaignLibrarySkills;
  const definitions =
    sourceIds.length && accessibleCampaignIds.length
      ? await db
          .select({
            id: table.id,
            campaignId: table.campaignId,
            revision: table.revision,
            effects: table.effects,
          })
          .from(table)
          .where(
            and(inArray(table.id, sourceIds), inArray(table.campaignId, accessibleCampaignIds)),
          )
      : [];
  const byId = new Map(
    definitions.filter((row) => allowed.has(row.campaignId)).map((row) => [row.id, row]),
  );
  return changes.map((change, index) => {
    const row = rows[index] as Record<string, unknown>;
    const sourceId = row[field];
    const campaignId = campaigns.get(String(row.characterId)) ?? null;
    const source = typeof sourceId === 'string' ? byId.get(sourceId) : undefined;
    const resolved = source && source.campaignId === campaignId ? source : undefined;
    const mechanics = sourceId
      ? libraryMechanics.parse({
          sourceId,
          campaignId,
          sourceRevision: resolved ? Number(resolved.revision) : null,
          effects: resolved?.effects ?? null,
        })
      : null;
    return { ...change, data: { ...row, libraryMechanics: mechanics } };
  });
}
