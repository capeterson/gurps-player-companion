import { libraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import type { SyncCursorChange } from '../../shared/schemas/sync.ts';

/** Called after the character share gate. Owned copies never fetch live source data. */
export async function withLibraryMechanics(
  changes: SyncCursorChange[],
  _accessibleCampaignIds: string[],
): Promise<SyncCursorChange[]> {
  return changes.map((change) => {
    const row = change.data as Record<string, unknown>;
    return {
      ...change,
      data: {
        ...row,
        libraryMechanics:
          row.libraryMechanics == null ? null : libraryMechanics.parse(row.libraryMechanics),
      },
    };
  });
}
