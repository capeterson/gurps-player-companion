import { createRoute, z } from '@hono/zod-openapi';
import { desc, eq, inArray, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  type CharacterMinimalOut,
  characterCreate,
  characterDetail,
  characterDetailEnvelope,
  characterListItem,
  characterMinimalOut,
  characterUpdate,
  dismissWarningRequest,
} from '../../shared/schemas/character.ts';
import { uuid } from '../../shared/schemas/common.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { assertWrite, loadCampaignOr403, loadCharacterOr403 } from '../auth/permissions.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { campaignMemberships, campaigns, characters } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { resolveCharacterView } from '../services/characterAccess.ts';
import { loadCharacterDetail } from '../services/characterSummary.ts';
import { characterInsertValues } from '../services/entityWrites.ts';
import { buildPatchSet } from '../services/patchSet.ts';
import { decideCharacterAccess } from './sync.ts';

const router = createOpenApiApp();
router.use('/characters', requireActiveUser);
router.use('/characters/*', requireActiveUser);

/**
 * Project the row + parent campaign down to the minimal "readily
 * apparent" view. Used when a campaign has shareCharacterSheets=false
 * and the requester is neither the owner nor the character's author.
 */
async function loadMinimalCharacter(id: string): Promise<CharacterMinimalOut> {
  const db = getDb();
  const [c] = await db.select().from(characters).where(eq(characters.id, id));
  if (!c) throw new HTTPException(404, { message: 'character not found' });
  return {
    view: 'minimal',
    id: c.id,
    ownerId: c.ownerId,
    campaignId: c.campaignId,
    name: c.name,
    playerName: c.playerName,
    height: c.height,
    weight: c.weight,
    age: c.age,
    appearance: c.appearance,
    techLevel: c.techLevel,
    updatedAt: c.updatedAt.toISOString(),
  };
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
    // Same share gate as GET /characters/{id} and /sync/cursor: fellow
    // members of a shareCharacterSheets=false campaign only get the
    // "readily apparent" identity bits, so core attributes are masked
    // to the 10/10/10/10 baseline for characters the viewer may only
    // see in minimal form.
    const relevantCampaignIds = [
      ...new Set(rows.map((r) => r.campaignId).filter((id): id is string => id !== null)),
    ];
    const campaignRows =
      relevantCampaignIds.length === 0
        ? []
        : await db
            .select({
              id: campaigns.id,
              ownerId: campaigns.ownerId,
              shareCharacterSheets: campaigns.shareCharacterSheets,
            })
            .from(campaigns)
            .where(inArray(campaigns.id, relevantCampaignIds));
    const accessModes = decideCharacterAccess({
      viewerId: user.id,
      characters: rows,
      campaigns: campaignRows,
    });
    return c.json(
      rows.map((r) => {
        const minimal = accessModes.get(r.id) === 'minimal';
        return {
          id: r.id,
          ownerId: r.ownerId,
          campaignId: r.campaignId,
          name: r.name,
          playerName: r.playerName,
          techLevel: r.techLevel,
          st: minimal ? 10 : r.st,
          dx: minimal ? 10 : r.dx,
          iq: minimal ? 10 : r.iq,
          ht: minimal ? 10 : r.ht,
          updatedAt: r.updatedAt.toISOString(),
          revision: Number(r.revision),
        };
      }),
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
    const [created] = await withAudit(user.id, undefined, (tx) =>
      tx
        .insert(characters)
        .values(characterInsertValues(body, { ownerId: user.id }))
        .returning(),
    );
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    return c.json(await loadCharacterDetail(created.id), 201);
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
        description:
          'Character detail. Returns the full sheet to the owner and to GM/campaign owners; ' +
          'returns the minimal "readily apparent" payload to fellow members when the parent ' +
          'campaign has shareCharacterSheets=false. Discriminated by the `view` field.',
        content: { 'application/json': { schema: characterDetailEnvelope } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const access = await loadCharacterOr403(id, user.id);
    const view = await resolveCharacterView(user.id, access.character);
    if (view === 'minimal') {
      return c.json(await loadMinimalCharacter(id), 200);
    }
    return c.json(await loadCharacterDetail(id), 200);
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
    const updates = buildPatchSet(body);
    await withAudit(user.id, undefined, (tx) =>
      tx.update(characters).set(updates).where(eq(characters.id, id)),
    );
    return c.json(await loadCharacterDetail(id), 200);
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
    await withAudit(user.id, undefined, (tx) => tx.delete(characters).where(eq(characters.id, id)));
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
    await withAudit(user.id, undefined, (tx) =>
      tx
        .update(characters)
        .set({ dismissedWarnings: [...current], updatedAt: new Date() })
        .where(eq(characters.id, id)),
    );
    return c.json(await loadCharacterDetail(id), 200);
  },
);

export const charactersRouter = router;
