/**
 * Instance-administration endpoints, all gated by `requireSuperuser`.
 *
 * The superuser flag is set ONLY by direct DB edit — there's no API or
 * UI path to grant it.  Read endpoints form a self-contained tree (no
 * bypass in the regular permission helpers); write endpoints cover the
 * suspend / unsuspend / purge / cancel-purge state machine.
 *
 * Note on "active": gpw used a boolean is_active flag; this repo uses
 * `users.suspended_at` (nullable timestamp) for the same semantic.
 * Suspension responses surface BOTH a derived isActive boolean and the
 * raw timestamp so the UI can display either.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, count, desc, eq, isNull, like, ne, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  type AdminCampaignDetail,
  type AdminCampaignList,
  type AdminUserDetail,
  type AdminUserList,
  type AdminUserSummary,
  adminCampaignDetail,
  adminCampaignList,
  adminUserDetail,
  adminUserList,
  adminUserSummary,
} from '../../shared/schemas/admin.ts';
import { uuid } from '../../shared/schemas/common.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { requireSuperuser } from '../auth/permissions.ts';
import { getDb } from '../db/client.ts';
import {
  apiKeys,
  campaignMemberships,
  campaigns,
  characters,
  refreshTokens,
  users,
} from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';

const router = createOpenApiApp();
router.use('/admin', requireActiveUser);
router.use('/admin/*', requireActiveUser);

// 30-day soft-delete window. Plain constant rather than a setting —
// this is policy, not a tunable.
const PURGE_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

function ensureNotSelf(targetId: string, actorId: string): void {
  // Block superusers from suspending or purging themselves; the flag is
  // DB-only so an admin can't undo the lockout from the UI.
  if (targetId === actorId) {
    throw new HTTPException(400, { message: 'cannot act on self' });
  }
}

async function userSummary(userId: string): Promise<AdminUserSummary> {
  const db = getDb();
  const u = (await db.select().from(users).where(eq(users.id, userId)))[0];
  if (!u) throw new HTTPException(404, { message: 'user not found' });
  const [charCount, campCount] = await Promise.all([
    db.select({ n: count() }).from(characters).where(eq(characters.ownerId, userId)),
    db.select({ n: count() }).from(campaigns).where(eq(campaigns.ownerId, userId)),
  ]);
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    isSuperuser: u.isSuperuser,
    isActive: u.suspendedAt === null,
    suspendedAt: u.suspendedAt ? u.suspendedAt.toISOString() : null,
    purgeScheduledAt: u.purgeScheduledAt ? u.purgeScheduledAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    characterCount: Number(charCount[0]?.n ?? 0),
    campaignCount: Number(campCount[0]?.n ?? 0),
  };
}

/**
 * Revoke every still-live refresh token and API key for a user.
 * The auth middleware's suspended check would already block them, but
 * this prunes the rows that would otherwise sit in implicit-revoke limbo.
 */
async function revokeUserCredentials(userId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  await db
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/admin/users',
    tags: ['admin'],
    summary: 'List users (superuser only)',
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        q: z.string().max(255).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    },
    responses: {
      200: { description: 'List', content: { 'application/json': { schema: adminUserList } } },
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const actor = c.get('user');
    await requireSuperuser(actor.id);
    const { q, limit, offset } = c.req.valid('query');
    const db = getDb();
    const where = q
      ? or(
          like(sql`lower(${users.email})`, `%${q.toLowerCase()}%`),
          like(sql`lower(${users.displayName})`, `%${q.toLowerCase()}%`),
        )
      : undefined;

    const totalRows = await db
      .select({ total: count() })
      .from(users)
      .where(where ?? sql`true`);
    const total = Number(totalRows[0]?.total ?? 0);

    const rows = await db
      .select()
      .from(users)
      .where(where ?? sql`true`)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    // Hydrate counts per row.  N+1 queries here are bounded by `limit`
    // (max 200) and the per-user counts are cheap; acceptable for an
    // admin-only screen.
    const items: AdminUserSummary[] = await Promise.all(rows.map((u) => userSummary(u.id)));
    const out: AdminUserList = { items, total };
    return c.json(out, 200);
  },
);

