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
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, type sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  type LibraryItemCreate,
  type LibrarySkillCreate,
  type LibrarySpellCreate,
  type LibraryTraitCreate,
  importMode,
  importResult,
  libraryItemCreate,
  libraryItemOut,
  libraryItemUpdate,
  librarySkillCreate,
  librarySkillOut,
  librarySkillUpdate,
  librarySpellCreate,
  librarySpellOut,
  librarySpellUpdate,
  libraryTraitCreate,
  libraryTraitOut,
  libraryTraitUpdate,
} from '../../shared/schemas/campaignLibrary.ts';
import { uuid } from '../../shared/schemas/common.ts';
import { LibraryYamlError, emitLibraryYaml, parseLibraryYaml } from '../../shared/yaml/library.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { requireCampaignMember, requireCampaignOwner } from '../auth/permissions.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import {
  type DbCampaignLibraryItem,
  type DbCampaignLibrarySkill,
  type DbCampaignLibrarySpell,
  type DbCampaignLibraryTrait,
  campaignLibraryItems,
  campaignLibrarySkills,
  campaignLibrarySpells,
  campaignLibraryTraits,
} from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';

const router = createOpenApiApp();
router.use('/campaigns/*', requireActiveUser);

function traitToOut(row: DbCampaignLibraryTrait): z.infer<typeof libraryTraitOut> {
  return libraryTraitOut.parse({
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    kind: row.kind,
    basePoints: row.basePoints,
    description: row.description,
    source: row.source,
    availableModifiers: row.availableModifiers ?? [],
    tags: row.tags ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function skillToOut(row: DbCampaignLibrarySkill): z.infer<typeof librarySkillOut> {
  return librarySkillOut.parse({
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    attribute: row.attribute,
    difficulty: row.difficulty,
    techLevel: row.techLevel,
    description: row.description,
    source: row.source,
    defaultSpecialization: row.defaultSpecialization,
    prerequisites: row.prerequisites,
    situationalModifiers: row.situationalModifiers ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function spellToOut(row: DbCampaignLibrarySpell): z.infer<typeof librarySpellOut> {
  return librarySpellOut.parse({
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    college: row.college,
    difficulty: row.difficulty,
    baseEnergyCost: row.baseEnergyCost,
    maintenanceCost: row.maintenanceCost,
    castingTime: row.castingTime,
    duration: row.duration,
    prerequisites: row.prerequisites,
    description: row.description,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function itemToOut(row: DbCampaignLibraryItem): z.infer<typeof libraryItemOut> {
  return libraryItemOut.parse({
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    category: row.category,
    defaultQuantity: row.defaultQuantity,
    weightLbs: Number(row.weightLbs),
    cost: Number(row.cost),
    description: row.description,
    source: row.source,
    isArmor: row.isArmor,
    armor: row.armor ?? null,
    weaponData: row.weaponData ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

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
      db
        .select()
        .from(campaignLibraryTraits)
        .where(eq(campaignLibraryTraits.campaignId, id))
        .orderBy(asc(campaignLibraryTraits.kind), asc(campaignLibraryTraits.name)),
      db
        .select()
        .from(campaignLibrarySkills)
        .where(eq(campaignLibrarySkills.campaignId, id))
        .orderBy(asc(campaignLibrarySkills.name)),
      db
        .select()
        .from(campaignLibrarySpells)
        .where(eq(campaignLibrarySpells.campaignId, id))
        .orderBy(asc(campaignLibrarySpells.name)),
      db
        .select()
        .from(campaignLibraryItems)
        .where(eq(campaignLibraryItems.campaignId, id))
        .orderBy(asc(campaignLibraryItems.name)),
    ]);
    return c.json(
      {
        traits: traits.map(traitToOut),
        skills: skills.map(skillToOut),
        spells: spells.map(spellToOut),
        items: items.map(itemToOut),
      },
      200,
    );
  },
);

// ===================== TRAIT CRUD =====================

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/library/traits',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Add a library trait (owner only)',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: libraryTraitCreate } } },
    },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: libraryTraitOut } } },
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignOwner(id, user.id);
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [inserted] = await tx
        .insert(campaignLibraryTraits)
        .values({
          campaignId: id,
          name: body.name,
          kind: body.kind,
          basePoints: body.basePoints ?? 0,
          description: body.description ?? null,
          source: body.source ?? null,
          availableModifiers: body.availableModifiers ?? [],
          tags: body.tags ?? [],
        })
        .returning();
      if (!inserted) throw new HTTPException(500, { message: 'insert failed' });
      return inserted;
    });
    return c.json(traitToOut(row), 201);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/campaigns/{id}/library/traits/{traitId}',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Update a library trait (owner only)',
    request: {
      params: z.object({ id: uuid, traitId: uuid }),
      body: { required: true, content: { 'application/json': { schema: libraryTraitUpdate } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: libraryTraitOut } } },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, traitId } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignOwner(id, user.id);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k] = v;
    }
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [updated] = await tx
        .update(campaignLibraryTraits)
        .set(updates)
        .where(and(eq(campaignLibraryTraits.id, traitId), eq(campaignLibraryTraits.campaignId, id)))
        .returning();
      if (!updated) throw new HTTPException(404, { message: 'trait not found' });
      return updated;
    });
    return c.json(traitToOut(row), 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/campaigns/{id}/library/traits/{traitId}',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Delete a library trait (owner only)',
    request: { params: z.object({ id: uuid, traitId: uuid }) },
    responses: {
      204: { description: 'Deleted' },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, traitId } = c.req.valid('param');
    await requireCampaignOwner(id, user.id);
    const result = await withAudit(user.id, undefined, async (tx) => {
      return tx
        .delete(campaignLibraryTraits)
        .where(and(eq(campaignLibraryTraits.id, traitId), eq(campaignLibraryTraits.campaignId, id)))
        .returning({ id: campaignLibraryTraits.id });
    });
    if (result.length === 0) throw new HTTPException(404, { message: 'trait not found' });
    return c.body(null, 204);
  },
);

