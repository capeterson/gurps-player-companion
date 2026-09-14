import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  librarySkillCopyNotes,
  resolveLibrarySkillSpecialization,
} from '../../shared/domain/librarySkillSpecializations.ts';
import {
  evaluateSkillPrerequisite,
  failedPrerequisiteMessages,
} from '../../shared/domain/skillRules.ts';
import { enchantmentRef } from '../../shared/schemas/inventory.ts';
import { libraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import type { SkillPrerequisite } from '../../shared/schemas/skill.ts';
import { assertWrite, canWriteCharacter } from '../auth/permissions.ts';
import type { AuditTx } from '../db/auditContext.ts';
import {
  campaignLibraryEnchantments,
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
import { loadCharacterDetail } from './characterSummary.ts';
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

export async function hydrateItemEnchantmentDefinitions<T extends Record<string, unknown>>(
  tx: AuditTx,
  campaignId: string | null,
  values: T,
  existing?: { weaponData: unknown; armor: unknown; isArmor: boolean },
): Promise<T> {
  if (values.enchantments === undefined) return values;
  const parsed = enchantmentRef.array().safeParse(values.enchantments);
  if (!parsed.success)
    throw new HTTPException(400, { message: 'Enchantments must be a valid list' });
  const weaponData = values.weaponData === undefined ? existing?.weaponData : values.weaponData;
  const armor = values.armor === undefined ? existing?.armor : values.armor;
  const isArmor = values.isArmor === undefined ? existing?.isArmor : values.isArmor;
  const hydrated = [];
  for (const entry of parsed.data) {
    if (!entry.definitionId) {
      hydrated.push(entry);
      continue;
    }
    if (!campaignId)
      throw new HTTPException(403, {
        message: 'Enchantment definition is unavailable in this campaign',
      });
    const [definition] = await tx
      .select()
      .from(campaignLibraryEnchantments)
      .where(
        and(
          eq(campaignLibraryEnchantments.id, entry.definitionId.toLowerCase()),
          eq(campaignLibraryEnchantments.campaignId, campaignId),
        ),
      )
      .for('share');
    if (!definition)
      throw new HTTPException(403, {
        message: 'Enchantment definition is unavailable in this campaign',
      });
    const compatible =
      definition.applicability === 'any' ||
      (definition.applicability === 'weapon' && weaponData != null) ||
      (definition.applicability === 'armor' && isArmor === true && armor != null) ||
      (definition.applicability === 'shield' &&
        typeof weaponData === 'object' &&
        weaponData != null &&
        'db' in weaponData &&
        weaponData.db != null);
    if (!compatible)
      throw new HTTPException(400, {
        message: `${definition.name} does not apply to this item`,
      });
    hydrated.push(
      enchantmentRef.parse({
        ...entry,
        spellName: definition.name,
        definitionId: definition.id,
        definitionRevision: Number(definition.revision),
        definitionSource: definition.source,
        mechanics: {
          applicability: definition.applicability,
          effects: definition.effects,
          levels: definition.levels,
          stackingPolicy: definition.stackingPolicy,
        },
      }),
    );
  }
  return { ...values, enchantments: hydrated };
}

function gmPermissionLabels(rule: SkillPrerequisite): string[] {
  if (rule.kind === 'gm_permission') return [rule.label];
  if (rule.kind === 'all' || rule.kind === 'any') return rule.children.flatMap(gmPermissionLabels);
  return [];
}

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
    !(
      kind === 'skills' &&
      (values.specialization !== undefined ||
        values.points !== undefined ||
        values.techLevel !== undefined)
    ) &&
    !(kind === 'items' && values.enchantments !== undefined)
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
  if (kind === 'items' && values.enchantments !== undefined) {
    const item = existing as typeof inventoryItems.$inferSelect | undefined;
    const readableCampaignId =
      campaign && (campaign.ownerId === userId || membership) ? parent.campaignId : null;
    Object.assign(
      values,
      await hydrateItemEnchantmentDefinitions(tx, readableCampaignId, values, item),
    );
  }
  const sourceId =
    values[cfg.field] === undefined
      ? (existing as Record<string, unknown> | undefined)?.[cfg.field]
      : values[cfg.field];
  if (sourceId === null || sourceId === undefined) {
    if (kind === 'skills' && values.specialization !== undefined && existing) {
      const saved = libraryMechanics.safeParse(
        'libraryMechanics' in existing ? existing.libraryMechanics : null,
      );
      if (saved.success && saved.data.detached && saved.data.skillRules) {
        (values as Record<string, unknown>).libraryMechanics = {
          ...saved.data,
          skillRules: {
            ...saved.data.skillRules,
            gmPermissions: [],
            gmPermissionSpecialization: null,
          },
        };
      }
    }
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
  let resolvedSkill: ReturnType<typeof resolveLibrarySkillSpecialization> | undefined;
  let skillGmPermissions: string[] | undefined;
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
      resolvedSkill = resolved;
      const existingReference =
        existing && cfg.field in existing
          ? (existing as unknown as Record<string, unknown>)[cfg.field]
          : undefined;
      const referenceChanged = !existing || existingReference !== canonicalSourceId;
      const existingMechanics = libraryMechanics.safeParse(
        existing && 'libraryMechanics' in existing ? existing.libraryMechanics : null,
      );
      const granted = new Set(
        existingMechanics.success &&
          existingMechanics.data.sourceId === canonicalSourceId &&
          existingMechanics.data.campaignId === campaign.id &&
          existingMechanics.data.skillRules?.gmPermissionSpecialization === resolved.specialization
          ? existingMechanics.data.skillRules?.gmPermissions
          : [],
      );
      if (campaign.ownerId === userId && resolved.prerequisiteRules) {
        for (const label of gmPermissionLabels(resolved.prerequisiteRules)) granted.add(label);
      }
      skillGmPermissions = [...granted];
      const requestedTechLevel =
        values.techLevel === undefined
          ? existing && 'techLevel' in existing
            ? existing.techLevel
            : undefined
          : values.techLevel;
      if (skillSource.techLevelPolicy.kind === 'required' && requestedTechLevel == null) {
        throw new Error(`${skillSource.name} requires a concrete Tech Level`);
      }
      if (
        skillSource.techLevelPolicy.kind === 'fixed' &&
        requestedTechLevel != null &&
        requestedTechLevel !== skillSource.techLevelPolicy.techLevel
      ) {
        throw new Error(
          `${skillSource.name} is fixed at TL${skillSource.techLevelPolicy.techLevel}`,
        );
      }
      if (values[cfg.field] !== undefined || values.techLevel !== undefined || !existing) {
        (values as Record<string, unknown>).techLevel =
          skillSource.techLevelPolicy.kind === 'fixed'
            ? skillSource.techLevelPolicy.techLevel
            : skillSource.techLevelPolicy.kind === 'not_applicable'
              ? null
              : requestedTechLevel;
      }
      if (values[cfg.field] !== undefined || values.specialization !== undefined || !existing) {
        (values as Record<string, unknown>).specialization = resolved.specialization;
      }
      if (values.defaults === undefined && referenceChanged) {
        (values as Record<string, unknown>).defaults = resolved.defaults ?? null;
      }
      if (!existing && values.notes === undefined) {
        (values as Record<string, unknown>).notes = librarySkillCopyNotes(
          skillSource.source,
          resolved,
        );
      }
      const nextPoints = Number(
        typeof values.points === 'number'
          ? values.points
          : existing && 'points' in existing
            ? existing.points
            : 1,
      );
      const previousPoints = Number(existing && 'points' in existing ? existing.points : -1);
      const specializationChanged =
        !existing ||
        ('specialization' in existing && existing.specialization !== resolved.specialization);
      if (
        resolved.prerequisiteRules &&
        (referenceChanged || specializationChanged || nextPoints > previousPoints)
      ) {
        const detail = await loadCharacterDetail(characterId, tx);
        const evaluation = evaluateSkillPrerequisite(resolved.prerequisiteRules, {
          skills: detail.skills
            .filter((skill) => skill.id !== existingId)
            .map((skill) => {
              return {
                name: skill.name,
                specialization: skill.specialization,
                level: skill.effectiveLevel,
                relativeLevel:
                  skill.effectiveLevel == null
                    ? null
                    : skill.effectiveLevel -
                      (skill.attribute === 'ST'
                        ? detail.derived.effectiveSt
                        : skill.attribute === 'DX'
                          ? detail.derived.effectiveDx
                          : skill.attribute === 'IQ'
                            ? detail.derived.effectiveIq
                            : skill.attribute === 'HT'
                              ? detail.derived.effectiveHt
                              : skill.attribute === 'Will'
                                ? detail.derived.will
                                : skill.attribute === 'Per'
                                  ? detail.derived.per
                                  : 10),
                points: skill.points,
              };
            }),
          traits: detail.traits.map((trait) => ({ name: trait.name, level: trait.level })),
          attributes: {
            ST: detail.derived.effectiveSt,
            DX: detail.derived.effectiveDx,
            IQ: detail.derived.effectiveIq,
            HT: detail.derived.effectiveHt,
            Will: detail.derived.will,
            Per: detail.derived.per,
          },
          techLevel: campaign.techLevel,
          campaignRules: campaign.houseRules,
          gmPermissions: granted,
          targetSpecialization: resolved.specialization,
        });
        if (evaluation.truth !== 'met' && campaign.skillPrerequisitePolicy === 'block') {
          throw new Error(
            `Unmet prerequisites for ${skillSource.name}: ${failedPrerequisiteMessages(evaluation).join('; ')}`,
          );
        }
      }
    } catch (error) {
      throw new HTTPException(400, { message: (error as Error).message });
    }
  }
  if (kind === 'traits' || kind === 'skills') {
    const snapshot = await captureLibraryMechanics(tx, characterId, kind, canonicalSourceId);
    if (kind === 'skills' && snapshot) {
      if (!resolvedSkill) throw new Error('skill mechanics were not resolved');
      (values as Record<string, unknown>).libraryMechanics = libraryMechanics.parse({
        ...snapshot,
        skillRules: {
          ...snapshot.skillRules,
          prerequisites: resolvedSkill.prerequisiteRules,
          defaults: resolvedSkill.defaults ?? null,
          gmPermissions: skillGmPermissions ?? [],
          gmPermissionSpecialization: resolvedSkill.specialization,
        },
      });
    } else {
      (values as Record<string, unknown>).libraryMechanics = snapshot;
    }
  }
  return values;
}
