import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  librarySkillCopyNotes,
  resolveLibrarySkillSpecialization,
} from '../../shared/domain/librarySkillSpecializations.ts';
import { assertWrite, canWriteCharacter } from '../auth/permissions.ts';
import type { AuditTx } from '../db/auditContext.ts';
import {
  campaignLibraryItems,
  campaignLibraryLanguages,
  campaignLibrarySkills,
  campaignLibrarySpells,
  campaignLibraryTechniques,
  campaignLibraryTraits,
  campaignMemberships,
  campaigns,
  characterLanguages,
  characterSkills,
  characterSpells,
  characterTechniques,
  characterTraits,
  characters,
  inventoryItems,
} from '../db/schema.ts';
import { captureLibraryMechanics, reconcileOwnedTraitKind } from './ownedLibraryMechanics.ts';

const references = {
  traits: {
    source: campaignLibraryTraits,
    child: characterTraits,
    field: 'libraryTraitId',
  },
  skills: {
    source: campaignLibrarySkills,
    child: characterSkills,
    field: 'librarySkillId',
  },
  spells: {
    source: campaignLibrarySpells,
    child: characterSpells,
    field: 'librarySpellId',
  },
  items: {
    source: campaignLibraryItems,
    child: inventoryItems,
    field: 'libraryItemId',
  },
  languages: {
    source: campaignLibraryLanguages,
    child: characterLanguages,
    field: 'libraryLanguageId',
  },
  techniques: {
    source: campaignLibraryTechniques,
    child: characterTechniques,
    field: 'libraryTechniqueId',
  },
} as const;
type ReferenceKind = keyof typeof references;

/** Lock campaign before character, matching library writes and member removal. */
export async function lockLibraryReferenceScope(tx: AuditTx, characterId: string, userId: string) {
  const [observed] = await tx
    .select({ campaignId: characters.campaignId })
    .from(characters)
    .where(eq(characters.id, characterId));
  const [campaign] = observed?.campaignId
    ? await tx.select().from(campaigns).where(eq(campaigns.id, observed.campaignId)).for('share')
    : [];
  const [parent] = await tx
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .for('update');
  if (!parent) throw new HTTPException(404, { message: 'character not found' });
  if (parent.campaignId !== observed?.campaignId)
    throw new HTTPException(503, {
      message: 'Character campaign changed; retry this edit',
    });
  const [membership] =
    campaign && campaign.ownerId !== userId
      ? await tx
          .select()
          .from(campaignMemberships)
          .where(
            and(
              eq(campaignMemberships.campaignId, campaign.id),
              eq(campaignMemberships.userId, userId),
            ),
          )
          .for('share')
      : [];
  const role = campaign?.ownerId === userId ? 'owner' : (membership?.role ?? null);
  assertWrite({
    character: parent,
    canWrite: canWriteCharacter(parent, userId, campaign, role),
  });
  return { parent, campaign, membership };
}

/** Validate every new/reassigned reference in its audited write transaction. */
export async function prepareLibraryReference<T extends Record<string, unknown>>(
  tx: AuditTx,
  userId: string,
  characterId: string,
  kind: ReferenceKind,
  values: T,
  existingId?: string,
): Promise<T> {
  const cfg = references[kind];
  const { parent, campaign, membership } = await lockLibraryReferenceScope(tx, characterId, userId);
  if (
    values[cfg.field] === undefined &&
    !(kind === 'traits' && values.kind !== undefined) &&
    !(kind === 'skills' && values.specialization !== undefined)
  )
    return values;
  if (
    kind === 'traits' &&
    existingId &&
    values.kind !== undefined &&
    values[cfg.field] === undefined
  ) {
    await reconcileOwnedTraitKind(tx, characterId, values, existingId);
    return values;
  }
  const [existing] = existingId
    ? await tx
        .select()
        .from(cfg.child)
        .where(and(eq(cfg.child.id, existingId), eq(cfg.child.characterId, characterId)))
        .for('update')
    : [];
  if (existingId && !existing)
    throw new HTTPException(404, { message: 'character entry not found' });
  const sourceId =
    values[cfg.field] === undefined
      ? (existing as Record<string, unknown> | undefined)?.[cfg.field]
      : values[cfg.field];
  if (sourceId === null || sourceId === undefined) {
    if (
      values[cfg.field] !== undefined &&
      (kind === 'traits' || kind === 'skills') &&
      (!existing || (existing as unknown as Record<string, unknown>)[cfg.field] !== null)
    )
      (values as Record<string, unknown>).libraryMechanics = null;
    return values;
  }
  const denied = () =>
    new HTTPException(403, {
      message: 'Library reference is unavailable in this character campaign',
    });
  if (!campaign || !parent.campaignId || typeof sourceId !== 'string') throw denied();
  const canonicalSourceId = sourceId.toLowerCase();
  if (values[cfg.field] !== undefined)
    (values as Record<string, unknown>)[cfg.field] = canonicalSourceId;
  if (campaign.ownerId !== userId) {
    if (!membership) throw denied();
  }
  const [source] = await tx
    .select()
    .from(cfg.source)
    .where(and(eq(cfg.source.id, canonicalSourceId), eq(cfg.source.campaignId, campaign.id)))
    .for('share');
  if (!source) throw denied();
  if (kind === 'traits' && 'kind' in source) {
    const traitKind = values.kind ?? (existing && 'kind' in existing ? existing.kind : undefined);
    if (source.kind !== traitKind) throw denied();
  }
  if (kind === 'skills') {
    const skillSource = source as typeof campaignLibrarySkills.$inferSelect;
    const existingSpecialization =
      existing && 'specialization' in existing ? existing.specialization : undefined;
    let requested =
      values.specialization === undefined ? existingSpecialization : values.specialization;
    if (
      !requested &&
      (skillSource.specializationPolicy.kind === 'required_freeform' ||
        skillSource.specializationPolicy.kind === 'required_catalog')
    ) {
      requested = skillSource.defaultSpecialization;
    }
    try {
      const resolved = resolveLibrarySkillSpecialization(skillSource, requested as string | null);
      if (values[cfg.field] !== undefined || values.specialization !== undefined || !existing) {
        (values as Record<string, unknown>).specialization = resolved.specialization;
      }
      const existingReference =
        existing && cfg.field in existing
          ? (existing as unknown as Record<string, unknown>)[cfg.field]
          : undefined;
      const referenceChanged = !existing || existingReference !== canonicalSourceId;
      if (values.defaults === undefined && referenceChanged) {
        (values as Record<string, unknown>).defaults = resolved.defaults ?? null;
      }
      if (!existing && values.notes === undefined) {
        (values as Record<string, unknown>).notes = librarySkillCopyNotes(
          skillSource.source,
          resolved,
        );
      }
    } catch (error) {
      throw new HTTPException(400, { message: (error as Error).message });
    }
  }
  if (kind === 'traits' || kind === 'skills')
    (values as Record<string, unknown>).libraryMechanics = await captureLibraryMechanics(
      tx,
      characterId,
      kind,
      canonicalSourceId,
    );
  return values;
}