// ===================== SKILL CRUD =====================

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/library/skills',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Add a library skill (owner only)',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: librarySkillCreate } } },
    },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: librarySkillOut } } },
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignOwner(id, user.id);
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [inserted] = await tx
        .insert(campaignLibrarySkills)
        .values({
          campaignId: id,
          name: body.name,
          attribute: body.attribute,
          difficulty: body.difficulty,
          techLevel: body.techLevel ?? null,
          description: body.description ?? null,
          source: body.source ?? null,
          defaultSpecialization: body.defaultSpecialization ?? null,
          prerequisites: body.prerequisites ?? null,
          situationalModifiers: body.situationalModifiers ?? [],
        })
        .returning();
      if (!inserted) throw new HTTPException(500, { message: 'insert failed' });
      return inserted;
    });
    return c.json(skillToOut(row), 201);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/campaigns/{id}/library/skills/{skillId}',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Update a library skill (owner only)',
    request: {
      params: z.object({ id: uuid, skillId: uuid }),
      body: { required: true, content: { 'application/json': { schema: librarySkillUpdate } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: librarySkillOut } } },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, skillId } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignOwner(id, user.id);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k] = v;
    }
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [updated] = await tx
        .update(campaignLibrarySkills)
        .set(updates)
        .where(and(eq(campaignLibrarySkills.id, skillId), eq(campaignLibrarySkills.campaignId, id)))
        .returning();
      if (!updated) throw new HTTPException(404, { message: 'skill not found' });
      return updated;
    });
    return c.json(skillToOut(row), 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/campaigns/{id}/library/skills/{skillId}',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Delete a library skill (owner only)',
    request: { params: z.object({ id: uuid, skillId: uuid }) },
    responses: {
      204: { description: 'Deleted' },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, skillId } = c.req.valid('param');
    await requireCampaignOwner(id, user.id);
    const result = await withAudit(user.id, undefined, async (tx) => {
      return tx
        .delete(campaignLibrarySkills)
        .where(and(eq(campaignLibrarySkills.id, skillId), eq(campaignLibrarySkills.campaignId, id)))
        .returning({ id: campaignLibrarySkills.id });
    });
    if (result.length === 0) throw new HTTPException(404, { message: 'skill not found' });
    return c.body(null, 204);
  },
);

