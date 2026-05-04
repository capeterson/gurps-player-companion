/**
 * Sub-resource CRUD for a character: traits, skills, inventory, combat.
 *
 * All routes require an authenticated user; reads need character access
 * (owner or campaign member), writes need the owner.  Each mutating
 * endpoint also returns the freshly-recomputed `characterDetail` so the
 * client can refresh derived stats and warnings in a single round-trip.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { computeDerived } from '../../shared/domain/characterCalc.ts';
import { computeWeights } from '../../shared/domain/encumbrance.ts';
import { characterDetail } from '../../shared/schemas/character.ts';
import { combatStateOut, combatStateUpdate } from '../../shared/schemas/combat.ts';
import { uuid } from '../../shared/schemas/common.ts';
import {
  inventoryItemCreate,
  inventoryItemOut,
  inventoryItemUpdate,
} from '../../shared/schemas/inventory.ts';
import { skillCreate, skillOut, skillUpdate } from '../../shared/schemas/skill.ts';
import { traitCreate, traitOut, traitUpdate } from '../../shared/schemas/trait.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { assertWrite, loadCharacterOr403 } from '../auth/permissions.ts';
import { getDb } from '../db/client.ts';
import {
  characterSkills,
  characterTraits,
  characters,
  combatStates,
  inventoryItems,
} from '../db/schema.ts';
import { campaigns as campaignsTable } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import {
  buildCharacterDetail,
  buildCombatStateOut,
  buildInventoryItemOut,
  buildSkillOut,
  buildTraitOut,
  characterAttrsFromRow,
} from '../services/characterSummary.ts';

const router = createOpenApiApp();
router.use('/characters/*', requireActiveUser);

async function refreshDetail(characterId: string) {
  const db = getDb();
  const [c] = await db.select().from(characters).where(eq(characters.id, characterId));
  if (!c) throw new HTTPException(404, { message: 'character not found' });
  const [traits, skills, inventory, combat, campaign] = await Promise.all([
    db
      .select()
      .from(characterTraits)
      .where(eq(characterTraits.characterId, characterId))
      .orderBy(asc(characterTraits.kind), asc(characterTraits.name)),
    db
      .select()
      .from(characterSkills)
      .where(eq(characterSkills.characterId, characterId))
      .orderBy(asc(characterSkills.name)),
    db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.characterId, characterId))
      .orderBy(asc(inventoryItems.name)),
    db
      .select()
      .from(combatStates)
      .where(eq(combatStates.characterId, characterId))
      .then((r) => r[0] ?? null),
    c.campaignId
      ? db
          .select()
          .from(campaignsTable)
          .where(eq(campaignsTable.id, c.campaignId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  return buildCharacterDetail({ character: c, traits, skills, inventory, combat, campaign });
}

// ===================== TRAITS =====================

router.openapi(
  createRoute({
    method: 'post',
    path: '/characters/{id}/traits',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Add a trait to a character (owner only)',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: traitCreate } } },
    },
    responses: {
      201: {
        description: 'Trait created — response includes the refreshed character',
        content: {
          'application/json': {
            schema: z.object({ trait: traitOut, character: characterDetail }),
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
    const body = c.req.valid('json');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const db = getDb();
    const [created] = await db
      .insert(characterTraits)
      .values({
        characterId: id,
        kind: body.kind,
        name: body.name,
        points: body.points ?? 0,
        level: body.level ?? null,
        notes: body.notes ?? null,
        modifiers: body.modifiers ?? [],
        libraryTraitId: body.libraryTraitId ?? null,
      })
      .returning();
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    return c.json({ trait: buildTraitOut(created), character: await refreshDetail(id) }, 201);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/characters/{id}/traits/{traitId}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Update a trait (owner only)',
    request: {
      params: z.object({ id: uuid, traitId: uuid }),
      body: { required: true, content: { 'application/json': { schema: traitUpdate } } },
    },
    responses: {
      200: {
        description: 'Updated trait + refreshed character',
        content: {
          'application/json': {
            schema: z.object({ trait: traitOut, character: characterDetail }),
          },
        },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, traitId } = c.req.valid('param');
    const body = c.req.valid('json');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const db = getDb();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k] = v;
    }
    const [updated] = await db
      .update(characterTraits)
      .set(updates)
      .where(and(eq(characterTraits.id, traitId), eq(characterTraits.characterId, id)))
      .returning();
    if (!updated) throw new HTTPException(404, { message: 'trait not found' });
    return c.json({ trait: buildTraitOut(updated), character: await refreshDetail(id) }, 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/characters/{id}/traits/{traitId}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Delete a trait (owner only)',
    request: { params: z.object({ id: uuid, traitId: uuid }) },
    responses: {
      200: {
        description: 'Refreshed character (after deletion)',
        content: { 'application/json': { schema: characterDetail } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, traitId } = c.req.valid('param');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const result = await getDb()
      .delete(characterTraits)
      .where(and(eq(characterTraits.id, traitId), eq(characterTraits.characterId, id)))
      .returning({ id: characterTraits.id });
    if (result.length === 0) throw new HTTPException(404, { message: 'trait not found' });
    return c.json(await refreshDetail(id), 200);
  },
);

// ===================== SKILLS =====================

router.openapi(
  createRoute({
    method: 'post',
    path: '/characters/{id}/skills',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Add a skill to a character (owner only)',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: skillCreate } } },
    },
    responses: {
      201: {
        description: 'Skill created — response includes the refreshed character',
        content: {
          'application/json': {
            schema: z.object({ skill: skillOut, character: characterDetail }),
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
    const body = c.req.valid('json');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const db = getDb();
    const [created] = await db
      .insert(characterSkills)
      .values({
        characterId: id,
        name: body.name,
        attribute: body.attribute,
        difficulty: body.difficulty,
        points: body.points ?? 1,
        techLevel: body.techLevel ?? null,
        specialization: body.specialization ?? null,
        notes: body.notes ?? null,
        librarySkillId: body.librarySkillId ?? null,
      })
      .returning();
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    const derived = computeDerived(characterAttrsFromRow(access.character));
    return c.json(
      { skill: buildSkillOut(created, derived), character: await refreshDetail(id) },
      201,
    );
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/characters/{id}/skills/{skillId}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Update a skill (owner only)',
    request: {
      params: z.object({ id: uuid, skillId: uuid }),
      body: { required: true, content: { 'application/json': { schema: skillUpdate } } },
    },
    responses: {
      200: {
        description: 'Updated skill + refreshed character',
        content: {
          'application/json': {
            schema: z.object({ skill: skillOut, character: characterDetail }),
          },
        },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, skillId } = c.req.valid('param');
    const body = c.req.valid('json');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const db = getDb();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k] = v;
    }
    const [updated] = await db
      .update(characterSkills)
      .set(updates)
      .where(and(eq(characterSkills.id, skillId), eq(characterSkills.characterId, id)))
      .returning();
    if (!updated) throw new HTTPException(404, { message: 'skill not found' });
    const derived = computeDerived(characterAttrsFromRow(access.character));
    return c.json(
      { skill: buildSkillOut(updated, derived), character: await refreshDetail(id) },
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/characters/{id}/skills/{skillId}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Delete a skill (owner only)',
    request: { params: z.object({ id: uuid, skillId: uuid }) },
    responses: {
      200: {
        description: 'Refreshed character (after deletion)',
        content: { 'application/json': { schema: characterDetail } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, skillId } = c.req.valid('param');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const result = await getDb()
      .delete(characterSkills)
      .where(and(eq(characterSkills.id, skillId), eq(characterSkills.characterId, id)))
      .returning({ id: characterSkills.id });
    if (result.length === 0) throw new HTTPException(404, { message: 'skill not found' });
    return c.json(await refreshDetail(id), 200);
  },
);

// ===================== INVENTORY =====================

/**
 * Reject a `parentId` that doesn't belong to this character.  Without
 * this check a write could create cross-character parent links and
 * later mutations on the parent would touch the other character's tree.
 */
