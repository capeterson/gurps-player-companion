/**
 * Sub-resource CRUD for a character: traits, skills, inventory, combat.
 *
 * All routes require an authenticated user; reads need character access
 * (owner or campaign member), writes need the owner.  Each mutating
 * endpoint also returns the freshly-recomputed `characterDetail` so the
 * client can refresh derived stats and warnings in a single round-trip.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { ManaLevel } from '../../shared/constants/magic.ts';
import { computeDerived } from '../../shared/domain/characterCalc.ts';
import { computeWeights } from '../../shared/domain/encumbrance.ts';
import { mageryLevel } from '../../shared/domain/spellCalc.ts';
import { characterDetail } from '../../shared/schemas/character.ts';
import { combatStateOut, combatStateUpdate } from '../../shared/schemas/combat.ts';
import { uuid } from '../../shared/schemas/common.ts';
import {
  inventoryItemCreate,
  inventoryItemOut,
  inventoryItemUpdate,
} from '../../shared/schemas/inventory.ts';
import { skillCreate, skillOut, skillUpdate } from '../../shared/schemas/skill.ts';
import { spellCreate, spellOut, spellUpdate } from '../../shared/schemas/spell.ts';
import { traitCreate, traitOut, traitUpdate } from '../../shared/schemas/trait.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { assertWrite, loadCharacterOr403 } from '../auth/permissions.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import {
  characterSkills,
  characterSpells,
  characterTraits,
  characters,
  combatStates,
  inventoryItems,
} from '../db/schema.ts';
import { campaigns as campaignsTable } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import {
  buildCombatStateOut,
  buildInventoryItemOut,
  buildSkillOut,
  buildSpellOut,
  buildTraitOut,
  characterAttrsFromRow,
  loadCharacterDetail,
} from '../services/characterSummary.ts';
import {
  combatUpsertValues,
  inventoryInsertValues,
  skillInsertValues,
  spellInsertValues,
  traitInsertValues,
} from '../services/entityWrites.ts';
import { buildPatchSet } from '../services/patchSet.ts';

const router = createOpenApiApp();
router.use('/characters/*', requireActiveUser);

/**
 * Ambient mana for a character's campaign; campaignless = normal.
 *
 * This is a lighter-weight, standalone query rather than reading
 * `manaLevel` off a `loadCharacterDetail` result: both spell handlers
 * that call it need the mana level *before* the post-write detail
 * refresh happens (they build the `spellOut` response from it, then
 * separately call `loadCharacterDetail` afterward to pick up the
 * just-created/updated spell). Reusing the detail load here would mean
 * loading it twice anyway, so there's nothing to consolidate.
 */