router.openapi(
  createRoute({
    method: 'get',
    path: '/admin/users/{userId}',
    tags: ['admin'],
    summary: 'User detail (superuser only)',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ userId: uuid }) },
    responses: {
      200: { description: 'Detail', content: { 'application/json': { schema: adminUserDetail } } },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const actor = c.get('user');
    await requireSuperuser(actor.id);
    const { userId } = c.req.valid('param');
    const summary = await userSummary(userId);
    const db = getDb();
    const charRows = await db
      .select()
      .from(characters)
      .where(eq(characters.ownerId, userId))
      .orderBy(desc(characters.createdAt));
    const campOwned = await db.select().from(campaigns).where(eq(campaigns.ownerId, userId));
    const campMember = await db
      .select({ campaign: campaigns, role: campaignMemberships.role })
      .from(campaignMemberships)
      .innerJoin(campaigns, eq(campaigns.id, campaignMemberships.campaignId))
      .where(and(eq(campaignMemberships.userId, userId), ne(campaigns.ownerId, userId)));
    const out: AdminUserDetail = {
      ...summary,
      characters: charRows.map((ch) => ({
        id: ch.id,
        name: ch.name,
        campaignId: ch.campaignId,
        createdAt: ch.createdAt.toISOString(),
      })),
      campaigns: [
        ...campOwned.map((c2) => ({
          id: c2.id,
          name: c2.name,
          role: 'owner' as const,
          createdAt: c2.createdAt.toISOString(),
        })),
        ...campMember.map((row) => ({
          id: row.campaign.id,
          name: row.campaign.name,
          role: row.role,
          createdAt: row.campaign.createdAt.toISOString(),
        })),
      ],
    };
    return c.json(out, 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/admin/users/{userId}/suspend',
    tags: ['admin'],
    summary: 'Suspend a user (superuser only). Cannot suspend self.',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ userId: uuid }) },
    responses: {
      200: {
        description: 'Suspended',
        content: { 'application/json': { schema: adminUserSummary } },
      },
      400: errorResponse('Cannot act on self'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const actor = c.get('user');
    await requireSuperuser(actor.id);
    const { userId } = c.req.valid('param');
    ensureNotSelf(userId, actor.id);
    const db = getDb();
    const updated = await db
      .update(users)
      .set({ suspendedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (updated.length === 0) throw new HTTPException(404, { message: 'user not found' });
    await revokeUserCredentials(userId);
    return c.json(await userSummary(userId), 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/admin/users/{userId}/unsuspend',
    tags: ['admin'],
    summary: 'Unsuspend a user (superuser only). Refuses while purge is pending.',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ userId: uuid }) },
    responses: {
      200: {
        description: 'Unsuspended',
        content: { 'application/json': { schema: adminUserSummary } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
      409: errorResponse('Purge pending — cancel first'),
    },
  }),
  async (c) => {
    const actor = c.get('user');
    await requireSuperuser(actor.id);
    const { userId } = c.req.valid('param');
    ensureNotSelf(userId, actor.id);
    const db = getDb();
    const target = (await db.select().from(users).where(eq(users.id, userId)))[0];
    if (!target) throw new HTTPException(404, { message: 'user not found' });
    if (target.purgeScheduledAt !== null) {
      throw new HTTPException(409, { message: 'purge pending; cancel first' });
    }
    await db
      .update(users)
      .set({ suspendedAt: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return c.json(await userSummary(userId), 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/admin/users/{userId}/purge',
    tags: ['admin'],
    summary:
      'Schedule the user for hard-delete in 30 days. Suspends them in the same call. Idempotent — re-purge rebases the timer.',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ userId: uuid }) },
    responses: {
      200: {
        description: 'Scheduled',
        content: { 'application/json': { schema: adminUserSummary } },
      },
      400: errorResponse('Cannot act on self'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const actor = c.get('user');
    await requireSuperuser(actor.id);
    const { userId } = c.req.valid('param');
    ensureNotSelf(userId, actor.id);
    const db = getDb();
    const updated = await db
      .update(users)
      .set({
        purgeScheduledAt: new Date(Date.now() + PURGE_DELAY_MS),
        suspendedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (updated.length === 0) throw new HTTPException(404, { message: 'user not found' });
    await revokeUserCredentials(userId);
    return c.json(await userSummary(userId), 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/admin/users/{userId}/cancel-purge',
    tags: ['admin'],
    summary: 'Clear the purge timer (does NOT auto-unsuspend).',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ userId: uuid }) },
    responses: {
      200: {
        description: 'Cleared',
        content: { 'application/json': { schema: adminUserSummary } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const actor = c.get('user');
    await requireSuperuser(actor.id);
    const { userId } = c.req.valid('param');
    const db = getDb();
    const updated = await db
      .update(users)
      .set({ purgeScheduledAt: null, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (updated.length === 0) throw new HTTPException(404, { message: 'user not found' });
    return c.json(await userSummary(userId), 200);
  },
);

router.openapi(
  createRoute({
    method: 'get',
    path: '/admin/campaigns',
    tags: ['admin'],
    summary: 'List campaigns (superuser only)',
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        q: z.string().max(255).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    },
    responses: {
      200: {
        description: 'List',
        content: { 'application/json': { schema: adminCampaignList } },
      },
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const actor = c.get('user');
    await requireSuperuser(actor.id);
    const { q, limit, offset } = c.req.valid('query');
    const db = getDb();
    const where = q
      ? or(
          like(sql`lower(${campaigns.name})`, `%${q.toLowerCase()}%`),
          like(sql`lower(${users.displayName})`, `%${q.toLowerCase()}%`),
          like(sql`lower(${users.email})`, `%${q.toLowerCase()}%`),
        )
      : undefined;

    const baseFilter = where ?? sql`true`;
    const totalRows = await db
      .select({ total: count() })
      .from(campaigns)
      .innerJoin(users, eq(users.id, campaigns.ownerId))
      .where(baseFilter);
    const total = Number(totalRows[0]?.total ?? 0);

    const rows = await db
      .select({ campaign: campaigns, ownerName: users.displayName, ownerEmail: users.email })
      .from(campaigns)
      .innerJoin(users, eq(users.id, campaigns.ownerId))
      .where(baseFilter)
      .orderBy(desc(campaigns.createdAt))
      .limit(limit)
      .offset(offset);

    const items = await Promise.all(
      rows.map(async ({ campaign, ownerName, ownerEmail }) => {
        const [memberCount, charCount] = await Promise.all([
          db
            .select({ n: count() })
            .from(campaignMemberships)
            .where(eq(campaignMemberships.campaignId, campaign.id)),
          db.select({ n: count() }).from(characters).where(eq(characters.campaignId, campaign.id)),
        ]);
        return {
          id: campaign.id,
          name: campaign.name,
          description: campaign.description,
          ownerId: campaign.ownerId,
          ownerDisplayName: ownerName,
          ownerEmail: ownerEmail,
          memberCount: Number(memberCount[0]?.n ?? 0),
          characterCount: Number(charCount[0]?.n ?? 0),
          shareCharacterSheets: campaign.shareCharacterSheets,
          createdAt: campaign.createdAt.toISOString(),
        };
      }),
    );
    const out: AdminCampaignList = { items, total };
    return c.json(out, 200);
  },
);

router.openapi(
  createRoute({
    method: 'get',
    path: '/admin/campaigns/{campaignId}',
    tags: ['admin'],
    summary: 'Campaign detail (superuser only)',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ campaignId: uuid }) },
    responses: {
      200: {
        description: 'Detail',
        content: { 'application/json': { schema: adminCampaignDetail } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const actor = c.get('user');
    await requireSuperuser(actor.id);
    const { campaignId } = c.req.valid('param');
    const db = getDb();
    const campRow = (await db.select().from(campaigns).where(eq(campaigns.id, campaignId)))[0];
    if (!campRow) throw new HTTPException(404, { message: 'campaign not found' });
    const owner = (await db.select().from(users).where(eq(users.id, campRow.ownerId)))[0];
    if (!owner) throw new HTTPException(404, { message: 'campaign owner not found' });
    const memberRows = await db
      .select({ membership: campaignMemberships, user: users })
      .from(campaignMemberships)
      .innerJoin(users, eq(users.id, campaignMemberships.userId))
      .where(eq(campaignMemberships.campaignId, campaignId));
    const charRows = await db
      .select()
      .from(characters)
      .where(eq(characters.campaignId, campaignId))
      .orderBy(desc(characters.createdAt));
    const out: AdminCampaignDetail = {
      id: campRow.id,
      name: campRow.name,
      description: campRow.description,
      ownerId: campRow.ownerId,
      ownerDisplayName: owner.displayName,
      ownerEmail: owner.email,
      pointTarget: campRow.pointTarget,
      disadvantageCap: campRow.disadvantageCap,
      quirkCap: campRow.quirkCap,
      shareCharacterSheets: campRow.shareCharacterSheets,
      createdAt: campRow.createdAt.toISOString(),
      members: memberRows
        .map(({ membership, user }) => ({
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
          role: membership.role,
          isActive: user.suspendedAt === null,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      characters: charRows.map((ch) => ({
        id: ch.id,
        name: ch.name,
        campaignId: ch.campaignId,
        createdAt: ch.createdAt.toISOString(),
      })),
    };
    return c.json(out, 200);
  },
);

export const adminRouter = router;
