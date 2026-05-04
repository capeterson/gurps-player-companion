import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  characterCreate,
  characterDetail,
  characterListItem,
  characterUpdate,
  dismissWarningRequest,
} from '../../shared/schemas/character.ts';
import { uuid } from '../../shared/schemas/common.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { assertWrite, loadCampaignOr403, loadCharacterOr403 } from '../auth/permissions.ts';
import { getDb } from '../db/client.ts';
import {
  campaignMemberships,
  campaigns,
  characterSkills,
  characterTraits,
  characters,
  combatStates,
  inventoryItems,
} from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { buildCharacterDetail } from '../services/characterSummary.ts';

const router = createOpenApiApp();
router.use('/characters', requireActiveUser);
router.use('/characters/*', requireActiveUser);

async function loadFullCharacter(id: string) {
  const db = getDb();
  const [c] = await db.select().from(characters).where(eq(characters.id, id));
  if (!c) throw new HTTPException(404, { message: 'character not found' });
  const [traits, skills, inventory, campaign] = await Promise.all([
    db
      .select()
      .from(characterTraits)
      .where(eq(characterTraits.characterId, id))
      .orderBy(asc(characterTraits.kind), asc(characterTraits.name)),
    db
      .select()
      .from(characterSkills)
      .where(eq(characterSkills.characterId, id))
      .orderBy(asc(characterSkills.name)),
    db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.characterId, id))
      .orderBy(asc(inventoryItems.name)),
    c.campaignId
      ? db
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, c.campaignId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  return buildCharacterDetail({ character: c, traits, skills, inventory, campaign });
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/characters',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'List the user’s characters and characters in their campaigns',
    responses: {
      200: {
        description: 'List',
        content: { 'application/json': { schema: z.array(characterListItem) } },
      },
      401: errorResponse('Unauthorized'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const db = getDb();
    const accessibleCampaigns = await db
      .select({ id: campaignMemberships.campaignId })
      .from(campaignMemberships)
      .where(eq(campaignMemberships.userId, user.id));
    const campaignIds = accessibleCampaigns.map((m) => m.id);
    const where =
      campaignIds.length === 0
        ? eq(characters.ownerId, user.id)
        : or(eq(characters.ownerId, user.id), inArray(characters.campaignId, campaignIds));
    const rows = await db
      .select()
      .from(characters)
      .where(where)
      .orderBy(desc(characters.updatedAt));
    return c.json(
      rows.map((r) => ({
        id: r.id,
        ownerId: r.ownerId,
        campaignId: r.campaignId,
        name: r.name,
        playerName: r.playerName,
        techLevel: r.techLevel,
        st: r.st,
        dx: r.dx,
        iq: r.iq,
        ht: r.ht,
        updatedAt: r.updatedAt.toISOString(),
        revision: Number(r.revision),
      })),
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/characters',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Create a character',
    request: {
      body: { required: true, content: { 'application/json': { schema: characterCreate } } },
    },
    responses: {
      201: {
        description: 'Character created',
        content: { 'application/json': { schema: characterDetail } },
      },
      401: errorResponse('Unauthorized'),
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    if (body.campaignId) {
      // Confirm visibility (member or owner).
      await loadCampaignOr403(body.campaignId, user.id);
    }
    const db = getDb();
    const [created] = await db
      .insert(characters)
      .values({
        ownerId: user.id,
        campaignId: body.campaignId ?? null,
        name: body.name,
        playerName: body.playerName ?? null,
        height: body.height ?? null,
        weight: body.weight ?? null,
        age: body.age ?? null,
        appearance: body.appearance ?? null,
        techLevel: body.techLevel ?? null,
        st: body.st,
        dx: body.dx,
        iq: body.iq,
        ht: body.ht,
        hpMod: body.hpMod,
        willMod: body.willMod,
        perMod: body.perMod,
        fpMod: body.fpMod,
        speedQuarterMod: body.speedQuarterMod,
        moveMod: body.moveMod,
        tempSt: body.tempSt,
        tempDx: body.tempDx,
        tempIq: body.tempIq,
        tempHt: body.tempHt,
        tempHpMod: body.tempHpMod,
        tempWillMod: body.tempWillMod,
        tempPerMod: body.tempPerMod,
        tempFpMod: body.tempFpMod,
        tempSpeedQuarterMod: body.tempSpeedQuarterMod,
        tempMoveMod: body.tempMoveMod,
      })
      .returning();
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    return c.json(await loadFullCharacter(created.id), 201);
  },
);

router.openapi(
  createRoute({
    method: 'get',
    path: '/characters/{id}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: {
        description: 'Character detail',
        content: { 'application/json': { schema: characterDetail } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await loadCharacterOr403(id, user.id);
    return c.json(await loadFullCharacter(id), 200);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/characters/{id}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Update character (owner only)',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: characterUpdate } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: characterDetail } } },
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
    if (body.campaignId !== undefined && body.campaignId !== null) {
      await loadCampaignOr403(body.campaignId, user.id);
    }
    const db = getDb();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k] = v;
    }
    await db.update(characters).set(updates).where(eq(characters.id, id));
    return c.json(await loadFullCharacter(id), 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/characters/{id}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid }) },
    responses: {
      204: { description: 'Deleted' },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    await getDb().delete(characters).where(eq(characters.id, id));
    return c.body(null, 204);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/characters/{id}/warnings/dismiss',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Dismiss or restore a warning code',
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: dismissWarningRequest } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: characterDetail } } },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { code, dismissed } = c.req.valid('json');
    const access = await loadCharacterOr403(id, user.id);
    assertWrite(access);
    const current = new Set(access.character.dismissedWarnings);
    if (dismissed) current.add(code);
    else current.delete(code);
    await getDb()
      .update(characters)
      .set({ dismissedWarnings: [...current], updatedAt: new Date() })
      .where(eq(characters.id, id));
    return c.json(await loadFullCharacter(id), 200);
  },
);

// Combat-state convenience touch — also forces import resolution.
export const _internal = combatStates;
export const charactersRouter = router;