async function manaLevelFor(campaignId: string | null): Promise<ManaLevel> {
  if (!campaignId) return 'normal';
  const [row] = await getDb()
    .select({ manaLevel: campaignsTable.manaLevel })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));
  return row?.manaLevel ?? 'normal';
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
    const [created] = await withAudit(user.id, undefined, (tx) =>
      tx
        .insert(characterTraits)
        .values(traitInsertValues(body, { characterId: id }))
        .returning(),
    );
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    return c.json({ trait: buildTraitOut(created), character: await loadCharacterDetail(id) }, 201);
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
    const updates = buildPatchSet(body);
    const [updated] = await withAudit(user.id, undefined, (tx) =>
      tx
        .update(characterTraits)
        .set(updates)
        .where(and(eq(characterTraits.id, traitId), eq(characterTraits.characterId, id)))
        .returning(),
    );
    if (!updated) throw new HTTPException(404, { message: 'trait not found' });
    return c.json({ trait: buildTraitOut(updated), character: await loadCharacterDetail(id) }, 200);
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
    const result = await withAudit(user.id, undefined, (tx) =>
      tx
        .delete(characterTraits)
        .where(and(eq(characterTraits.id, traitId), eq(characterTraits.characterId, id)))
        .returning({ id: characterTraits.id }),
    );
    if (result.length === 0) throw new HTTPException(404, { message: 'trait not found' });
    return c.json(await loadCharacterDetail(id), 200);
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
    const [created] = await withAudit(user.id, undefined, (tx) =>
      tx
        .insert(characterSkills)
        .values(skillInsertValues(body, { characterId: id }))
        .returning(),
    );
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    const derived = computeDerived(characterAttrsFromRow(access.character));
    return c.json(
      { skill: buildSkillOut(created, derived), character: await loadCharacterDetail(id) },
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
    const updates = buildPatchSet(body);
    const [updated] = await withAudit(user.id, undefined, (tx) =>
      tx
        .update(characterSkills)
        .set(updates)
        .where(and(eq(characterSkills.id, skillId), eq(characterSkills.characterId, id)))
        .returning(),
    );
    if (!updated) throw new HTTPException(404, { message: 'skill not found' });
    const derived = computeDerived(characterAttrsFromRow(access.character));
    return c.json(
      { skill: buildSkillOut(updated, derived), character: await loadCharacterDetail(id) },
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
    const result = await withAudit(user.id, undefined, (tx) =>
      tx
        .delete(characterSkills)
        .where(and(eq(characterSkills.id, skillId), eq(characterSkills.characterId, id)))
        .returning({ id: characterSkills.id }),
    );
    if (result.length === 0) throw new HTTPException(404, { message: 'skill not found' });
    return c.json(await loadCharacterDetail(id), 200);
  },
);

// ===================== SPELLS =====================

