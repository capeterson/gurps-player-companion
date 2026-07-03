import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  addMemberRequest,
  campaignCreate,
  campaignOut,
  campaignUpdate,
  setMemberRoleRequest,
  transferOwnershipRequest,
} from '../../shared/schemas/campaign.ts';
import { uuid } from '../../shared/schemas/common.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import {
  loadCampaignOr403,
  requireCampaignAdmin,
  requireCampaignOwner,
} from '../auth/permissions.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  type DbCampaign,
  type DbCampaignMembership,
  campaignMemberships,
  campaigns,
  users,
} from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';

const router = createOpenApiApp();
router.use('/campaigns', requireActiveUser);
router.use('/campaigns/*', requireActiveUser);

interface MemberRow {
  userId: string;
  email: string;
  displayName: string;
  role: DbCampaignMembership['role'];
}

async function loadMembers(campaignId: string): Promise<MemberRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: campaignMemberships.role,
    })
    .from(campaignMemberships)
    .innerJoin(users, eq(users.id, campaignMemberships.userId))
    .where(eq(campaignMemberships.campaignId, campaignId))
    .orderBy(asc(users.displayName));
  return rows;
}

function campaignToOut(row: DbCampaign, members: readonly MemberRow[]) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    pointTarget: row.pointTarget,
    disadvantageCap: row.disadvantageCap,
    quirkCap: row.quirkCap,
    manaLevel: row.manaLevel,
    shareCharacterSheets: row.shareCharacterSheets,
    members: members.map((m) => ({
      userId: m.userId,
      email: m.email,
      displayName: m.displayName,
      role: m.role,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revision: Number(row.revision),
  };
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns',
    tags: ['campaigns'],
    summary: 'List campaigns the user owns or is a member of',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Campaign list',
        content: { 'application/json': { schema: z.array(campaignOut) } },
      },
      401: errorResponse('Unauthorized'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const db = getDb();
    const rows = await db
      .selectDistinct()
      .from(campaigns)
      .leftJoin(
        campaignMemberships,
        and(
          eq(campaignMemberships.campaignId, campaigns.id),
          eq(campaignMemberships.userId, user.id),
        ),
      )
      .where(or(eq(campaigns.ownerId, user.id), eq(campaignMemberships.userId, user.id)));
    const ids = rows.map((r) => r.campaigns.id);
    if (ids.length === 0) return c.json([], 200);
    const memberLookup = await db
      .select({
        campaignId: campaignMemberships.campaignId,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: campaignMemberships.role,
      })
      .from(campaignMemberships)
      .innerJoin(users, eq(users.id, campaignMemberships.userId))
      .where(inArray(campaignMemberships.campaignId, ids));
    const grouped = new Map<string, MemberRow[]>();
    for (const m of memberLookup) {
      const arr = grouped.get(m.campaignId) ?? [];
      arr.push({
        userId: m.userId,
        email: m.email,
        displayName: m.displayName,
        role: m.role,
      });
      grouped.set(m.campaignId, arr);
    }
    return c.json(
      rows.map((r) => campaignToOut(r.campaigns, grouped.get(r.campaigns.id) ?? [])),
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns',
    tags: ['campaigns'],
    summary: 'Create a new campaign (the creator becomes owner)',
    security: [{ bearerAuth: [] }],
    request: {
      body: { required: true, content: { 'application/json': { schema: campaignCreate } } },
    },
    responses: {
      201: {
        description: 'Campaign created',
        content: { 'application/json': { schema: campaignOut } },
      },
      401: errorResponse('Unauthorized'),
      422: errorResponse('Validation error'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const created = await withAudit(user.id, undefined, async (tx) => {
      const [row] = await tx
        .insert(campaigns)
        .values({
          name: body.name,
          description: body.description ?? null,
          ownerId: user.id,
          pointTarget: body.pointTarget ?? null,
          disadvantageCap: body.disadvantageCap ?? null,
          quirkCap: body.quirkCap ?? 5,
          ...(body.manaLevel !== undefined ? { manaLevel: body.manaLevel } : {}),
          ...(body.shareCharacterSheets !== undefined
            ? { shareCharacterSheets: body.shareCharacterSheets }
            : {}),
        })
        .returning();
      if (!row) throw new HTTPException(500, { message: 'insert failed' });
      await tx.insert(campaignMemberships).values({
        campaignId: row.id,
        userId: user.id,
        role: 'owner',
      });
      return row;
    });
    const members = await loadMembers(created.id);
    return c.json(campaignToOut(created, members), 201);
  },
);

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns/{id}',
    tags: ['campaigns'],
    summary: 'Get a campaign (member or owner only)',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: { description: 'Campaign', content: { 'application/json': { schema: campaignOut } } },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { campaign } = await loadCampaignOr403(id, user.id);
    const members = await loadMembers(campaign.id);
    return c.json(campaignToOut(campaign, members), 200);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/campaigns/{id}',
    tags: ['campaigns'],
    summary: 'Update campaign metadata (owner only)',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: campaignUpdate } } },
    },
    responses: {
      200: {
        description: 'Updated campaign',
        content: { 'application/json': { schema: campaignOut } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignOwner(id, user.id);
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [updated] = await tx
        .update(campaigns)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.pointTarget !== undefined ? { pointTarget: body.pointTarget } : {}),
          ...(body.disadvantageCap !== undefined ? { disadvantageCap: body.disadvantageCap } : {}),
          ...(body.quirkCap !== undefined ? { quirkCap: body.quirkCap } : {}),
          ...(body.manaLevel !== undefined ? { manaLevel: body.manaLevel } : {}),
          ...(body.shareCharacterSheets !== undefined
            ? { shareCharacterSheets: body.shareCharacterSheets }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(campaigns.id, id))
        .returning();
      if (!updated) throw new HTTPException(500, { message: 'update failed' });
      return updated;
    });
    const members = await loadMembers(row.id);
    return c.json(campaignToOut(row, members), 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/campaigns/{id}',
    tags: ['campaigns'],
    summary: 'Delete a campaign (owner only). Cascades to memberships, library, log.',
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
    await requireCampaignOwner(id, user.id);
    await withAudit(user.id, undefined, async (tx) => {
      await tx.delete(campaigns).where(eq(campaigns.id, id));
    });
    return c.body(null, 204);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/members',
    tags: ['campaigns'],
    summary: 'Add a member by email lookup (owner only)',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: addMemberRequest } } },
    },
    responses: {
      200: {
        description: 'Updated campaign',
        content: { 'application/json': { schema: campaignOut } },
      },
      400: errorResponse('Invalid'),
      404: errorResponse('User not found'),
      409: errorResponse('Already a member'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const campaign = await requireCampaignOwner(id, user.id);
    const db = getDb();
    const found = await db.select().from(users).where(eq(users.email, body.email));
    const target = found[0];
    if (!target) throw new HTTPException(404, { message: 'user not found' });
    // Fast-path pre-check; the unique index on (campaign_id, user_id)
    // is the authoritative arbiter — two concurrent add-member requests
    // can both pass this check, so we also catch the unique-violation
    // on insert below.
    const existing = await db
      .select()
      .from(campaignMemberships)
      .where(
        and(eq(campaignMemberships.campaignId, id), eq(campaignMemberships.userId, target.id)),
      );
    if (existing[0]) throw new HTTPException(409, { message: 'already a member' });
    try {
      await withAudit(user.id, undefined, async (tx) => {
        await tx.insert(campaignMemberships).values({
          campaignId: campaign.id,
          userId: target.id,
          role: 'member',
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HTTPException(409, { message: 'already a member' });
      }
      throw err;
    }
    const members = await loadMembers(campaign.id);
    return c.json(campaignToOut(campaign, members), 200);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/campaigns/{id}/members/{userId}',
    tags: ['campaigns'],
    summary:
      'Owner-only: promote a member to manager or demote back to member. Owner transitions go through transfer-ownership.',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid, userId: uuid }),
      body: { required: true, content: { 'application/json': { schema: setMemberRoleRequest } } },
    },
    responses: {
      200: {
        description: 'Updated campaign',
        content: { 'application/json': { schema: campaignOut } },
      },
      400: errorResponse('Invalid'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, userId } = c.req.valid('param');
    const body = c.req.valid('json');
    const campaign = await requireCampaignOwner(id, user.id);
    if (userId === campaign.ownerId) {
      throw new HTTPException(400, {
        message: "cannot change the owner's role; use transfer-ownership instead",
      });
    }
    const updated = await withAudit(user.id, undefined, async (tx) => {
      return tx
        .update(campaignMemberships)
        .set({ role: body.role, updatedAt: new Date() })
        .where(and(eq(campaignMemberships.campaignId, id), eq(campaignMemberships.userId, userId)))
        .returning({ id: campaignMemberships.id });
    });
    if (updated.length === 0) throw new HTTPException(404, { message: 'membership not found' });
    const members = await loadMembers(campaign.id);
    return c.json(campaignToOut(campaign, members), 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/campaigns/{id}/members/{userId}',
    tags: ['campaigns'],
    summary:
      'Remove a member. Owners may remove anyone but the owner; managers may remove only members.',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid, userId: uuid }) },
    responses: {
      204: { description: 'Removed' },
      400: errorResponse('Cannot remove owner'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, userId } = c.req.valid('param');
    const { campaign, role: actorRole } = await requireCampaignAdmin(id, user.id);
    if (userId === campaign.ownerId) {
      throw new HTTPException(400, { message: 'cannot remove owner; transfer ownership first' });
    }
    const db = getDb();
    if (actorRole === 'manager') {
      // Look up the target's role first; managers can only remove members.
      const target = await db
        .select()
        .from(campaignMemberships)
        .where(and(eq(campaignMemberships.campaignId, id), eq(campaignMemberships.userId, userId)));
      if (target[0] && target[0].role !== 'member') {
        throw new HTTPException(403, { message: 'managers can only remove regular members' });
      }
    }
    const result = await withAudit(user.id, undefined, async (tx) => {
      return tx
        .delete(campaignMemberships)
        .where(and(eq(campaignMemberships.campaignId, id), eq(campaignMemberships.userId, userId)))
        .returning({ id: campaignMemberships.id });
    });
    if (result.length === 0) throw new HTTPException(404, { message: 'membership not found' });
    return c.body(null, 204);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/transfer',
    tags: ['campaigns'],
    summary: 'Transfer ownership to an existing member (owner only)',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid }),
      body: {
        required: true,
        content: { 'application/json': { schema: transferOwnershipRequest } },
      },
    },
    responses: {
      200: {
        description: 'Updated campaign',
        content: { 'application/json': { schema: campaignOut } },
      },
      400: errorResponse('New owner is not a member'),
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { newOwnerId } = c.req.valid('json');
    const campaign = await requireCampaignOwner(id, user.id);
    if (newOwnerId === campaign.ownerId) {
      throw new HTTPException(400, { message: 'already the owner' });
    }
    const db = getDb();
    const memberships = await db
      .select()
      .from(campaignMemberships)
      .where(
        and(eq(campaignMemberships.campaignId, id), eq(campaignMemberships.userId, newOwnerId)),
      );
    if (!memberships[0]) {
      throw new HTTPException(400, { message: 'new owner must be a campaign member' });
    }
    await withAudit(user.id, undefined, async (tx) => {
      await tx
        .update(campaigns)
        .set({ ownerId: newOwnerId, updatedAt: new Date() })
        .where(eq(campaigns.id, id));
      await tx
        .update(campaignMemberships)
        .set({ role: 'member' })
        .where(
          and(
            eq(campaignMemberships.campaignId, id),
            eq(campaignMemberships.userId, campaign.ownerId),
          ),
        );
      await tx
        .update(campaignMemberships)
        .set({ role: 'owner' })
        .where(
          and(eq(campaignMemberships.campaignId, id), eq(campaignMemberships.userId, newOwnerId)),
        );
    });
    const refreshed = await db.select().from(campaigns).where(eq(campaigns.id, id));
    const updated = refreshed[0];
    if (!updated) throw new HTTPException(500, { message: 'campaign vanished' });
    const members = await loadMembers(id);
    return c.json(campaignToOut(updated, members), 200);
  },
);

// Touch sql import so eslint doesn't complain about unused.  We use sql in tests.
export const _ = sql;
export const campaignsRouter = router;
