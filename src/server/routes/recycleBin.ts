import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { uuid } from '../../shared/schemas/common.ts';
import { recycleBinOut } from '../../shared/schemas/recycleBin.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { withAudit } from '../db/auditContext.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { currentTrustedExecution, trustedExecutionFor } from '../services/executionContext.ts';
import {
  listRecycleBin,
  loadBinnedCampaignOr403,
  loadBinnedCharacterOr403,
  purgeCampaign,
  purgeCharacter,
} from '../services/recycleBin.ts';

const router = createOpenApiApp();
router.use('/recycle-bin', requireActiveUser);
router.use('/recycle-bin/*', requireActiveUser);

/**
 * Permanent deletion is reserved for people. Delegated agents (MCP/OAuth) are
 * refused here, and the routes are also excluded from the MCP operation
 * manifest, so an agent can neither see nor reach them.
 */
function refuseAgents(c: Context): void {
  const user = c.get('user') as { authMethod?: string } | undefined;
  if (trustedExecutionFor(c.req.raw) || currentTrustedExecution() || user?.authMethod === 'oauth') {
    throw new HTTPException(403, { message: 'permanent deletion is not available to agents' });
  }
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/recycle-bin',
    tags: ['recycle-bin'],
    summary: 'List the characters and campaigns you can restore',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Recycle bin',
        content: { 'application/json': { schema: recycleBinOut } },
      },
      401: errorResponse('Unauthorized'),
    },
  }),
  async (c) => {
    const bin = await listRecycleBin(c.get('user').id);
    return c.json(
      {
        characters: bin.characters.map((row) => ({
          id: row.id,
          name: row.name,
          deletedAt: row.deletedAt.toISOString(),
          purgeAfter: row.purgeAfter.toISOString(),
        })),
        campaigns: bin.campaigns.map((row) => ({
          id: row.id,
          name: row.name,
          deletedAt: row.deletedAt.toISOString(),
          purgeAfter: row.purgeAfter.toISOString(),
          characterCount: row.characterCount,
        })),
      },
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/recycle-bin/characters/{id}',
    tags: ['recycle-bin'],
    summary: 'Permanently delete a character that is in the recycle bin (not available to agents)',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid }) },
    responses: {
      204: { description: 'Permanently deleted' },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not in the recycle bin'),
    },
  }),
  async (c) => {
    refuseAgents(c);
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await loadBinnedCharacterOr403(id, user.id);
    const removed = await withAudit(user.id, undefined, (tx) => purgeCharacter(tx, id));
    if (!removed) throw new HTTPException(404, { message: 'character not found' });
    return c.body(null, 204);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/recycle-bin/campaigns/{id}',
    tags: ['recycle-bin'],
    summary: 'Permanently delete a campaign that is in the recycle bin (not available to agents)',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid }) },
    responses: {
      204: { description: 'Permanently deleted' },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not in the recycle bin'),
    },
  }),
  async (c) => {
    refuseAgents(c);
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await loadBinnedCampaignOr403(id, user.id);
    const removed = await withAudit(user.id, undefined, (tx) => purgeCampaign(tx, id));
    if (!removed) throw new HTTPException(404, { message: 'campaign not found' });
    return c.body(null, 204);
  },
);

export const recycleBinRouter = router;