async function assertParentBelongsToCharacter(
  parentId: string,
  characterId: string,
): Promise<void> {
  const db = getDb();
  const [parent] = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, parentId), eq(inventoryItems.characterId, characterId)));
  if (!parent) {
    throw new HTTPException(400, { message: 'parentId must reference an item on this character' });
  }
}

router.openapi(
  createRoute({
    method: 'post',
    path: '/characters/{id}/inventory',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Add an inventory item (owner only)',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: inventoryItemCreate } } },
    },
    responses: {
      201: {
        description: 'Item created — response includes the refreshed character',
        content: {
          'application/json': {
            schema: z.object({ item: inventoryItemOut, character: characterDetail }),
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
    const body = c.req.valid('json');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    if (body.parentId) await assertParentBelongsToCharacter(body.parentId, id);
    const db = getDb();
    const [created] = await db
      .insert(inventoryItems)
      .values({
        characterId: id,
        name: body.name,
        quantity: body.quantity ?? 1,
        weightLbs: String(body.weightLbs ?? 0),
        cost: String(body.cost ?? 0),
        notes: body.notes ?? null,
        parentId: body.parentId ?? null,
        externalLocation: body.externalLocation ?? null,
        worn: body.worn ?? false,
        equipped: body.equipped ?? false,
        isContainer: body.isContainer ?? false,
        hideawayCapacityLbs: String(body.hideawayCapacityLbs ?? 0),
        weightReductionPercent: body.weightReductionPercent ?? 0,
        isArmor: body.isArmor ?? false,
        armor: body.armor ?? null,
        weaponData: body.weaponData ?? null,
        libraryItemId: body.libraryItemId ?? null,
      })
      .returning();
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    const allItems = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.characterId, id));
    const weights = computeWeights(
      allItems.map((i) => ({
        id: i.id,
        parentId: i.parentId,
        weightLbs: Number(i.weightLbs),
        quantity: i.quantity,
        worn: i.worn,
        isContainer: i.isContainer,
        hideawayCapacityLbs: Number(i.hideawayCapacityLbs),
        weightReductionPercent: i.weightReductionPercent,
      })),
    );
    return c.json(
      {
        item: buildInventoryItemOut(created, weights.perItem),
        character: await refreshDetail(id),
      },
      201,
    );
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/characters/{id}/inventory/{itemId}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Update an inventory item (owner only)',
    request: {
      params: z.object({ id: uuid, itemId: uuid }),
      body: { required: true, content: { 'application/json': { schema: inventoryItemUpdate } } },
    },
    responses: {
      200: {
        description: 'Updated item + refreshed character',
        content: {
          'application/json': {
            schema: z.object({ item: inventoryItemOut, character: characterDetail }),
          },
        },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, itemId } = c.req.valid('param');
    const body = c.req.valid('json');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === itemId) {
        throw new HTTPException(400, { message: 'an item cannot be its own parent' });
      }
      await assertParentBelongsToCharacter(body.parentId, id);
    }
    const db = getDb();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      // numeric columns expect strings (drizzle decimal).
      if (k === 'weightLbs' || k === 'cost' || k === 'hideawayCapacityLbs') {
        updates[k] = String(v);
        continue;
      }
      updates[k] = v;
    }
    const [updated] = await db
      .update(inventoryItems)
      .set(updates)
      .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.characterId, id)))
      .returning();
    if (!updated) throw new HTTPException(404, { message: 'item not found' });
    const allItems = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.characterId, id));
    const weights = computeWeights(
      allItems.map((i) => ({
        id: i.id,
        parentId: i.parentId,
        weightLbs: Number(i.weightLbs),
        quantity: i.quantity,
        worn: i.worn,
        isContainer: i.isContainer,
        hideawayCapacityLbs: Number(i.hideawayCapacityLbs),
        weightReductionPercent: i.weightReductionPercent,
      })),
    );
    return c.json(
      {
        item: buildInventoryItemOut(updated, weights.perItem),
        character: await refreshDetail(id),
      },
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/characters/{id}/inventory/{itemId}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Delete an inventory item (owner only). Children are reparented to the item parent.',
    request: { params: z.object({ id: uuid, itemId: uuid }) },
    responses: {
      200: {
        description: 'Refreshed character (after deletion)',
        content: { 'application/json': { schema: characterDetail } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, itemId } = c.req.valid('param');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const db = getDb();
    const [doomed] = await db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.characterId, id)));
    if (!doomed) throw new HTTPException(404, { message: 'item not found' });
    // Reparent children up one level so we don't strand them.  Always
    // scope to this character's items: even though create/patch validate
    // `parentId`, defence in depth means a stray cross-character link
    // (e.g. from an older record) can't pull a sibling character's row
    // along on delete.
    await db
      .update(inventoryItems)
      .set({ parentId: doomed.parentId, updatedAt: new Date() })
      .where(and(eq(inventoryItems.parentId, itemId), eq(inventoryItems.characterId, id)));
    await db
      .delete(inventoryItems)
      .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.characterId, id)));
    return c.json(await refreshDetail(id), 200);
  },
);

