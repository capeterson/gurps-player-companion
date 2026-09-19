import { and, eq, inArray, ne } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { resolveLibrarySkillSpecialization } from '../../shared/domain/librarySkillSpecializations.ts';
import { enchantmentRef } from '../../shared/schemas/inventory.ts';
import { libraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import { traitKindEnum } from '../../shared/schemas/trait.ts';
import type { AuditTx } from '../db/auditContext.ts';
import {
  campaignLibraryEnchantments,
  campaignLibraryItems,
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
import { refreshActiveEffectDefinition } from './activeEffects.ts';

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
  const skillSource = source as typeof campaignLibrarySkills.$inferSelect;
  return libraryMechanics.parse({
    sourceId,
    campaignId: parent?.campaignId ?? null,
    sourceRevision: source ? Number(source.revision) : null,
    effects: source?.effects ?? null,
    ...(kind === 'skills'
      ? {
          skillRules: {
            techLevelPolicy: skillSource.techLevelPolicy,
            prerequisites: skillSource.prerequisiteRules,
            defaults: skillSource.defaults,
            groups: skillSource.groups,
            tags: skillSource.tags,
            procedures: skillSource.procedures,
          },
        }
      : {}),
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
  if (kind === 'active-effects')
    return refreshActiveEffectDefinition(tx, campaignId, sourceId, detach);
  if (kind === 'enchantments') {
    const [source] = await tx
      .select()
      .from(campaignLibraryEnchantments)
      .where(
        and(
          eq(campaignLibraryEnchantments.id, sourceId),
          eq(campaignLibraryEnchantments.campaignId, campaignId),
        ),
      )
      .for('update');
    if (!source) return;
    const refresh = (entries: unknown) => {
      const parsed = enchantmentRef.array().safeParse(entries);
      if (!parsed.success) return null;
      let changed = false;
      const next = parsed.data.map((entry) => {
        if (entry.definitionId !== sourceId) return entry;
        changed = true;
        if (detach) return { ...entry, definitionId: null };
        return enchantmentRef.parse({
          ...entry,
          spellName: source.name,
          definitionRevision: Number(source.revision),
          definitionSource: source.source,
          mechanics: {
            applicability: source.applicability,
            effects: source.effects,
            levels: source.levels,
            stackingPolicy: source.stackingPolicy,
          },
        });
      });
      return changed ? next : null;
    };
    const libraryItems = await tx
      .select()
      .from(campaignLibraryItems)
      .where(eq(campaignLibraryItems.campaignId, campaignId));
    for (const item of libraryItems) {
      const enchantments = refresh(item.enchantments);
      if (enchantments)
        await tx
          .update(campaignLibraryItems)
          .set({ enchantments, updatedAt: new Date() })
          .where(eq(campaignLibraryItems.id, item.id));
    }
    const ownedItems = await tx
      .select({ id: inventoryItems.id, enchantments: inventoryItems.enchantments })
      .from(inventoryItems)
      .innerJoin(characters, eq(inventoryItems.characterId, characters.id))
      .where(eq(characters.campaignId, campaignId));
    for (const item of ownedItems) {
      const enchantments = refresh(item.enchantments);
      if (enchantments)
        await tx
          .update(inventoryItems)
          .set({ enchantments, updatedAt: new Date() })
          .where(eq(inventoryItems.id, item.id));
    }
    return;
  }
  if (kind !== 'traits' && kind !== 'skills') return;
  const sourceTable = kind === 'traits' ? campaignLibraryTraits : campaignLibrarySkills;
  const [source] = await tx
    .select()
    .from(sourceTable)
    .where(and(eq(sourceTable.id, sourceId), eq(sourceTable.campaignId, campaignId)))
    .for('update');
  if (!source) return;
  const skillSource = source as typeof campaignLibrarySkills.$inferSelect;
  if (kind === 'skills') {
    const children = await tx
      .select({
        id: characterSkills.id,
        specialization: characterSkills.specialization,
        libraryMechanics: characterSkills.libraryMechanics,
      })
      .from(characterSkills)
      .innerJoin(characters, eq(characterSkills.characterId, characters.id))
      .where(
        and(eq(characterSkills.librarySkillId, sourceId), eq(characters.campaignId, campaignId)),
      );
    for (const child of children) {
      const saved = libraryMechanics.safeParse(child.libraryMechanics);
      let resolved: ReturnType<typeof resolveLibrarySkillSpecialization>;
      try {
        resolved = resolveLibrarySkillSpecialization(skillSource, child.specialization);
      } catch {
        const retained =
          saved.success && saved.data.sourceId === sourceId && saved.data.campaignId === campaignId
            ? saved.data
            : {
                sourceId,
                campaignId,
                sourceRevision: null,
                effects: null,
                detached: true,
              };
        await tx
          .update(characterSkills)
          .set({
            librarySkillId: null,
            libraryMechanics: libraryMechanics.parse({ ...retained, detached: true }),
            updatedAt: new Date(),
          })
          .where(eq(characterSkills.id, child.id));
        continue;
      }
      const snapshot = libraryMechanics.parse({
        sourceId,
        campaignId,
        sourceRevision: Number(skillSource.revision),
        effects: skillSource.effects,
        skillRules: {
          techLevelPolicy: skillSource.techLevelPolicy,
          prerequisites: resolved.prerequisiteRules,
          defaults: resolved.defaults ?? null,
          groups: skillSource.groups,
          tags: skillSource.tags,
          procedures: skillSource.procedures,
          gmPermissions:
            saved.success &&
            saved.data.skillRules?.gmPermissionSpecialization === resolved.specialization
              ? (saved.data.skillRules.gmPermissions ?? [])
              : [],
          gmPermissionSpecialization: resolved.specialization,
        },
        ...(detach ? { detached: true } : {}),
      });
      await tx
        .update(characterSkills)
        .set({
          libraryMechanics: snapshot,
          updatedAt: new Date(),
          ...(detach ? { librarySkillId: null } : {}),
        })
        .where(eq(characterSkills.id, child.id));
    }
    return;
  }
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
    .select({ campaignId: characters.campaignId, activeEffects: characters.activeEffects })
    .from(characters)
    .where(eq(characters.id, characterId))
    .for('update');
  const proposedCampaignId =
    typeof updates.campaignId === 'string' ? updates.campaignId.toLowerCase() : updates.campaignId;
  if (!parent || parent.campaignId === proposedCampaignId) return;
  // Campaign deletion/member removal may have enumerated this row before it moved.
  if (expectedCampaignId !== undefined && parent.campaignId !== expectedCampaignId.toLowerCase())
    return;
  const activeEffects = parent.activeEffects.map((entry) => ({ ...entry, definitionId: null }));
  if (parent.activeEffects.some((entry) => entry.definitionId)) {
    await tx
      .update(characters)
      .set({ activeEffects, updatedAt: new Date() })
      .where(eq(characters.id, characterId));
  }
  if (updates.activeEffects)
    updates.activeEffects = (updates.activeEffects as typeof activeEffects).map((entry) => ({
      ...entry,
      definitionId: null,
    }));
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
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (table === inventoryItems && 'enchantments' in row) {
        const parsed = enchantmentRef.array().safeParse(row.enchantments);
        if (parsed.success && parsed.data.some((entry) => entry.definitionId))
          patch.enchantments = parsed.data.map((entry) =>
            entry.definitionId ? { ...entry, definitionId: null } : entry,
          );
      }
      if (typeof sourceId !== 'string') {
        if (patch.enchantments !== undefined)
          await tx.update(table).set(patch).where(eq(table.id, row.id));
        continue;
      }
      patch[field] = null;
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
