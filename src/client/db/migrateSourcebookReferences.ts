import type { Transaction } from 'dexie';
import type { OutboxEntry } from './dexie.ts';

const canonical = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
type LegacyBook = {
  id: string;
  campaignId: string;
  key?: string;
  name: string;
  definitionIds?: string[];
};
const libraryStores = [
  'campaignLibraryTraits',
  'campaignLibrarySkills',
  'campaignLibrarySpells',
  'campaignLibraryItems',
  'campaignLibraryLanguages',
  'campaignLibraryTechniques',
  'campaignLibraryStyles',
  'campaignLibraryEnchantments',
  'campaignLibraryActiveEffects',
  'campaignLibraryModifiers',
  'campaignLibraryRaces',
];

/** Only upgrade code interprets old source keys. Unresolved queued edits stay recoverable. */
export function migrateSourcebookValue(
  value: unknown,
  campaignId: string | null | undefined,
  books: readonly LegacyBook[],
  strict = true,
  definitionCampaigns: ReadonlyMap<string, string> = new Map(),
): unknown {
  if (Array.isArray(value))
    return value.map((entry) =>
      migrateSourcebookValue(entry, campaignId, books, strict, definitionCampaigns),
    );
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>;
  const origin =
    typeof row.definitionId === 'string'
      ? books.find((book) => book.definitionIds?.includes(String(row.definitionId)))
      : undefined;
  const resolvedCampaignId =
    typeof row.definitionId === 'string'
      ? (definitionCampaigns.get(row.definitionId) ?? origin?.campaignId)
      : typeof row.campaignId === 'string' && 'sourceKey' in row
        ? row.campaignId
        : campaignId;
  return Object.fromEntries(
    Object.entries(row).map(([key, entry]) => {
      if (key === 'sourceKey') {
        if (entry == null) return ['sourceId', null];
        const book = books.find(
          (book) =>
            book.campaignId === resolvedCampaignId &&
            canonical(book.key ?? '') === canonical(String(entry)),
        );
        if (!book && strict)
          throw new Error(
            `Choose a sourcebook for the retained edit (old source: ${String(entry)}), then save it again.`,
          );
        return ['sourceId', book?.id ?? null];
      }
      return [
        key,
        migrateSourcebookValue(entry, resolvedCampaignId, books, strict, definitionCampaigns),
      ];
    }),
  );
}

export async function migrateSourcebookReferences(tx: Transaction): Promise<void> {
  const books = await tx.table<LegacyBook>('campaignLibrarySources').toArray();
  const ops = await tx.table<OutboxEntry>('outbox').toArray();
  const definitionCampaigns = new Map<string, string>();
  // A queued source rename can have changed the local alias already. Both old
  // and new aliases identify the same UUID during this one-time upgrade.
  for (const op of ops.filter((op) => op.entityClass === 'campaign_library_source')) {
    for (const value of [op.prevValue, op.attemptedValue]) {
      if (value && typeof value === 'object' && 'key' in value && 'name' in value && op.parentId)
        books.push({
          id: op.entityId,
          campaignId: op.parentId,
          key: String(value.key),
          name: String(value.name),
        });
    }
  }
  for (const store of libraryStores) {
    const rows = (await tx.table(store).toArray()) as {
      id: string;
      campaignId: string;
      sourceKey?: string;
    }[];
    for (const row of rows) {
      definitionCampaigns.set(row.id, row.campaignId);
    }
  }
  const characters = (await tx.table('characters').toArray()) as {
    id: string;
    campaignId: string | null;
  }[];
  const campaignFor = (characterId: string | undefined) =>
    characters.find((row) => row.id === characterId)?.campaignId;
  for (const store of [...libraryStores, 'characters', 'characterTraits', 'characterInventory']) {
    await tx
      .table(store)
      .toCollection()
      .modify(function (this: { value: Record<string, unknown> }, row: Record<string, unknown>) {
        const campaignId =
          store.startsWith('campaignLibrary') || store === 'characters'
            ? String(row.campaignId)
            : campaignFor(String(row.characterId));
        const migrated = migrateSourcebookValue(
          row,
          campaignId,
          books,
          false,
          definitionCampaigns,
        ) as Record<string, unknown>;
        this.value = migrated;
      });
  }
  const stripBookKey = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const { key: _key, ...body } = value as Record<string, unknown>;
    return body;
  };
  for (const op of ops) {
    const original = { attemptedValue: op.attemptedValue, prevValue: op.prevValue };
    const campaignId = op.entityClass.startsWith('campaign_library_')
      ? op.parentId
      : campaignFor(op.parentId ?? op.entityId);
    try {
      const value =
        op.fieldPath === 'sourceKey' ? { sourceKey: op.attemptedValue } : op.attemptedValue;
      const previous = op.fieldPath === 'sourceKey' ? { sourceKey: op.prevValue } : op.prevValue;
      op.attemptedValue = migrateSourcebookValue(
        value,
        campaignId,
        books,
        true,
        definitionCampaigns,
      );
      op.prevValue = migrateSourcebookValue(previous, campaignId, books, true, definitionCampaigns);
      if (op.fieldPath === 'sourceKey') {
        op.fieldPath = 'sourceId';
        op.coalesceKey = `${op.entityId}|sourceId`;
        op.attemptedValue = (op.attemptedValue as { sourceId: unknown }).sourceId;
        op.prevValue = (op.prevValue as { sourceId: unknown }).sourceId;
      }
      if (op.entityClass === 'campaign_library_source') {
        op.attemptedValue = stripBookKey(op.attemptedValue);
        op.prevValue = stripBookKey(op.prevValue);
      }
      if (op.localCampaignTransferUndo)
        op.localCampaignTransferUndo = op.localCampaignTransferUndo.map((undo) => ({
          ...undo,
          before: migrateSourcebookValue(
            undo.before,
            campaignId,
            books,
            false,
            definitionCampaigns,
          ) as Record<string, unknown>,
          after: migrateSourcebookValue(
            undo.after,
            campaignId,
            books,
            false,
            definitionCampaigns,
          ) as Record<string, unknown>,
        }));
    } catch (error) {
      // Archive the original intent, operation ID and ordering. It must never replay
      // with a guessed UUID or silently become an instruction to clear a link.
      op.localSourceMigrationIntent = original;
      op.attemptedValue = migrateSourcebookValue(
        original.attemptedValue,
        campaignId,
        books,
        false,
        definitionCampaigns,
      );
      op.prevValue = migrateSourcebookValue(
        original.prevValue,
        campaignId,
        books,
        false,
        definitionCampaigns,
      );
      if (op.fieldPath === 'sourceKey') {
        op.fieldPath = 'sourceId';
        op.coalesceKey = `${op.entityId}|sourceId`;
        op.attemptedValue = null;
        op.prevValue = (
          migrateSourcebookValue(
            { sourceKey: original.prevValue },
            campaignId,
            books,
            false,
            definitionCampaigns,
          ) as {
            sourceId: unknown;
          }
        ).sourceId;
      }
      op.localSourceMigrationUnknown = true;
      op.serverReason =
        error instanceof Error ? error.message : 'Choose a sourcebook for the retained edit.';
    }
    await tx.table('outbox').put(op);
  }
  await tx
    .table('campaignLibrarySources')
    .toCollection()
    .modify(function (this: { value: Record<string, unknown> }, row: Record<string, unknown>) {
      const { key: _key, ...book } = row;
      this.value = book;
    });
}