// ===================== SPELL CRUD =====================

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/library/spells',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Add a library spell (owner only)',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: librarySpellCreate } } },
    },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: librarySpellOut } } },
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignOwner(id, user.id);
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [inserted] = await tx
        .insert(campaignLibrarySpells)
        .values({
          campaignId: id,
          name: body.name,
          college: body.college ?? null,
          difficulty: body.difficulty ?? 'H',
          baseEnergyCost: body.baseEnergyCost ?? 1,
          maintenanceCost: body.maintenanceCost ?? null,
          castingTime: body.castingTime ?? null,
          duration: body.duration ?? null,
          prerequisites: body.prerequisites ?? null,
          description: body.description ?? null,
          source: body.source ?? null,
        })
        .returning();
      if (!inserted) throw new HTTPException(500, { message: 'insert failed' });
      return inserted;
    });
    return c.json(spellToOut(row), 201);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/campaigns/{id}/library/spells/{spellId}',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Update a library spell (owner only)',
    request: {
      params: z.object({ id: uuid, spellId: uuid }),
      body: { required: true, content: { 'application/json': { schema: librarySpellUpdate } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: librarySpellOut } } },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, spellId } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignOwner(id, user.id);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k] = v;
    }
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [updated] = await tx
        .update(campaignLibrarySpells)
        .set(updates)
        .where(and(eq(campaignLibrarySpells.id, spellId), eq(campaignLibrarySpells.campaignId, id)))
        .returning();
      if (!updated) throw new HTTPException(404, { message: 'spell not found' });
      return updated;
    });
    return c.json(spellToOut(row), 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/campaigns/{id}/library/spells/{spellId}',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Delete a library spell (owner only)',
    request: { params: z.object({ id: uuid, spellId: uuid }) },
    responses: {
      204: { description: 'Deleted' },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, spellId } = c.req.valid('param');
    await requireCampaignOwner(id, user.id);
    const result = await withAudit(user.id, undefined, async (tx) => {
      return tx
        .delete(campaignLibrarySpells)
        .where(and(eq(campaignLibrarySpells.id, spellId), eq(campaignLibrarySpells.campaignId, id)))
        .returning({ id: campaignLibrarySpells.id });
    });
    if (result.length === 0) throw new HTTPException(404, { message: 'spell not found' });
    return c.body(null, 204);
  },
);

// ===================== ITEM CRUD =====================

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/library/items',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Add a library item (owner only)',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: libraryItemCreate } } },
    },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: libraryItemOut } } },
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignOwner(id, user.id);
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [inserted] = await tx
        .insert(campaignLibraryItems)
        .values({
          campaignId: id,
          name: body.name,
          category: body.category ?? 'general',
          defaultQuantity: body.defaultQuantity ?? 1,
          weightLbs: String(body.weightLbs ?? 0),
          cost: String(body.cost ?? 0),
          description: body.description ?? null,
          source: body.source ?? null,
          isArmor: body.isArmor ?? false,
          armor: body.armor ?? null,
          weaponData: body.weaponData ?? null,
        })
        .returning();
      if (!inserted) throw new HTTPException(500, { message: 'insert failed' });
      return inserted;
    });
    return c.json(itemToOut(row), 201);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/campaigns/{id}/library/items/{itemId}',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Update a library item (owner only)',
    request: {
      params: z.object({ id: uuid, itemId: uuid }),
      body: { required: true, content: { 'application/json': { schema: libraryItemUpdate } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: libraryItemOut } } },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, itemId } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignOwner(id, user.id);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      if (k === 'weightLbs' || k === 'cost') {
        updates[k] = String(v);
        continue;
      }
      updates[k] = v;
    }
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [updated] = await tx
        .update(campaignLibraryItems)
        .set(updates)
        .where(and(eq(campaignLibraryItems.id, itemId), eq(campaignLibraryItems.campaignId, id)))
        .returning();
      if (!updated) throw new HTTPException(404, { message: 'item not found' });
      return updated;
    });
    return c.json(itemToOut(row), 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/campaigns/{id}/library/items/{itemId}',
    tags: ['campaigns'],
    security: [{ bearerAuth: [] }],
    summary: 'Delete a library item (owner only)',
    request: { params: z.object({ id: uuid, itemId: uuid }) },
    responses: {
      204: { description: 'Deleted' },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, itemId } = c.req.valid('param');
    await requireCampaignOwner(id, user.id);
    const result = await withAudit(user.id, undefined, async (tx) => {
      return tx
        .delete(campaignLibraryItems)
        .where(and(eq(campaignLibraryItems.id, itemId), eq(campaignLibraryItems.campaignId, id)))
        .returning({ id: campaignLibraryItems.id });
    });
    if (result.length === 0) throw new HTTPException(404, { message: 'item not found' });
    return c.body(null, 204);
  },
);

