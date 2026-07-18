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
import {
  importMode,
  importResult,
  libraryItemOut,
  librarySkillOut,
  librarySpellOut,
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
import { buildPatchSet } from '../services/patchSet.ts';
import { registerLibraryCrud, selectLibrarySection, upsertByKey } from './campaignLibraryCrud.ts';
import { itemEntity, skillEntity, spellEntity, traitEntity } from './campaignLibraryEntities.ts';

const router = createOpenApiApp();
router.use('/campaigns/*', requireActiveUser);

// ===================== LIST =====================

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns/{id}/library',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Get the campaign library (member or owner)',
    request: { params: z.object({ id: uuid }) },
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
    await requireCampaignMember(id, user.id);
    const db = getDb();
    const [traits, skills, spells, items] = await Promise.all([
      selectLibrarySection(db, traitEntity, id),
      selectLibrarySection(db, skillEntity, id),
      selectLibrarySection(db, spellEntity, id),
      selectLibrarySection(db, itemEntity, id),
    ]);
    return c.json(
      {
        traits: traits.map(traitEntity.toOut),
        skills: skills.map(skillEntity.toOut),
        spells: spells.map(spellEntity.toOut),
        items: items.map(itemEntity.toOut),
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
    const { campaign } = await requireCampaignMember(id, user.id);
    const db = getDb();
    const [traits, skills, spells, items] = await Promise.all([
      selectLibrarySection(db, traitEntity, id),
      selectLibrarySection(db, skillEntity, id),
      selectLibrarySection(db, spellEntity, id),
      selectLibrarySection(db, itemEntity, id),
    ]);
    const yamlText = emitLibraryYaml({
      campaign: {
        name: campaign.name,
        description: campaign.description ?? undefined,
        pointTarget: campaign.pointTarget ?? undefined,
        disadvantageCap: campaign.disadvantageCap ?? undefined,
        quirkCap: campaign.quirkCap ?? undefined,
        manaLevel: campaign.manaLevel,
      },
      traits: traits.map(traitEntity.rowToCreate),
      skills: skills.map(skillEntity.rowToCreate),
      spells: spells.map(spellEntity.rowToCreate),
      items: items.map(itemEntity.rowToCreate),
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
   * disadvantageCap/quirkCap/manaLevel) to the campaigns row.  Never
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

    const result = await withAudit(user.id, undefined, async (tx) => {
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

      // Opt-in campaign-settings apply: only fields actually present in
      // the doc get copied (undefined = leave alone); `name` is never
      // touched.  `campaignSettingsApplied` reports whether anything
      // actually changed (flag on, `campaign` block present, and at
      // least one recognized field in it).
      let campaignSettingsApplied = false;
      if (applyCampaignSettings && doc.campaign) {
        const { description, pointTarget, disadvantageCap, quirkCap, manaLevel } = doc.campaign;
        const patch = buildPatchSet({
          description,
          pointTarget,
          disadvantageCap,
          quirkCap,
          manaLevel,
        });
        if (Object.keys(patch).length > 1) {
          // more than just the always-present `updatedAt`
          await tx.update(campaigns).set(patch).where(eq(campaigns.id, id));
          campaignSettingsApplied = true;
        }
      }

      return { mode, traits, skills, spells, items, campaignSettingsApplied };
    });
    return c.json(result, 200);
  },
);

// Touch the unused sql tag so biome doesn't complain when this file
// imports it for potential future use.
export const _internalLibrarySql: typeof sql | undefined = undefined;
export const campaignLibraryRouter = router;
