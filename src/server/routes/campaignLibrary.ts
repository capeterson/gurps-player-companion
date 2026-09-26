import { activeEffectDefinitionOut } from '../../shared/schemas/activeEffects.ts';
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
import { eq, type sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { applyHouseRuleSet } from '../../shared/domain/campaignRules.ts';
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
import { LibraryYamlError, emitLibraryYaml, parseLibraryYaml } from '../../shared/yaml/library.ts';
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
    await requireCampaignMember(id, user.id);
    const db = getDb();
    const includes = (candidate: string) => section === undefined || section === candidate;
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
        traits: narrowLibraryRows(traits.map(traitEntity.toOut), search, limit, offset),
        skills: narrowLibraryRows(skills.map(skillEntity.toOut), search, limit, offset),
        spells: narrowLibraryRows(spells.map(spellEntity.toOut), search, limit, offset),
        items: narrowLibraryRows(items.map(itemEntity.toOut), search, limit, offset),
        languages: narrowLibraryRows(languages.map(languageEntity.toOut), search, limit, offset),
        techniques: narrowLibraryRows(techniques.map(techniqueEntity.toOut), search, limit, offset),
        styles: narrowLibraryRows(styles.map(styleEntity.toOut), search, limit, offset),
        enchantments: narrowLibraryRows(
          enchantments.map(enchantmentEntity.toOut),
          search,
          limit,
          offset,
        ),
        activeEffects: narrowLibraryRows(
          activeEffects.map(activeEffectEntity.toOut),
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
    request: { params: z.object({ id: uuid }) },
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
    const db = getDb();
    const snapshot = await db.transaction(
      async (tx) => {
        const { campaign } = await requireCampaignMember(id, user.id, tx);
        // A node-postgres transaction owns one connection; keep its statements
        // sequential while REPEATABLE READ supplies the cross-section snapshot.
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
    const yamlText = emitLibraryYaml({
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
      traits: traits.map(traitEntity.rowToCreate),
      skills: skills.map(skillEntity.rowToCreate),
      spells: spells.map(spellEntity.rowToCreate),
      items: items.map(itemEntity.rowToCreate),
      languages: languages.map(languageEntity.rowToCreate),
      techniques: techniques.map(techniqueEntity.rowToCreate),
      styles: styles.map(styleEntity.rowToCreate),
      enchantments: enchantments.map(enchantmentEntity.rowToCreate),
      activeEffects: activeEffects.map(activeEffectEntity.rowToCreate),
    });
    return c.body(yamlText, 200, {
      'content-type': 'application/yaml; charset=utf-8',
      'content-disposition': `attachment; filename="${slugify(campaign.name)}-library.yaml"`,
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
    const { yaml, mode, applyCampaignSettings } = c.req.valid('json');
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
      await advanceLibraryCampaignRevision(tx, id);
      const traits = await upsertByKey(tx, traitEntity, id, doc.library.traits, mode);
      const skills = await upsertByKey(tx, skillEntity, id, doc.library.skills, mode);
      // Only prune spells when the document actually carried a spells
      // section: pre-spell-library exports omit it entirely, and a
      // replace-mode import of one of those files must not wipe the
      // current spell library.  An explicit `spells: []` still deletes.
      // (See upsertByKey's doc comment — this is generic behavior keyed
      // off `incoming === undefined`.)
      const spells = await upsertByKey(tx, spellEntity, id, doc.library.spells, mode);
      const items = await upsertByKey(tx, itemEntity, id, doc.library.items, mode);
      // Languages, like spells, are an optional YAML section: pre-v4
      // exports omit it entirely and a replace-mode import of one of
      // those files must not wipe the campaign's language library.
      const languages = await upsertByKey(tx, languageEntity, id, doc.library.languages, mode);
      const techniques = await upsertByKey(tx, techniqueEntity, id, doc.library.techniques, mode);
      const styles = await upsertByKey(tx, styleEntity, id, doc.library.styles, mode);
      const enchantments = await upsertByKey(
        tx,
        enchantmentEntity,
        id,
        doc.library.enchantments,
        mode,
      );

      const activeEffects = await upsertByKey(
        tx,
        activeEffectEntity,
        id,
        doc.library.activeEffects,
        mode,
      );

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

// Touch the unused sql tag so biome doesn't complain when this file
// imports it for potential future use.
export const _internalLibrarySql: typeof sql | undefined = undefined;
export const campaignLibraryRouter = router;
