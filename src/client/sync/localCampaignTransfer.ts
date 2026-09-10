import type { Table } from 'dexie';
import { libraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import { type LocalCampaignTransferUndo, getLocalDb } from '../db/dexie.ts';

export function campaignTransferStores() {
  const db = getLocalDb();
  return [
    db.characterTraits,
    db.characterSkills,
    db.characterSpells,
    db.characterInventory,
    db.characterLanguages,
    db.characterTechniques,
  ];
}

const fields = [
  'libraryTraitId',
  'librarySkillId',
  'librarySpellId',
  'libraryItemId',
  'libraryLanguageId',
  'libraryTechniqueId',
] as const;

export function localCampaignReferenceUndo(
  store: string,
  row: Record<string, unknown>,
  campaignId: string | null,
): LocalCampaignTransferUndo | null {
  const index = campaignTransferStores().findIndex((table) => table.name === store);
  const field = fields[index];
  if (!field || typeof row[field] !== 'string') return null;
  const before: Record<string, unknown> = { [field]: row[field] };
  const after: Record<string, unknown> = { [field]: null };
  if (index < 2) {
    before.libraryMechanics = row.libraryMechanics ?? null;
    const saved = libraryMechanics.safeParse(row.libraryMechanics);
    const trusted =
      saved.success && saved.data.sourceId === row[field] && saved.data.campaignId === campaignId
        ? saved.data
        : null;
    after.libraryMechanics = libraryMechanics.parse({
      ...(trusted ?? { sourceId: row[field], campaignId, sourceRevision: null, effects: null }),
      detached: true,
    });
  }
  return { store, entityId: String(row.id), campaignId, before, after };
}

/** Called inside the same transaction as the character patch and its outbox entry. */
export async function detachLocalCampaignReferences(
  characterId: string,
  campaignId: string | null,
) {
  const undo: LocalCampaignTransferUndo[] = [];
  const stores = campaignTransferStores();
  for (const store of stores) {
    const table = store as unknown as Table<Record<string, unknown>, string>;
    for (const row of await table.where('characterId').equals(characterId).toArray()) {
      const entry = localCampaignReferenceUndo(table.name, row, campaignId);
      if (!entry) continue;
      undo.push(entry);
      await table.update(entry.entityId, entry.after);
    }
  }
  return undo;
}

/** Restore only our side effects, preserving later edits and deleted children. */
export async function restoreLocalCampaignReferences(
  undo: LocalCampaignTransferUndo[],
  campaignId: unknown,
) {
  const db = getLocalDb();
  for (const entry of undo) {
    if (
      (entry.campaignId?.toLowerCase() ?? null) !==
      (typeof campaignId === 'string' ? campaignId.toLowerCase() : campaignId)
    )
      continue;
    const table = campaignTransferStores().find((store) => store.name === entry.store) as
      | Table<Record<string, unknown>, string>
      | undefined;
    if (!table) continue;
    const row = await table.get(entry.entityId);
    if (
      !row ||
      !Object.entries(entry.after).every(
        ([key, value]) => JSON.stringify(row[key]) === JSON.stringify(value),
      )
    )
      continue;
    const dirty = await db.outbox.where('entityId').equals(entry.entityId).toArray();
    if (
      dirty.some(
        (op) =>
          op.fieldPath &&
          op.fieldPath in entry.before &&
          ['pending', 'in_flight', 'transient_retry'].includes(op.status),
      )
    )
      continue;
    await table.update(entry.entityId, entry.before);
  }
}

export function mergeCampaignTransferUndo(
  first: LocalCampaignTransferUndo[] = [],
  second: LocalCampaignTransferUndo[] = [],
) {
  return [
    ...first,
    ...second.filter(
      (entry) => !first.some((old) => old.store === entry.store && old.entityId === entry.entityId),
    ),
  ];
}