// ===================== COMBAT STATE =====================

/**
 * Combat state is one-per-character. PATCH upserts: missing rows are
 * created with sensible defaults derived from the character's current
 * derived stats (HP / FP), then patched with the provided fields.
 */
router.openapi(
  createRoute({
    method: 'patch',
    path: '/characters/{id}/combat',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Patch the combat state (owner only). Upserts on first call.',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: combatStateUpdate } } },
    },
    responses: {
      200: {
        description: 'Updated combat state + refreshed character',
        content: {
          'application/json': {
            schema: z.object({ combat: combatStateOut, character: characterDetail }),
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
    const body = c.req.valid('json');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const db = getDb();

    // Atomic upsert keyed on the unique (character_id) index. Doing this
    // as a single statement is essential: the previous select-then-insert
    // sequence let two parallel first-time edits both observe `!existing`
    // and then collide on the unique constraint, rolling one save back.
    const derived = computeDerived(characterAttrsFromRow(access.character));
    const setOnUpdate: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      setOnUpdate[k] = v;
    }
    const [row] = await db
      .insert(combatStates)
      .values({
        characterId: id,
        currentHp: body.currentHp ?? derived.hp,
        currentFp: body.currentFp ?? derived.fp,
        conditions: body.conditions ?? [],
        maneuver: body.maneuver ?? null,
        posture: body.posture ?? 'standing',
      })
      .onConflictDoUpdate({
        target: combatStates.characterId,
        set: setOnUpdate,
      })
      .returning();
    if (!row) throw new HTTPException(500, { message: 'combat upsert failed' });
    return c.json({ combat: buildCombatStateOut(row), character: await refreshDetail(id) }, 200);
  },
);

export const characterSubResourcesRouter = router;
