import {
  type LibraryGraph,
  libraryEditionDecisions,
  mergeLibraryGraph,
  validateLibraryGraph,
} from '../../shared/domain/libraryGraph.ts';
import { canAdoptLibraryEntry, libraryEntryKey } from '../../shared/domain/libraryIdentity.ts';
import { validatePricingCatalog } from '../../shared/domain/libraryPricing.ts';
import { activeEffectDefinitionOut } from '../../shared/schemas/activeEffects.ts';
import { libraryModifierOut, librarySourceOut } from '../../shared/schemas/libraryMetadata.ts';
import {
  exportSourceReferences,
  importSourceReferences,
  sourceExportKeys,
} from '../../shared/yaml/sourceReferences.ts';
import { campaignLibrarySources } from '../db/schema.ts';
import { loadLibraryGraph } from '../services/libraryPricing.ts';
import { loadPricingCatalog } from '../services/libraryPricing.ts';
import { importSourcebooks } from '../services/librarySourceImport.ts';
import { modifierEntity, sourceEntity } from './campaignLibraryEntities.ts';
/**
 * Campaign library CRUD + YAML import/export.
 *
 * Reads require campaign membership; writes require ownership.  YAML
 * import/export lives at /campaigns/{id}/library/import|export.  The
 * shared YAML codec (src/shared/yaml/library.ts) handles parse,
 * validate, and round-trippable emit; this router glues it to the DB.
 *
 * Per-entity CRUD endpoints exist mainly to back the library editor
 * UI; the sync path doesn't yet drive library mutations through the
 * outbox.
 *
 * The four entity kinds (traits/skills/spells/items) are structurally
 * identical apart from their columns and schemas, so this file is
 * config-driven: `campaignLibraryEntities.ts` holds one
 * `LibraryEntityConfig` per kind (mappers, schemas, natural key), and
 * `campaignLibraryCrud.ts` has the generic `registerLibraryCrud`
 * (POST/PATCH/DELETE route triple) and `upsertByKey` (YAML
 * upsert-by-natural-key loop) factories that consume them. This file
 * wires those up and keeps the routes whose shape genuinely differs
 * per-kind (the combined GET list, and the YAML export/import bodies).
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { applyHouseRuleSet } from '../../shared/domain/campaignRules.ts';
import { canonicalLibraryKey } from '../../shared/domain/libraryIdentity.ts';
import { calculationKey } from '../../shared/schemas/calculation.ts';
import { campaignUpdate } from '../../shared/schemas/campaign.ts';
import {
  importMode,
  importResult,
  libraryEnchantmentOut,
  libraryItemOut,
  libraryLanguageOut,
  librarySkillOut,
  librarySpellOut,
  libraryStyleOut,
  libraryTechniqueOut,
  libraryTraitOut,
} from '../../shared/schemas/campaignLibrary.ts';
import { uuid } from '../../shared/schemas/common.ts';
import { librarySkillDetail } from '../../shared/schemas/details.ts';
import {
  LibraryYamlError,
  emitLibraryYaml,
  parseLibraryYaml,
  sourceScopedLibrary,
} from '../../shared/yaml/library.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { requireCampaignMember, requireCampaignOwner } from '../auth/permissions.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { campaigns } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import {
  advanceLibraryCampaignRevision,
  publishLibraryInvalidation,
} from '../services/libraryInvalidation.ts';
import { buildPatchSet } from '../services/patchSet.ts';
import { registerLibraryCrud, selectLibrarySection, upsertByKey } from './campaignLibraryCrud.ts';
import {
  activeEffectEntity,
  enchantmentEntity,
  itemEntity,
  languageEntity,
  skillEntity,
  spellEntity,
  styleEntity,
  techniqueEntity,
  traitEntity,
} from './campaignLibraryEntities.ts';

const router = createOpenApiApp();
router.use('/campaigns/*', requireActiveUser);

const libraryReadQuery = z.object({
  section: z
    .enum([
      'sources',
      'modifiers',
      'traits',
      'skills',
      'spells',
      'items',
      'languages',
      'techniques',
      'styles',
      'enchantments',
      'activeEffects',
    ])
    .optional()
    .describe('Return only this library section; every other section is an empty array.'),
  search: z.string().trim().min(1).max(120).optional().describe('Name substring filter.'),
  limit: z.coerce.number().int().min(1).max(500).optional().describe('Maximum rows per section.'),
  offset: z.coerce.number().int().min(0).max(100_000).optional().describe('Rows to skip.'),
});

function narrowLibraryRows<T extends { name: string }>(
  rows: T[],
  search: string | undefined,
  limit: number | undefined,
  offset: number | undefined,
): T[] {
  const matched = search
    ? rows.filter((row) => row.name.toLowerCase().includes(search.toLowerCase()))
    : rows;
  const start = offset ?? 0;
  return limit === undefined ? matched.slice(start) : matched.slice(start, start + limit);
}

// ===================== LIST =====================

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns/{id}/library',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Get/filter the campaign library (member or owner)',
    request: { params: z.object({ id: uuid }), query: libraryReadQuery },
    responses: {
      200: {
        description: 'Library payload',
        content: {
          'application/json': {
            schema: z.object({
              sources: z.array(librarySourceOut),
              modifiers: z.array(libraryModifierOut),
              traits: z.array(libraryTraitOut),
              skills: z.array(librarySkillOut),
              spells: z.array(librarySpellOut),
              items: z.array(libraryItemOut),
              languages: z.array(libraryLanguageOut),
              techniques: z.array(libraryTechniqueOut),
              styles: z.array(libraryStyleOut),
              enchantments: z.array(libraryEnchantmentOut),
              activeEffects: z.array(activeEffectDefinitionOut),
            }),
          },
        },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { section, search, limit, offset } = c.req.valid('query');
    const { campaign } = await requireCampaignMember(id, user.id);
    const db = getDb();
    const visible = <T extends { restricted?: boolean }>(rows: T[]): T[] =>
      campaign.ownerId === user.id ? rows : rows.filter((row) => !row.restricted);
    const includes = (candidate: string) => section === undefined || section === candidate;
    const sources = includes('sources') ? await selectLibrarySection(db, sourceEntity, id) : [];
    const modifiers = includes('modifiers')
      ? await selectLibrarySection(db, modifierEntity, id)
      : [];
    const traits = includes('traits') ? await selectLibrarySection(db, traitEntity, id) : [];
    const skills = includes('skills') ? await selectLibrarySection(db, skillEntity, id) : [];
    const spells = includes('spells') ? await selectLibrarySection(db, spellEntity, id) : [];
    const items = includes('items') ? await selectLibrarySection(db, itemEntity, id) : [];
    const languages = includes('languages')
      ? await selectLibrarySection(db, languageEntity, id)
      : [];
    const techniques = includes('techniques')
      ? await selectLibrarySection(db, techniqueEntity, id)
      : [];
    const styles = includes('styles') ? await selectLibrarySection(db, styleEntity, id) : [];
    const enchantments = includes('enchantments')
      ? await selectLibrarySection(db, enchantmentEntity, id)
      : [];
    const activeEffects = includes('activeEffects')
      ? await selectLibrarySection(db, activeEffectEntity, id)
      : [];
    return c.json(
      {
        sources: narrowLibraryRows(sources.map(sourceEntity.toOut), search, limit, offset),
        modifiers: narrowLibraryRows(
          visible(modifiers).map(modifierEntity.toOut),
          search,
          limit,
          offset,
        ),
        traits: narrowLibraryRows(visible(traits).map(traitEntity.toOut), search, limit, offset),
        skills: narrowLibraryRows(visible(skills).map(skillEntity.toOut), search, limit, offset),
        spells: narrowLibraryRows(visible(spells).map(spellEntity.toOut), search, limit, offset),
        items: narrowLibraryRows(visible(items).map(itemEntity.toOut), search, limit, offset),
        languages: narrowLibraryRows(
          visible(languages).map(languageEntity.toOut),
          search,
          limit,
          offset,
        ),
        techniques: narrowLibraryRows(
          visible(techniques).map(techniqueEntity.toOut),
          search,
          limit,
          offset,
        ),
        styles: narrowLibraryRows(visible(styles).map(styleEntity.toOut), search, limit, offset),
        enchantments: narrowLibraryRows(
          visible(enchantments).map(enchantmentEntity.toOut),
          search,
          limit,
          offset,
        ),
        activeEffects: narrowLibraryRows(
          visible(activeEffects).map(activeEffectEntity.toOut),
          search,
          limit,
          offset,
        ),
      },
      200,
    );
  },
);

// ===================== PER-ENTITY CRUD =====================

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns/{id}/library/skills/{skillId}',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Get one campaign-library skill definition, without the rest of the library',
    request: { params: z.object({ id: uuid, skillId: uuid }) },
    responses: {
      200: {
        description: 'Skill definition',
        content: { 'application/json': { schema: librarySkillDetail } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found or restricted'),
    },
  }),
  async (c) => {
    const { id, skillId } = c.req.valid('param');
    const user = c.get('user');
    const { campaign } = await requireCampaignMember(id, user.id);
    const [row] = await getDb()
      .select()
      .from(skillEntity.table)
      .where(and(eq(skillEntity.table.campaignId, id), eq(skillEntity.table.id, skillId)));
    if (!row || (row.restricted && campaign.ownerId !== user.id))
      throw new HTTPException(404, { message: 'library skill not found' });
    return c.json(
      {
        kind: 'library_skill' as const,
        skill: skillEntity.toOut(row),
        experimentalActiveEffects: campaign.experimentalActiveEffects,
      },
      200,
    );
  },
);

registerLibraryCrud(router, sourceEntity);
registerLibraryCrud(router, modifierEntity);
registerLibraryCrud(router, traitEntity);
registerLibraryCrud(router, skillEntity);
registerLibraryCrud(router, spellEntity);
registerLibraryCrud(router, itemEntity);
registerLibraryCrud(router, languageEntity);
registerLibraryCrud(router, techniqueEntity);
registerLibraryCrud(router, styleEntity);
registerLibraryCrud(router, enchantmentEntity);
registerLibraryCrud(router, activeEffectEntity);

// ===================== YAML EXPORT =====================

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'library'
  );
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns/{id}/library/export',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Export the library as YAML (member or owner)',
    request: {
      params: z.object({ id: uuid }),
      query: z.object({
        sourceIds: z
          .string()
          .max(5000)
          .optional()
          .describe('JSON array of sourcebook UUIDs, URL encoded in the query string'),
      }),
    },
    responses: {
      200: {
        description: 'YAML document',
        content: {
          'application/yaml': { schema: { type: 'string' } as never },
          'text/plain': { schema: { type: 'string' } as never },
        },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const rawRequested = c.req.valid('query').sourceIds;
    let requested: string[] | undefined;
    if (rawRequested !== undefined) {
      try {
        requested = z.array(uuid).min(1).max(30).parse(JSON.parse(rawRequested));
      } catch {
        throw new HTTPException(400, {
          message: 'sourceIds must be a JSON array of sourcebook UUIDs',
        });
      }
    }
    const db = getDb();
    const snapshot = await db.transaction(
      async (tx) => {
        const { campaign } = await requireCampaignMember(id, user.id, tx);
        // A node-postgres transaction owns one connection; keep its statements
        // sequential while REPEATABLE READ supplies the cross-section snapshot.
        const sources = await selectLibrarySection(tx, sourceEntity, id);
        const modifiers = await selectLibrarySection(tx, modifierEntity, id);
        const traits = await selectLibrarySection(tx, traitEntity, id);
        const skills = await selectLibrarySection(tx, skillEntity, id);
        const spells = await selectLibrarySection(tx, spellEntity, id);
        const items = await selectLibrarySection(tx, itemEntity, id);
        const languages = await selectLibrarySection(tx, languageEntity, id);
        const techniques = await selectLibrarySection(tx, techniqueEntity, id);
        const styles = await selectLibrarySection(tx, styleEntity, id);
        const enchantments = await selectLibrarySection(tx, enchantmentEntity, id);
        const activeEffects = await selectLibrarySection(tx, activeEffectEntity, id);
        return {
          campaign,
          sources,
          modifiers,
          traits,
          skills,
          spells,
          items,
          languages,
          techniques,
          styles,
          enchantments,
          activeEffects,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    const {
      campaign,
      sources,
      modifiers,
      traits,
      skills,
      spells,
      items,
      languages,
      techniques,
      styles,
      enchantments,
      activeEffects,
    } = snapshot;
    const visible = <T extends { restricted?: boolean }>(rows: T[]): T[] =>
      campaign.ownerId === user.id ? rows : rows.filter((row) => !row.restricted);
    const exportKeys = sourceExportKeys(sources);
    const requestedKeys = requested?.map((sourceId) => {
      const key = exportKeys.get(sourceId);
      if (!key)
        throw new HTTPException(400, {
          message: 'Selected sourcebook does not belong to this campaign',
        });
      return key;
    });
    const allLibrary = {
      ...exportSourceReferences(
        {
          modifiers: visible(modifiers).map(modifierEntity.rowToCreate),
          traits: visible(traits).map(traitEntity.rowToCreate),
          skills: visible(skills).map(skillEntity.rowToCreate),
          spells: visible(spells).map(spellEntity.rowToCreate),
          items: visible(items).map(itemEntity.rowToCreate),
          languages: visible(languages).map(languageEntity.rowToCreate),
          techniques: visible(techniques).map(techniqueEntity.rowToCreate),
          styles: visible(styles).map(styleEntity.rowToCreate),
          enchantments: visible(enchantments).map(enchantmentEntity.rowToCreate),
          activeEffects: visible(activeEffects).map(activeEffectEntity.rowToCreate),
        },
        sources,
      ),
      sources: sources.map((row) => ({
        ...sourceEntity.rowToCreate(row),
        key: exportKeys.get(row.id) as string,
      })),
    };
    let exported: Parameters<typeof emitLibraryYaml>[0] = allLibrary;
    if (requested) {
      try {
        const scoped = sourceScopedLibrary(allLibrary, requestedKeys as string[]);
        exported = {
          ...scoped,
          sources: scoped.sources ?? [],
          modifiers: scoped.modifiers ?? [],
          spells: scoped.spells ?? [],
          languages: scoped.languages ?? [],
          techniques: scoped.techniques ?? [],
          styles: scoped.styles ?? [],
          enchantments: scoped.enchantments ?? [],
          activeEffects: scoped.activeEffects ?? [],
        };
      } catch (error) {
        throw new HTTPException(400, { message: (error as Error).message });
      }
    }
    const yamlText = emitLibraryYaml({
      ...(requested
        ? { scope: { kind: 'sources' as const, sourceKeys: requestedKeys as string[] } }
        : {}),
      ...(!requested
        ? {
            campaign: {
              name: campaign.name,
              description: campaign.description,
              pointTarget: campaign.pointTarget,
              disadvantageCap: campaign.disadvantageCap,
              quirkCap: campaign.quirkCap,
              manaLevel: campaign.manaLevel,
              houseRules: campaign.houseRules,
              techLevel: campaign.techLevel,
              skillPrerequisitePolicy: campaign.skillPrerequisitePolicy,
              enforceAttributeCaps: campaign.enforceAttributeCaps,
            },
          }
        : {}),
      ...exported,
    });
    return c.body(yamlText, 200, {
      'content-type': 'application/yaml; charset=utf-8',
      'content-disposition': `attachment; filename="${slugify(campaign.name)}-${requested ? 'sourcebooks' : 'library'}.yaml"`,
    });
  },
);

// ===================== YAML IMPORT =====================

const importBody = z.object({
  yaml: z
    .string()
    .min(1)
    .max(20 * 1024 * 1024),
  mode: importMode.default('merge'),
  sourceKeys: z.array(z.string().min(1).max(160)).min(1).max(30).optional(),
  /** Opt-in: apply the doc's `campaign` block (description/pointTarget/
   * disadvantageCap/quirkCap/manaLevel/techLevel/enforceAttributeCaps) to the campaigns row. Never
   * touches `name`.  Default off so a routine content import can't
   * silently rewrite campaign settings. */
  applyCampaignSettings: z.boolean().default(false),
});

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/library/import',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Import a library YAML document (owner only)',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: importBody } } },
    },
    responses: {
      200: {
        description: 'Per-section counts of created / updated / deleted rows',
        content: { 'application/json': { schema: importResult } },
      },
      400: errorResponse('Invalid YAML'),
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { yaml, mode, applyCampaignSettings, sourceKeys } = c.req.valid('json');
    await requireCampaignOwner(id, user.id);

    let doc: ReturnType<typeof parseLibraryYaml>;
    try {
      doc = parseLibraryYaml(yaml);
    } catch (err) {
      if (err instanceof LibraryYamlError) {
        throw new HTTPException(400, { message: err.message });
      }
      throw err;
    }
    const scopedKeys = doc.scope?.sourceKeys ?? sourceKeys;
    if (
      doc.scope &&
      sourceKeys &&
      (sourceKeys.length !== doc.scope.sourceKeys.length ||
        sourceKeys.some(
          (key) =>
            !doc.scope?.sourceKeys.some(
              (candidate) => canonicalLibraryKey(candidate) === canonicalLibraryKey(key),
            ),
        ))
    )
      throw new HTTPException(400, { message: 'Selected sourcebooks do not match the file scope' });
    if (scopedKeys && applyCampaignSettings)
      throw new HTTPException(400, {
        message: 'Sourcebook imports cannot apply campaign settings',
      });
    let incoming = doc.library;
    if (scopedKeys) {
      try {
        incoming = sourceScopedLibrary(doc.library, scopedKeys);
      } catch (error) {
        throw new HTTPException(400, { message: (error as Error).message });
      }
    }

    // Re-validate the campaign block against the campaign settings
    // schema before touching anything: the YAML doc schema only checks
    // types (any int), while `campaignUpdate` carries the real bounds
    // (pointTarget/disadvantageCap 0..10000, quirkCap 0..50) that the
    // campaign PATCH route enforces -- an import must not be a side
    // door around them.  Failing here (before the transaction) rejects
    // the whole import, matching the "invalid document" contract.
    let campaignSettings: Record<string, unknown> | null = null;
    if (applyCampaignSettings && doc.campaign) {
      const {
        description,
        pointTarget,
        disadvantageCap,
        quirkCap,
        manaLevel,
        techLevel,
        skillPrerequisitePolicy,
        houseRules,
        enforceAttributeCaps,
      } = doc.campaign;
      const checked = campaignUpdate.safeParse({
        description,
        pointTarget,
        disadvantageCap,
        quirkCap,
        manaLevel,
        techLevel,
        skillPrerequisitePolicy,
        houseRules,
        enforceAttributeCaps,
      });
      if (!checked.success) {
        throw new HTTPException(400, {
          message: `campaign settings failed validation: ${checked.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('; ')}`,
        });
      }
      campaignSettings = {
        ...checked.data,
        ...(checked.data.houseRules === undefined
          ? {}
          : {
              houseRules: applyHouseRuleSet(
                checked.data.houseRules,
                checked.data.houseRules.ruleSet,
              ),
            }),
      };
    }

    const result = await withAudit(user.id, undefined, async (tx) => {
      await tx
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .for('update');
      const currentGraph = await loadLibraryGraph(tx, id);
      await advanceLibraryCampaignRevision(tx, id);
      // Books receive database UUIDs first. Any later translation/graph failure
      // rolls these writes back together with the entire audited import.
      let bookImport: Awaited<ReturnType<typeof importSourcebooks>>;
      try {
        bookImport = await importSourcebooks(tx, id, incoming.sources);
      } catch (error) {
        throw new HTTPException(400, { message: (error as Error).message });
      }
      const sources = bookImport.counts;
      const books = await selectLibrarySection(tx, sourceEntity, id);
      let liveIncoming: LibraryGraph;
      try {
        liveIncoming = importSourceReferences(incoming, books, bookImport.aliases) as LibraryGraph;
      } catch (error) {
        throw new HTTPException(400, { message: (error as Error).message });
      }
      const scopedIds = scopedKeys
        ? (liveIncoming.sources ?? []).map((book) => book.id as string)
        : undefined;
      const scopedSet = scopedIds && new Set(scopedIds);
      const onlySelected = (row: { sourceId?: string | null }) =>
        !!row.sourceId && !!scopedSet?.has(row.sourceId);
      try {
        validateLibraryGraph(mergeLibraryGraph(currentGraph, liveIncoming, mode, scopedIds));
      } catch (error) {
        throw new HTTPException(400, { message: (error as Error).message });
      }
      const modifiers = await upsertByKey(
        tx,
        modifierEntity,
        id,
        liveIncoming.modifiers?.map((entry) => modifierEntity.createSchema.parse(entry)),
        mode,
        scopedSet ? onlySelected : undefined,
      );
      const traits = await upsertByKey(
        tx,
        traitEntity,
        id,
        liveIncoming.traits?.map((entry) => traitEntity.createSchema.parse(entry)),
        mode,
        scopedSet ? onlySelected : undefined,
      );
      const skills = await upsertByKey(
        tx,
        skillEntity,
        id,
        liveIncoming.skills?.map((entry) => skillEntity.createSchema.parse(entry)),
        mode,
        scopedSet ? onlySelected : undefined,
      );
      // Only prune spells when the document actually carried a spells
      // section: pre-spell-library exports omit it entirely, and a
      // replace-mode import of one of those files must not wipe the
      // current spell library.  An explicit `spells: []` still deletes.
      // (See upsertByKey's doc comment — this is generic behavior keyed
      // off `incoming === undefined`.)
      const spells = await upsertByKey(
        tx,
        spellEntity,
        id,
        liveIncoming.spells?.map((entry) => spellEntity.createSchema.parse(entry)),
        mode,
        scopedSet ? onlySelected : undefined,
      );
      const items = await upsertByKey(
        tx,
        itemEntity,
        id,
        liveIncoming.items?.map((entry) => itemEntity.createSchema.parse(entry)),
        mode,
        scopedSet ? onlySelected : undefined,
      );
      // Languages, like spells, are an optional YAML section: pre-v4
      // exports omit it entirely and a replace-mode import of one of
      // those files must not wipe the campaign's language library.
      const languages = await upsertByKey(
        tx,
        languageEntity,
        id,
        liveIncoming.languages?.map((entry) => languageEntity.createSchema.parse(entry)),
        mode,
        scopedSet ? onlySelected : undefined,
      );
      const techniques = await upsertByKey(
        tx,
        techniqueEntity,
        id,
        liveIncoming.techniques?.map((entry) => techniqueEntity.createSchema.parse(entry)),
        mode,
        scopedSet ? onlySelected : undefined,
      );
      const styles = await upsertByKey(
        tx,
        styleEntity,
        id,
        liveIncoming.styles?.map((entry) => styleEntity.createSchema.parse(entry)),
        mode,
        scopedSet ? onlySelected : undefined,
      );
      const enchantments = await upsertByKey(
        tx,
        enchantmentEntity,
        id,
        liveIncoming.enchantments?.map((entry) => enchantmentEntity.createSchema.parse(entry)),
        mode,
        scopedSet ? onlySelected : undefined,
      );

      const activeEffects = await upsertByKey(
        tx,
        activeEffectEntity,
        id,
        liveIncoming.activeEffects?.map((entry) => activeEffectEntity.createSchema.parse(entry)),
        mode,
        scopedSet ? onlySelected : undefined,
      );

      // Prune books only after their old contents have been pruned. The FK
      // must never force deletion of surviving links in a replace import.
      if (mode === 'replace' && !scopedKeys && incoming.sources !== undefined) {
        for (const book of books) {
          if (!bookImport.assigned.has(book.id)) {
            await tx.delete(campaignLibrarySources).where(eq(campaignLibrarySources.id, book.id));
            sources.deleted++;
          }
        }
      }

      // Opt-in campaign-settings apply (validated above): only fields
      // actually present in the doc get copied (undefined = leave
      // alone); `name` is never touched.  `campaignSettingsApplied`
      // reports whether anything actually changed (flag on, `campaign`
      // block present, and at least one recognized field in it).
      let campaignSettingsApplied = false;
      if (campaignSettings) {
        const patch = buildPatchSet(campaignSettings);
        if (Object.keys(patch).length > 1) {
          // more than just the always-present `updatedAt`
          await tx.update(campaigns).set(patch).where(eq(campaigns.id, id));
          campaignSettingsApplied = true;
        }
      }

      return {
        mode,
        sources,
        modifiers,
        editionDecisions: libraryEditionDecisions(currentGraph, liveIncoming),
        incomplete: Object.values(incoming)
          .flat()
          .filter((entry) => entry != null && !canAdoptLibraryEntry(entry)).length,
        traits,
        skills,
        spells,
        items,
        languages,
        techniques,
        styles,
        enchantments,
        activeEffects,
        campaignSettingsApplied,
      };
    });
    await publishLibraryInvalidation(id);
    return c.json(result, 200);
  },
);

export const campaignLibraryRouter = router;
