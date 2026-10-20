/**
 * Equipment loadouts: named item sets, Equip and Restore Last Equipped.
 *
 * Reads need full character access (loadouts are private sheet data under
 * the share gate); writes need write access. Every write shares its service
 * with the /sync dispatcher (services/loadouts.ts) and runs in withAudit.
 */
import { randomUUID } from 'node:crypto';
import { createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { characterDetail } from '../../shared/schemas/character.ts';
import { uuid } from '../../shared/schemas/common.ts';
import {
  characterLoadoutsOut,
  equipmentSwitch,
  loadoutCreate,
  loadoutOut,
  loadoutUpdate,
} from '../../shared/schemas/loadout.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { assertWrite, loadCharacterOr403 } from '../auth/permissions.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { resolveCharacterView } from '../services/characterAccess.ts';
import { loadCharacterDetail } from '../services/characterSummary.ts';
import {
  appendedSortOrder,
  createLoadout,
  deleteLoadout,
  equipLoadout,
  listLoadouts,
  loadoutRowOut,
  readLastEquipmentSwitch,
  restoreLastEquipped,
  updateLoadout,
} from '../services/loadouts.ts';

const router = createOpenApiApp();
router.use('/characters/*', requireActiveUser);

const loadoutParams = z.object({ id: uuid, loadoutId: uuid });

const switchResult = z.object({
  lastEquipmentSwitch: equipmentSwitch,
  /** Loadout items left unequipped because nothing of them is carried. */
  skipped: z.array(z.object({ itemId: uuid, reason: z.enum(['quantity', 'unavailable']) })),
  /** Items Last Equipped could not return to a container that is gone. */
  unrestored: z.array(uuid),
  character: characterDetail,
});

async function loadWritable(id: string, userId: string) {
  const access = await loadCharacterOr403(id, userId);
  assertWrite(access);
}

async function readLoadouts(id: string) {
  const db = getDb();
  return characterLoadoutsOut.parse({
    loadouts: await listLoadouts(db, id),
    lastEquipmentSwitch: await readLastEquipmentSwitch(db, id),
  });
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/characters/{id}/loadouts',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'List equipment loadouts and the Last Equipped record',
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: {
        description: 'Loadouts in menu order and the latest switch (null before the first)',
        content: { 'application/json': { schema: characterLoadoutsOut } },
      },
      403: errorResponse('Full character access required'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    const access = await loadCharacterOr403(id, user.id);
    if ((await resolveCharacterView(user.id, access.character)) !== 'full')
      throw new HTTPException(403, { message: 'full character access required' });
    return c.json(await readLoadouts(id), 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/characters/{id}/loadouts',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Create an equipment loadout',
    description:
      'Create a named set of this character’s inventory items. Omitting `sortOrder` places it last in the menu.',
    request: {
      params: z.object({ id: uuid }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: loadoutCreate.extend({ sortOrder: z.number().finite().optional() }),
          },
        },
      },
    },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: loadoutOut } } },
      400: errorResponse('Item from another character, or too many loadouts'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
      503: errorResponse('Character campaign changed; retry this edit'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await loadWritable(id, user.id);
    const created = await withAudit(user.id, undefined, async (tx) =>
      createLoadout(tx, user.id, id, {
        ...body,
        sortOrder: body.sortOrder ?? (await appendedSortOrder(tx, id)),
      }),
    );
    return c.json(loadoutRowOut(created), 201);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/characters/{id}/loadouts/{loadoutId}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Rename, reorder or change the items of an equipment loadout',
    request: {
      params: loadoutParams,
      body: { required: true, content: { 'application/json': { schema: loadoutUpdate } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: loadoutOut } } },
      400: errorResponse('Item from another character'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
      503: errorResponse('Character campaign changed; retry this edit'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, loadoutId } = c.req.valid('param');
    const body = c.req.valid('json');
    await loadWritable(id, user.id);
    const updated = await withAudit(user.id, undefined, (tx) =>
      updateLoadout(tx, user.id, id, loadoutId, body),
    );
    if (!updated) throw new HTTPException(404, { message: 'loadout not found' });
    return c.json(loadoutRowOut(updated), 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/characters/{id}/loadouts/{loadoutId}',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Delete an equipment loadout (its items are unchanged)',
    request: { params: loadoutParams },
    responses: {
      200: {
        description: 'Remaining loadouts',
        content: { 'application/json': { schema: characterLoadoutsOut } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, loadoutId } = c.req.valid('param');
    await loadWritable(id, user.id);
    const removed = await withAudit(user.id, undefined, (tx) => deleteLoadout(tx, id, loadoutId));
    if (!removed) throw new HTTPException(404, { message: 'loadout not found' });
    return c.json(await readLoadouts(id), 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/characters/{id}/loadouts/{loadoutId}/equip',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Equip an equipment loadout',
    description:
      'Moves each loadout item that is not on the player to the root of On the player, equips the loadout items and unequips every other item without moving it. The previous state becomes Last Equipped.',
    request: { params: loadoutParams },
    responses: {
      200: {
        description: 'The switch record (now Last Equipped) and the refreshed character',
        content: { 'application/json': { schema: switchResult } },
      },
      400: errorResponse('Invalid inventory state'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
      503: errorResponse('Character campaign changed; retry this edit'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, loadoutId } = c.req.valid('param');
    await loadWritable(id, user.id);
    // One switch is one gesture: the character and every item share a batch.
    const plan = await withAudit(user.id, randomUUID(), (tx) =>
      equipLoadout(tx, user.id, id, loadoutId),
    );
    return c.json(
      {
        lastEquipmentSwitch: plan.record,
        skipped: [...plan.skipped],
        unrestored: [...plan.unrestored],
        character: await loadCharacterDetail(id),
      },
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/characters/{id}/loadouts/restore-last-equipped',
    tags: ['characters'],
    security: [{ bearerAuth: [] }],
    summary: 'Restore Last Equipped',
    description:
      'Reverses the latest loadout switch: re-equips the previous equipped set and returns moved items to their earlier location. The state it replaces becomes the new Last Equipped, so restoring twice toggles.',
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: {
        description: 'The restore record (now Last Equipped) and the refreshed character',
        content: { 'application/json': { schema: switchResult } },
      },
      400: errorResponse('Invalid inventory state'),
      403: errorResponse('Forbidden'),
      404: errorResponse('No Last Equipped loadout'),
      503: errorResponse('Character campaign changed; retry this edit'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await loadWritable(id, user.id);
    const plan = await withAudit(user.id, randomUUID(), (tx) =>
      restoreLastEquipped(tx, user.id, id),
    );
    return c.json(
      {
        lastEquipmentSwitch: plan.record,
        skipped: [...plan.skipped],
        unrestored: [...plan.unrestored],
        character: await loadCharacterDetail(id),
      },
      200,
    );
  },
);

export const characterLoadoutsRouter = router;