// ===================== YAML EXPORT =====================

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
      db.select().from(campaignLibraryTraits).where(eq(campaignLibraryTraits.campaignId, id)),
      db.select().from(campaignLibrarySkills).where(eq(campaignLibrarySkills.campaignId, id)),
      db.select().from(campaignLibrarySpells).where(eq(campaignLibrarySpells.campaignId, id)),
      db.select().from(campaignLibraryItems).where(eq(campaignLibraryItems.campaignId, id)),
    ]);
    const yamlText = emitLibraryYaml({
      campaign: {
        name: campaign.name,
        description: campaign.description ?? undefined,
        pointTarget: campaign.pointTarget ?? undefined,
        disadvantageCap: campaign.disadvantageCap ?? undefined,
        quirkCap: campaign.quirkCap ?? undefined,
      },
      traits: traits.map(
        (t): LibraryTraitCreate =>
          libraryTraitCreate.parse({
            name: t.name,
            kind: t.kind,
            basePoints: t.basePoints,
            description: t.description ?? undefined,
            source: t.source ?? undefined,
            availableModifiers: t.availableModifiers ?? [],
            tags: t.tags ?? [],
          }),
      ),
      skills: skills.map(
        (s): LibrarySkillCreate =>
          librarySkillCreate.parse({
            name: s.name,
            attribute: s.attribute,
            difficulty: s.difficulty,
            techLevel: s.techLevel ?? undefined,
            description: s.description ?? undefined,
            source: s.source ?? undefined,
            defaultSpecialization: s.defaultSpecialization ?? undefined,
            prerequisites: s.prerequisites ?? undefined,
            situationalModifiers: s.situationalModifiers ?? [],
          }),
      ),
      spells: spells.map(
        (s): LibrarySpellCreate =>
          librarySpellCreate.parse({
            name: s.name,
            college: s.college ?? undefined,
            difficulty: s.difficulty,
            baseEnergyCost: s.baseEnergyCost,
            maintenanceCost: s.maintenanceCost ?? undefined,
            castingTime: s.castingTime ?? undefined,
            duration: s.duration ?? undefined,
            prerequisites: s.prerequisites ?? undefined,
            description: s.description ?? undefined,
            source: s.source ?? undefined,
          }),
      ),
      items: items.map(
        (i): LibraryItemCreate =>
          libraryItemCreate.parse({
            name: i.name,
            category: i.category,
            defaultQuantity: i.defaultQuantity,
            weightLbs: Number(i.weightLbs),
            cost: Number(i.cost),
            description: i.description ?? undefined,
            source: i.source ?? undefined,
            isArmor: i.isArmor,
            armor: i.armor ?? undefined,
            weaponData: i.weaponData ?? undefined,
          }),
      ),
    });
    return c.body(yamlText, 200, {
      'content-type': 'application/yaml; charset=utf-8',
      'content-disposition': `attachment; filename="${slugify(campaign.name)}-library.yaml"`,
    });
  },
);

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'library'
  );
}

// ===================== YAML IMPORT =====================

