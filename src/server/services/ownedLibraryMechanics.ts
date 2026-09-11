import { and, eq, inArray, ne } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { libraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import { traitKindEnum } from '../../shared/schemas/trait.ts';
import type { AuditTx } from '../db/auditContext.ts';
import {
  campaignLibrarySkills,
  campaignLibraryTraits,
  characterLanguages,
  characterSkills,
  characterSpells,
  characterTechniques,
  characterTraits,
  characters,
  inventoryItems,
} from '../db/schema.ts';

export async function captureLibraryMechanics(
  tx: AuditTx,
  characterId: string,
  kind: 'traits' | 'skills',
  sourceId: string | null | undefined,
) {
  if (!sourceId) return null;
  const [parent] = await tx
    .select({ campaignId: characters.campaignId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .for('share');
  const table = kind === 'traits' ? campaignLibraryTraits : campaignLibrarySkills;
  const [source] = parent?.campaignId
    ? await tx
        .select()
        .from(table)
        .where(and(eq(table.id, sourceId), eq(table.campaignId, parent.campaignId)))
        .for('share')
    : [];
  if (!source)
    throw new HTTPException(403, {
      message: 'Library reference is unavailable in this character campaign',
    });
  return libraryMechanics.parse({
    sourceId,
    campaignId: parent?.campaignId ?? null,
    sourceRevision: source ? Number(source.revision) : null,
    effects: source?.effects ?? null,
  });
}

/** The same function serves CRUD and YAML updates/deletes; every JSON write is validated. */
export async function refreshOwnedLibraryMechanics(
  tx: AuditTx,
  kind: string,
  campaignId: string,
  sourceId: string,
  detach = false,
) {
  if (kind !== 'traits' && kind !== 'skills') return;
  const sourceTable = kind === 'traits' ? campaignLibraryTraits : campaignLibrarySkills;
  const [source] = await tx
    .select()
    .from(sourceTable)
    .where(and(eq(sourceTable.id, sourceId), eq(sourceTable.campaignId, campaignId)))
    .for('update');
  if (!source) return;
  const childTable = kind === 'traits' ? characterTraits : characterSkills;
  const reference =
    kind === 'traits' ? characterTraits.libraryTraitId : characterSkills.librarySkillId;
  const children = await tx
    .select({ id: childTable.id })
    .from(childTable)
    .innerJoin(characters, eq(childTable.characterId, characters.id))
    .where(and(eq(reference, sourceId), eq(characters.campaignId, campaignId)));
  if (!children.length) return;
  const snapshot = libraryMechanics.parse({
    sourceId,
    campaignId,
    sourceRevision: Number(source.revision),
    effects: source.effects,
    ...(detach ? { detached: true } : {}),
  });
  if (kind === 'traits' && 'kind' in source && !detach) {
    // A paid trait keeps its category. If the source changes categories,
    // capture its last owned declaration and end the incompatible live link.
    const mismatches = await tx
      .select()
      .from(characterTraits)
      .where(
        and(
          eq(characterTraits.libraryTraitId, sourceId),
          ne(characterTraits.kind, traitKindEnum.parse(source.kind)),
          inArray(
            characterTraits.id,
            children.map((child) => child.id),
          ),
        ),
      )
      .for('update');
    for (const child of mismatches) {
      const saved = libraryMechanics.safeParse(child.libraryMechanics);
      const retained =
        saved.success && saved.data.sourceId === sourceId && saved.data.campaignId === campaignId
          ? saved.data
          : { sourceId, campaignId, sourceRevision: null, effects: null };
      await tx
        .update(characterTraits)
        .set({
          libraryTraitId: null,
          libraryMechanics: libraryMechanics.parse({ ...retained, detached: true }),
          updatedAt: new Date(),
        })
        .where(eq(characterTraits.id, child.id));
    }
  }
  await tx
    .update(childTable)
    .set({
      libraryMechanics: snapshot,
      updatedAt: new Date(),
      ...(detach ? (kind === 'traits' ? { libraryTraitId: null } : { librarySkillId: null }) : {}),
    })
    .where(
      and(
        eq(reference, sourceId),
        inArray(
          childTable.id,
          children.map((child) => child.id),
        ),
      ),
    );
}

/** Moving a character preserves its owned copies and ends all six live source links. */
export async function detachLibraryReferencesForTransfer(
  tx: AuditTx,
  characterId: string,
  updates: Record<string, unknown>,
  expectedCampaignId?: string,
) {
  if (updates.campaignId === undefined) return;
  const [parent] = await tx
    .select({ campaignId: characters.campaignId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .for('update');
  const proposedCampaignId =
    typeof updates.campaignId === 'string' ? updates.campaignId.toLowerCase() : updates.campaignId;
  if (!parent || parent.campaignId === proposedCampaignId) return;
  // Campaign deletion/member removal may have enumerated this row before it moved.
  if (expectedCampaignId !== undefined && parent.campaignId !== expectedCampaignId.toLowerCase())
    return;
  const configs = [
    { table: characterTraits, field: 'libraryTraitId' },
    { table: characterSkills, field: 'librarySkillId' },
    { table: characterSpells, field: 'librarySpellId' },
    { table: inventoryItems, field: 'libraryItemId' },
    { table: characterLanguages, field: 'libraryLanguageId' },
    { table: characterTechniques, field: 'libraryTechniqueId' },
  ];
  for (const { table, field } of configs) {
    const rows = await tx
      .select()
      .from(table)
      .where(eq(table.characterId, characterId))
      .for('update');
    for (const row of rows) {
      const sourceId = (row as unknown as Record<string, unknown>)[field];
      if (typeof sourceId !== 'string') continue;
      const patch: Record<string, unknown> = { [field]: null, updatedAt: new Date() };
      if ('libraryMechanics' in row) {
        const saved = libraryMechanics.safeParse(row.libraryMechanics);
        const trusted =
          saved.success &&
          saved.data.sourceId === sourceId &&
          saved.data.campaignId === parent.campaignId
            ? saved.data
            : null;
        patch.libraryMechanics = libraryMechanics.parse({
          ...(trusted ?? {
            sourceId,
            campaignId: parent.campaignId,
            sourceRevision: null,
            effects: null,
          }),
          detached: true,
        });
      }
      await tx.update(table).set(patch).where(eq(table.id, row.id));
    }
  }
}

/** Called after patch validation/stale checks, in the write transaction. */
export async function reconcileOwnedTraitKind(
  tx: AuditTx,
  characterId: string,
  updates: Record<string, unknown>,
  existingId: string,
) {
  if (updates.kind === undefined || updates.libraryTraitId !== undefined) return;
  // Caller holds the parent lock. Lock the source before the child, matching
  // source refresh, so a concurrent library edit cannot replace our snapshot.
  const [observed] = await tx
    .select()
    .from(characterTraits)
    .where(and(eq(characterTraits.id, existingId), eq(characterTraits.characterId, characterId)));
  if (!observed?.libraryTraitId) return;
  const [source] = await tx
    .select()
    .from(campaignLibraryTraits)
    .where(eq(campaignLibraryTraits.id, observed.libraryTraitId))
    .for('share');
  if (source?.kind === updates.kind) return;
  const [existing] = await tx
    .select()
    .from(characterTraits)
    .where(and(eq(characterTraits.id, existingId), eq(characterTraits.characterId, characterId)))
    .for('update');
  if (!existing?.libraryTraitId || existing.libraryTraitId !== observed.libraryTraitId) return;
  const saved = libraryMechanics.safeParse(existing.libraryMechanics);
  const retained =
    saved.success && saved.data.sourceId === existing.libraryTraitId
      ? saved.data
      : {
          sourceId: existing.libraryTraitId,
          campaignId: source?.campaignId ?? null,
          sourceRevision: null,
          effects: null,
        };
  updates.libraryTraitId = null;
  updates.libraryMechanics = libraryMechanics.parse({ ...retained, detached: true });
}