router.openapi(
  createRoute({
    method: 'post',
    path: '/characters/{id}/spells',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Add a spell to a character (owner only)',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: spellCreate } } },
    },
    responses: {
      201: {
        description: 'Spell created — response includes the refreshed character',
        content: {
          'application/json': {
            schema: z.object({ spell: spellOut, character: characterDetail }),
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
    const [created] = await withAudit(user.id, undefined, (tx) =>
      tx
        .insert(characterSpells)
        .values(spellInsertValues(body, { characterId: id }))
        .returning(),
    );
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    const derived = computeDerived(characterAttrsFromRow(access.character));
    const traits = await db
      .select()
      .from(characterTraits)
      .where(eq(characterTraits.characterId, id));
    const magery = mageryLevel(traits.map((t) => ({ name: t.name, level: t.level })));
    const mana = await manaLevelFor(access.character.campaignId);
    return c.json(
      {
        spell: buildSpellOut(created, derived.effectiveIq, magery, mana),
        character: await loadCharacterDetail(id),
      },
      201,
    );
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/characters/{id}/spells/{spellId}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Update a spell (owner only)',
    request: {
      params: z.object({ id: uuid, spellId: uuid }),
      body: { required: true, content: { 'application/json': { schema: spellUpdate } } },
    },
    responses: {
      200: {
        description: 'Updated spell + refreshed character',
        content: {
          'application/json': {
            schema: z.object({ spell: spellOut, character: characterDetail }),
          },
        },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, spellId } = c.req.valid('param');
    const body = c.req.valid('json');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const db = getDb();
    const updates = buildPatchSet(body);
    const [updated] = await withAudit(user.id, undefined, (tx) =>
      tx
        .update(characterSpells)
        .set(updates)
        .where(and(eq(characterSpells.id, spellId), eq(characterSpells.characterId, id)))
        .returning(),
    );
    if (!updated) throw new HTTPException(404, { message: 'spell not found' });
    const derived = computeDerived(characterAttrsFromRow(access.character));
    const traits = await db
      .select()
      .from(characterTraits)
      .where(eq(characterTraits.characterId, id));
    const magery = mageryLevel(traits.map((t) => ({ name: t.name, level: t.level })));
    const mana = await manaLevelFor(access.character.campaignId);
    return c.json(
      {
        spell: buildSpellOut(updated, derived.effectiveIq, magery, mana),
        character: await loadCharacterDetail(id),
      },
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/characters/{id}/spells/{spellId}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Delete a spell (owner only)',
    request: { params: z.object({ id: uuid, spellId: uuid }) },
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
    const { id, spellId } = c.req.valid('param');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const result = await withAudit(user.id, undefined, (tx) =>
      tx
        .delete(characterSpells)
        .where(and(eq(characterSpells.id, spellId), eq(characterSpells.characterId, id)))
        .returning({ id: characterSpells.id }),
    );
    if (result.length === 0) throw new HTTPException(404, { message: 'spell not found' });
    return c.json(await loadCharacterDetail(id), 200);
  },
);

// ===================== INVENTORY =====================

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Reject a `parentId` that doesn't belong to this character.  Without
 * this check a write could create cross-character parent links and
 * later mutations on the parent would touch the other character's tree.
 *
 * Runs against the supplied tx so it can share locks with the
 * surrounding transaction.
 */
async function assertParentBelongsToCharacter(
  tx: Tx,
  parentId: string,
  characterId: string,
): Promise<void> {
  const [parent] = await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, parentId), eq(inventoryItems.characterId, characterId)));
  if (!parent) {
    throw new HTTPException(400, { message: 'parentId must reference an item on this character' });
  }
}

/**
 * Reject a parent change that would form a cycle.  Walking ancestors
 * up from the proposed parent: if we ever reach `itemId`, the new
 * parent is a descendant of the item being patched, so applying the
 * change would create a cycle.  `computeWeights` only seeds roots
 * from rows whose `parentId` is null, so a cycle silently drops the
 * whole subtree out of encumbrance — must be caught at write time.
 *
 * MUST run inside a transaction that has already locked the character
 * row FOR UPDATE.  Without that lock, two concurrent parent changes
 * (e.g. set A.parent=B and B.parent=A) can each pass their check
 * against pre-write state and then both commit a cycle.
 */
async function assertNoParentCycle(
  tx: Tx,
  proposedParentId: string,
  itemId: string,
  characterId: string,
): Promise<void> {
  const seen = new Set<string>();
  let current: string | null = proposedParentId;
  while (current !== null) {
    if (current === itemId) {
      throw new HTTPException(400, {
        message: 'parent change would create an inventory cycle',
      });
    }
    if (seen.has(current)) {
      // Pre-existing cycle in the data; don't loop forever.
      throw new HTTPException(400, { message: 'detected existing inventory cycle' });
    }
    seen.add(current);
    const [row] = await tx
      .select({ parentId: inventoryItems.parentId })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, current), eq(inventoryItems.characterId, characterId)));
    if (!row) break;
    current = row.parentId;
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
    const db = getDb();
    const created = await withAudit(user.id, undefined, async (tx) => {
      // Hold a row lock on the character so concurrent inventory tree
      // changes for this character serialize.  Without it two parent
      // changes can each pass their own pre-checks against pre-write
      // state and then both commit a cycle.
      await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, id))
        .for('update');
      if (body.parentId) await assertParentBelongsToCharacter(tx, body.parentId, id);
      // POST has no descendants yet, so no cycle check is needed here —
      // a fresh row's id can't appear in any existing parent chain.
      const [row] = await tx
        .insert(inventoryItems)
        .values(inventoryInsertValues(body, { characterId: id }))
        .returning();
      return row;
    });
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
        character: await loadCharacterDetail(id),
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
    if (body.parentId !== undefined && body.parentId !== null && body.parentId === itemId) {
      throw new HTTPException(400, { message: 'an item cannot be its own parent' });
    }
    const db = getDb();
    // numeric columns expect strings (drizzle decimal).
    const updates = buildPatchSet(body, {
      stringifyKeys: ['weightLbs', 'cost', 'hideawayCapacityLbs'],
    });
    // Wrap parent-validation + cycle-check + update in one transaction
    // with a pessimistic lock on the character row.  This serializes
    // all parent changes for this character so two concurrent calls
    // can't each pass their own pre-checks against pre-write state and
    // then both commit a cycle.
    const updated = await withAudit(user.id, undefined, async (tx) => {
      await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, id))
        .for('update');
      if (body.parentId !== undefined && body.parentId !== null) {
        await assertParentBelongsToCharacter(tx, body.parentId, id);
        await assertNoParentCycle(tx, body.parentId, itemId, id);
      }
      const [row] = await tx
        .update(inventoryItems)
        .set(updates)
        .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.characterId, id)))
        .returning();
      return row;
    });
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
        character: await loadCharacterDetail(id),
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
    await withAudit(user.id, undefined, async (tx) => {
      await tx
        .update(inventoryItems)
        .set({ parentId: doomed.parentId, updatedAt: new Date() })
        .where(and(eq(inventoryItems.parentId, itemId), eq(inventoryItems.characterId, id)));
      await tx
        .delete(inventoryItems)
        .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.characterId, id)));
    });
    return c.json(await loadCharacterDetail(id), 200);
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

    // Atomic upsert keyed on the unique (character_id) index. Doing this
    // as a single statement is essential: the previous select-then-insert
    // sequence let two parallel first-time edits both observe `!existing`
    // and then collide on the unique constraint, rolling one save back.
    const derived = computeDerived(characterAttrsFromRow(access.character));
    const setOnUpdate = buildPatchSet(body);
    const [row] = await withAudit(user.id, undefined, (tx) =>
      tx
        .insert(combatStates)
        .values(combatUpsertValues(body, { characterId: id, derived }))
        .onConflictDoUpdate({
          target: combatStates.characterId,
          set: setOnUpdate,
        })
        .returning(),
    );
    if (!row) throw new HTTPException(500, { message: 'combat upsert failed' });
    return c.json(
      { combat: buildCombatStateOut(row), character: await loadCharacterDetail(id) },
      200,
    );
  },
);