const importBody = z.object({
  yaml: z
    .string()
    .min(1)
    .max(20 * 1024 * 1024),
  mode: importMode.default('merge'),
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
    const { yaml, mode } = c.req.valid('json');
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
      const traitCounts = { created: 0, updated: 0, deleted: 0 };
      const skillCounts = { created: 0, updated: 0, deleted: 0 };
      const spellCounts = { created: 0, updated: 0, deleted: 0 };
      const itemCounts = { created: 0, updated: 0, deleted: 0 };

      // -------- traits --------
      const existingTraits = await tx
        .select()
        .from(campaignLibraryTraits)
        .where(eq(campaignLibraryTraits.campaignId, id));
      const traitKey = (t: { name: string; kind: string }) => `${t.kind}::${t.name.toLowerCase()}`;
      const existingTraitMap = new Map(existingTraits.map((t) => [traitKey(t), t]));
      const incomingTraitKeys = new Set<string>();
      for (const t of doc.library.traits) {
        const k = traitKey(t);
        incomingTraitKeys.add(k);
        const existing = existingTraitMap.get(k);
        if (existing) {
          await tx
            .update(campaignLibraryTraits)
            .set({
              basePoints: t.basePoints ?? 0,
              description: t.description ?? null,
              source: t.source ?? null,
              availableModifiers: t.availableModifiers ?? [],
              tags: t.tags ?? [],
              updatedAt: new Date(),
            })
            .where(eq(campaignLibraryTraits.id, existing.id));
          traitCounts.updated++;
        } else {
          await tx.insert(campaignLibraryTraits).values({
            campaignId: id,
            name: t.name,
            kind: t.kind,
            basePoints: t.basePoints ?? 0,
            description: t.description ?? null,
            source: t.source ?? null,
            availableModifiers: t.availableModifiers ?? [],
            tags: t.tags ?? [],
          });
          traitCounts.created++;
        }
      }
      if (mode === 'replace') {
        for (const t of existingTraits) {
          if (!incomingTraitKeys.has(traitKey(t))) {
            await tx.delete(campaignLibraryTraits).where(eq(campaignLibraryTraits.id, t.id));
            traitCounts.deleted++;
          }
        }
      }

      // -------- skills --------
      const existingSkills = await tx
        .select()
        .from(campaignLibrarySkills)
        .where(eq(campaignLibrarySkills.campaignId, id));
      const skillKey = (s: { name: string }) => s.name.toLowerCase();
      const existingSkillMap = new Map(existingSkills.map((s) => [skillKey(s), s]));
      const incomingSkillKeys = new Set<string>();
      for (const s of doc.library.skills) {
        const k = skillKey(s);
        incomingSkillKeys.add(k);
        const existing = existingSkillMap.get(k);
        if (existing) {
          await tx
            .update(campaignLibrarySkills)
            .set({
              attribute: s.attribute,
              difficulty: s.difficulty,
              techLevel: s.techLevel ?? null,
              description: s.description ?? null,
              source: s.source ?? null,
              defaultSpecialization: s.defaultSpecialization ?? null,
              prerequisites: s.prerequisites ?? null,
              situationalModifiers: s.situationalModifiers ?? [],
              updatedAt: new Date(),
            })
            .where(eq(campaignLibrarySkills.id, existing.id));
          skillCounts.updated++;
        } else {
          await tx.insert(campaignLibrarySkills).values({
            campaignId: id,
            name: s.name,
            attribute: s.attribute,
            difficulty: s.difficulty,
            techLevel: s.techLevel ?? null,
            description: s.description ?? null,
            source: s.source ?? null,
            defaultSpecialization: s.defaultSpecialization ?? null,
            prerequisites: s.prerequisites ?? null,
            situationalModifiers: s.situationalModifiers ?? [],
          });
          skillCounts.created++;
        }
      }
      if (mode === 'replace') {
        for (const s of existingSkills) {
          if (!incomingSkillKeys.has(skillKey(s))) {
            await tx.delete(campaignLibrarySkills).where(eq(campaignLibrarySkills.id, s.id));
            skillCounts.deleted++;
          }
        }
      }

      // -------- spells --------
      const existingSpells = await tx
        .select()
        .from(campaignLibrarySpells)
        .where(eq(campaignLibrarySpells.campaignId, id));
      const spellKey = (s: { name: string }) => s.name.toLowerCase();
      const existingSpellMap = new Map(existingSpells.map((s) => [spellKey(s), s]));
      const incomingSpellKeys = new Set<string>();
      for (const s of doc.library.spells) {
        const k = spellKey(s);
        incomingSpellKeys.add(k);
        const existing = existingSpellMap.get(k);
        if (existing) {
          await tx
            .update(campaignLibrarySpells)
            .set({
              college: s.college ?? null,
              difficulty: s.difficulty ?? 'H',
              baseEnergyCost: s.baseEnergyCost ?? 1,
              maintenanceCost: s.maintenanceCost ?? null,
              castingTime: s.castingTime ?? null,
              duration: s.duration ?? null,
              prerequisites: s.prerequisites ?? null,
              description: s.description ?? null,
              source: s.source ?? null,
              updatedAt: new Date(),
            })
            .where(eq(campaignLibrarySpells.id, existing.id));
          spellCounts.updated++;
        } else {
          await tx.insert(campaignLibrarySpells).values({
            campaignId: id,
            name: s.name,
            college: s.college ?? null,
            difficulty: s.difficulty ?? 'H',
            baseEnergyCost: s.baseEnergyCost ?? 1,
            maintenanceCost: s.maintenanceCost ?? null,
            castingTime: s.castingTime ?? null,
            duration: s.duration ?? null,
            prerequisites: s.prerequisites ?? null,
            description: s.description ?? null,
            source: s.source ?? null,
          });
          spellCounts.created++;
        }
      }
      if (mode === 'replace') {
        for (const s of existingSpells) {
          if (!incomingSpellKeys.has(spellKey(s))) {
            await tx.delete(campaignLibrarySpells).where(eq(campaignLibrarySpells.id, s.id));
            spellCounts.deleted++;
          }
        }
      }

      // -------- items --------
      const existingItems = await tx
        .select()
        .from(campaignLibraryItems)
        .where(eq(campaignLibraryItems.campaignId, id));
      const itemKey = (i: { name: string }) => i.name.toLowerCase();
      const existingItemMap = new Map(existingItems.map((i) => [itemKey(i), i]));
      const incomingItemKeys = new Set<string>();
      for (const i of doc.library.items) {
        const k = itemKey(i);
        incomingItemKeys.add(k);
        const existing = existingItemMap.get(k);
        if (existing) {
          await tx
            .update(campaignLibraryItems)
            .set({
              category: i.category ?? 'general',
              defaultQuantity: i.defaultQuantity ?? 1,
              weightLbs: String(i.weightLbs ?? 0),
              cost: String(i.cost ?? 0),
              description: i.description ?? null,
              source: i.source ?? null,
              isArmor: i.isArmor ?? false,
              armor: i.armor ?? null,
              weaponData: i.weaponData ?? null,
              updatedAt: new Date(),
            })
            .where(eq(campaignLibraryItems.id, existing.id));
          itemCounts.updated++;
        } else {
          await tx.insert(campaignLibraryItems).values({
            campaignId: id,
            name: i.name,
            category: i.category ?? 'general',
            defaultQuantity: i.defaultQuantity ?? 1,
            weightLbs: String(i.weightLbs ?? 0),
            cost: String(i.cost ?? 0),
            description: i.description ?? null,
            source: i.source ?? null,
            isArmor: i.isArmor ?? false,
            armor: i.armor ?? null,
            weaponData: i.weaponData ?? null,
          });
          itemCounts.created++;
        }
      }
      if (mode === 'replace') {
        for (const i of existingItems) {
          if (!incomingItemKeys.has(itemKey(i))) {
            await tx.delete(campaignLibraryItems).where(eq(campaignLibraryItems.id, i.id));
            itemCounts.deleted++;
          }
        }
      }

      return {
        mode,
        traits: traitCounts,
        skills: skillCounts,
        spells: spellCounts,
        items: itemCounts,
      };
    });
    return c.json(result, 200);
  },
);

// Touch the unused sql tag so biome doesn't complain when this file
// imports it for potential future use.
export const _internalLibrarySql: typeof sql | undefined = undefined;
export const campaignLibraryRouter = router;