// ===================== CONDITION TOGGLES =====================

const conditionGroupParam = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'must be lower_snake_case');

const conditionGroupsResponse = z.object({
  activeConditionGroups: z.array(z.string()),
  character: characterDetail,
});

router.openapi(
  createRoute({
    method: 'post',
    path: '/characters/{id}/conditions/{group}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Toggle a trait/skill effect condition group ON for a character',
    request: {
      params: z.object({ id: uuid, group: conditionGroupParam }),
    },
    responses: {
      200: {
        description: 'Updated active group set + refreshed character',
        content: { 'application/json': { schema: conditionGroupsResponse } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, group } = c.req.valid('param');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const db = getDb();
    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    if (!row) throw new HTTPException(404, { message: 'character not found' });
    const current = new Set(row.activeConditionGroups ?? []);
    current.add(group);
    const next = Array.from(current).sort();
    await db
      .update(characters)
      .set({ activeConditionGroups: next, updatedAt: new Date() })
      .where(eq(characters.id, id));
    return c.json({ activeConditionGroups: next, character: await loadCharacterDetail(id) }, 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/characters/{id}/conditions/{group}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Toggle a trait/skill effect condition group OFF (idempotent)',
    request: {
      params: z.object({ id: uuid, group: conditionGroupParam }),
    },
    responses: {
      200: {
        description: 'Updated active group set + refreshed character',
        content: { 'application/json': { schema: conditionGroupsResponse } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, group } = c.req.valid('param');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const db = getDb();
    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    if (!row) throw new HTTPException(404, { message: 'character not found' });
    const current = (row.activeConditionGroups ?? []).filter((g) => g !== group);
    await db
      .update(characters)
      .set({ activeConditionGroups: current, updatedAt: new Date() })
      .where(eq(characters.id, id));
    return c.json({ activeConditionGroups: current, character: await loadCharacterDetail(id) }, 200);
  },
);

export const characterSubResourcesRouter = router;
