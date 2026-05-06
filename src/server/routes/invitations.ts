/**
 * Campaign invitations API.
 *
 * Mirrors the gurps-player-web flow: an inviter (owner or manager) creates
 * a pending invitation; the invitee accepts (creating membership) or
 * rejects.  Inviting at the manager tier requires owner; managers can
 * only invite at the member tier.
 *
 * Endpoints:
 *   POST   /campaigns/{id}/invitations      — owner|manager creates
 *   GET    /campaigns/{id}/invitations      — owner|manager lists pending
 *   DELETE /campaigns/{id}/invitations/{iid} — owner|manager cancels
 *   GET    /invitations                      — invitee lists their pending
 *   POST   /invitations/{id}/accept          — invitee accepts
 *   POST   /invitations/{id}/reject          — invitee rejects
 *
 * Handles ("invite by email or display name") are resolved by
 * `findUserByHandle` — exact email match wins, then exact display-name
 * match. Both comparisons are case-insensitive.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import { type InvitationOut, invitationOut, inviteRequest } from '../../shared/schemas/campaign.ts';
import { uuid } from '../../shared/schemas/common.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { requireCampaignAdmin } from '../auth/permissions.ts';
import { getDb } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  type DbCampaign,
  type DbCampaignInvitation,
  type DbUser,
  NOTIFICATION_TYPE_CAMPAIGN_INVITATION,
  campaignInvitations,
  campaignMemberships,
  campaigns,
  notifications,
  users,
} from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';

const router = createOpenApiApp();
router.use('/campaigns/*', requireActiveUser);
router.use('/invitations', requireActiveUser);
router.use('/invitations/*', requireActiveUser);

function buildInvitationOut(
  invitation: DbCampaignInvitation,
  campaign: { name: string },
  inviter: { displayName: string },
  invitee: { displayName: string; email: string },
): InvitationOut {
  return {
    id: invitation.id,
    campaignId: invitation.campaignId,
    campaignName: campaign.name,
    inviterId: invitation.inviterId,
    inviterDisplayName: inviter.displayName,
    inviteeId: invitation.inviteeId,
    inviteeDisplayName: invitee.displayName,
    inviteeEmail: invitee.email,
    role: invitation.role,
    status: invitation.status,
    createdAt: invitation.createdAt.toISOString(),
    decidedAt: invitation.decidedAt ? invitation.decidedAt.toISOString() : null,
  };
}

/**
 * One-row hydration used by accept/reject/create endpoints.  List
 * endpoints use the joined query in `listInvitationsJoined` instead.
 */
async function loadInvitationOut(invitationId: string): Promise<InvitationOut | null> {
  const db = getDb();
  const inviterAlias = alias(users, 'inviter');
  const inviteeAlias = alias(users, 'invitee');
  const rows = await db
    .select({
      invitation: campaignInvitations,
      campaign: campaigns,
      inviter: inviterAlias,
      invitee: inviteeAlias,
    })
    .from(campaignInvitations)
    .innerJoin(campaigns, eq(campaigns.id, campaignInvitations.campaignId))
    .innerJoin(inviterAlias, eq(inviterAlias.id, campaignInvitations.inviterId))
    .innerJoin(inviteeAlias, eq(inviteeAlias.id, campaignInvitations.inviteeId))
    .where(eq(campaignInvitations.id, invitationId));
  const row = rows[0];
  if (!row) return null;
  return buildInvitationOut(row.invitation, row.campaign, row.inviter, row.invitee);
}

async function findUserByHandle(handle: string): Promise<DbUser | null> {
  const trimmed = handle.trim();
  if (!trimmed) return null;
  const db = getDb();
  const lowered = trimmed.toLowerCase();
  // Email match first (emails are case-insensitive in practice).
  const byEmail = await db.select().from(users).where(sql`lower(${users.email}) = ${lowered}`);
  if (byEmail[0]) return byEmail[0];
  // Then display-name match (case-insensitive).
  const byName = await db.select().from(users).where(sql`lower(${users.displayName}) = ${lowered}`);
  return byName[0] ?? null;
}

async function membershipRole(
  campaignId: string,
  userId: string,
): Promise<DbCampaign['ownerId'] extends string ? 'owner' | 'member' | 'manager' | null : never> {
  const db = getDb();
  const camp = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (camp[0]?.ownerId === userId) return 'owner';
  const m = await db
    .select()
    .from(campaignMemberships)
    .where(
      and(eq(campaignMemberships.campaignId, campaignId), eq(campaignMemberships.userId, userId)),
    );
  return (m[0]?.role as 'member' | 'manager' | undefined) ?? null;
}

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/invitations',
    tags: ['invitations'],
    summary: 'Create a campaign invitation (owner or manager)',
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: inviteRequest } } },
    },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: invitationOut } },
      },
      400: errorResponse('Invalid'),
      403: errorResponse('Forbidden'),
      404: errorResponse('User not found'),
      409: errorResponse('Already a member or pending invitation exists'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id: campaignId } = c.req.valid('param');
    const body = c.req.valid('json');
    const { campaign, role: actorRole } = await requireCampaignAdmin(campaignId, user.id);

    const requestedRole = body.role ?? 'member';
    if (requestedRole === 'owner') {
      throw new HTTPException(400, {
        message: 'cannot invite as owner; use transfer-ownership instead',
      });
    }
    if (requestedRole === 'manager' && actorRole !== 'owner') {
      throw new HTTPException(403, { message: 'only the owner can invite users as managers' });
    }

    const target = await findUserByHandle(body.handle);
    if (!target) {
      throw new HTTPException(404, {
        message: 'no user matches that email or display name; ask them to sign up first',
      });
    }
    if (target.id === user.id) {
      throw new HTTPException(400, { message: 'you cannot invite yourself' });
    }
    if (target.id === campaign.ownerId) {
      throw new HTTPException(409, { message: 'that user is already the owner of this campaign' });
    }
    const existingRole = await membershipRole(campaignId, target.id);
    if (existingRole !== null && existingRole !== 'owner') {
      throw new HTTPException(409, { message: 'user is already a member of this campaign' });
    }

    let insertedId: string;
    try {
      insertedId = await getDb().transaction(async (tx) => {
        const inserted = await tx
          .insert(campaignInvitations)
          .values({
            campaignId,
            inviterId: user.id,
            inviteeId: target.id,
            role: requestedRole,
            status: 'pending',
          })
          .returning({ id: campaignInvitations.id });
        const row = inserted[0];
        if (!row) throw new HTTPException(500, { message: 'invitation insert returned no row' });
        // Emit a notification for the invitee in the same transaction so
        // a half-applied invitation can never leave a stranded
        // notification (and vice versa).
        await tx.insert(notifications).values({
          userId: target.id,
          type: NOTIFICATION_TYPE_CAMPAIGN_INVITATION,
          relatedId: row.id,
          payload: {
            campaign_id: campaignId,
            campaign_name: campaign.name,
            inviter_id: user.id,
            inviter_display_name: user.displayName,
            role: requestedRole,
          },
        });
        return row.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HTTPException(409, {
          message: 'there is already a pending invitation for that user',
        });
      }
      throw err;
    }

    const out = await loadInvitationOut(insertedId);
    if (!out) throw new HTTPException(500, { message: 'invitation vanished' });
    return c.json(out, 201);
  },
);

/**
 * Mark every still-unread notification tied to this invitation as read.
 * Called when an invitation is cancelled, accepted, or rejected so the
 * invitee's bell doesn't keep showing a stale Accept/Decline pair.
 */
async function markInvitationNotificationsRead(invitationId: string): Promise<void> {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notifications.relatedId, invitationId), isNull(notifications.readAt)));
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns/{id}/invitations',
    tags: ['invitations'],
    summary: 'List pending invitations for a campaign (owner or manager)',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: {
        description: 'List',
        content: { 'application/json': { schema: z.array(invitationOut) } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id: campaignId } = c.req.valid('param');
    await requireCampaignAdmin(campaignId, user.id);
    const db = getDb();
    const inviterAlias = alias(users, 'inviter');
    const inviteeAlias = alias(users, 'invitee');
    const rows = await db
      .select({
        invitation: campaignInvitations,
        campaign: campaigns,
        inviter: inviterAlias,
        invitee: inviteeAlias,
      })
      .from(campaignInvitations)
      .innerJoin(campaigns, eq(campaigns.id, campaignInvitations.campaignId))
      .innerJoin(inviterAlias, eq(inviterAlias.id, campaignInvitations.inviterId))
      .innerJoin(inviteeAlias, eq(inviteeAlias.id, campaignInvitations.inviteeId))
      .where(
        and(
          eq(campaignInvitations.campaignId, campaignId),
          eq(campaignInvitations.status, 'pending'),
        ),
      );
    const out = rows.map((r) => buildInvitationOut(r.invitation, r.campaign, r.inviter, r.invitee));
    return c.json(out, 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/campaigns/{id}/invitations/{invitationId}',
    tags: ['invitations'],
    summary: 'Cancel a pending invitation (owner or manager)',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid, invitationId: uuid }) },
    responses: {
      204: { description: 'Cancelled' },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
      409: errorResponse('Already decided'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id: campaignId, invitationId } = c.req.valid('param');
    await requireCampaignAdmin(campaignId, user.id);
    const db = getDb();
    const existing = await db
      .select()
      .from(campaignInvitations)
      .where(
        and(
          eq(campaignInvitations.id, invitationId),
          eq(campaignInvitations.campaignId, campaignId),
        ),
      );
    const row = existing[0];
    if (!row) throw new HTTPException(404, { message: 'invitation not found' });
    if (row.status !== 'pending') {
      throw new HTTPException(409, { message: `invitation is ${row.status}, not pending` });
    }
    // Conditional update: another decider (accept / reject / a parallel
    // cancel) may have flipped the row between the read above and this
    // write. Including `status='pending'` in the predicate makes the
    // update atomic; a zero-row result means we lost the race.
    const updated = await db
      .update(campaignInvitations)
      .set({ status: 'cancelled', decidedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(campaignInvitations.id, invitationId), eq(campaignInvitations.status, 'pending')),
      )
      .returning({ id: campaignInvitations.id });
    if (updated.length === 0) {
      throw new HTTPException(409, { message: 'invitation already decided' });
    }
    await markInvitationNotificationsRead(invitationId);
    return c.body(null, 204);
  },
);

router.openapi(
  createRoute({
    method: 'get',
    path: '/invitations',
    tags: ['invitations'],
    summary: 'List the current user’s pending invitations',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'List',
        content: { 'application/json': { schema: z.array(invitationOut) } },
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const db = getDb();
    const inviterAlias = alias(users, 'inviter');
    const inviteeAlias = alias(users, 'invitee');
    const rows = await db
      .select({
        invitation: campaignInvitations,
        campaign: campaigns,
        inviter: inviterAlias,
        invitee: inviteeAlias,
      })
      .from(campaignInvitations)
      .innerJoin(campaigns, eq(campaigns.id, campaignInvitations.campaignId))
      .innerJoin(inviterAlias, eq(inviterAlias.id, campaignInvitations.inviterId))
      .innerJoin(inviteeAlias, eq(inviteeAlias.id, campaignInvitations.inviteeId))
      .where(
        and(eq(campaignInvitations.inviteeId, user.id), eq(campaignInvitations.status, 'pending')),
      );
    const out = rows.map((r) => buildInvitationOut(r.invitation, r.campaign, r.inviter, r.invitee));
    return c.json(out, 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/invitations/{invitationId}/accept',
    tags: ['invitations'],
    summary: 'Accept an invitation; creates membership at the invited role',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ invitationId: uuid }) },
    responses: {
      200: {
        description: 'Accepted',
        content: { 'application/json': { schema: invitationOut } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
      409: errorResponse('Already decided'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { invitationId } = c.req.valid('param');
    const db = getDb();
    const existingRows = await db
      .select()
      .from(campaignInvitations)
      .where(eq(campaignInvitations.id, invitationId));
    const invitation = existingRows[0];
    if (!invitation) throw new HTTPException(404, { message: 'invitation not found' });
    if (invitation.inviteeId !== user.id) {
      throw new HTTPException(403, { message: 'not the invitee' });
    }
    if (invitation.status !== 'pending') {
      throw new HTTPException(409, {
        message: `invitation is ${invitation.status}, not pending`,
      });
    }
    // Wrap the whole accept flow in a transaction.  We start with
    // SELECT ... FOR UPDATE to acquire a row-level write lock — any
    // concurrent decider (accept / reject / cancel) blocks until we
    // commit, then re-reads and observes the new terminal status.
    // The conditional UPDATE on top is belt-and-braces (and lets the
    // 0-rows return short-circuit cleanly if a writer somehow snuck in).
    const flipped = await db.transaction(async (tx) => {
      const lockedRows = await tx
        .select()
        .from(campaignInvitations)
        .where(eq(campaignInvitations.id, invitationId))
        .for('update');
      const locked = lockedRows[0];
      if (!locked || locked.status !== 'pending') return false;

      await tx
        .update(campaignInvitations)
        .set({ status: 'accepted', decidedAt: new Date(), updatedAt: new Date() })
        .where(eq(campaignInvitations.id, invitationId));

      // Existing membership wins on conflict — we patch its role to the
      // invited role if they differ.
      const existingMember = await tx
        .select()
        .from(campaignMemberships)
        .where(
          and(
            eq(campaignMemberships.campaignId, invitation.campaignId),
            eq(campaignMemberships.userId, user.id),
          ),
        );
      if (existingMember[0]) {
        if (existingMember[0].role !== invitation.role) {
          await tx
            .update(campaignMemberships)
            .set({ role: invitation.role, updatedAt: new Date() })
            .where(eq(campaignMemberships.id, existingMember[0].id));
        }
      } else {
        await tx.insert(campaignMemberships).values({
          campaignId: invitation.campaignId,
          userId: user.id,
          role: invitation.role,
        });
      }
      return true;
    });
    if (!flipped) {
      throw new HTTPException(409, { message: 'invitation already decided' });
    }
    await markInvitationNotificationsRead(invitationId);
    const out = await loadInvitationOut(invitationId);
    if (!out) throw new HTTPException(500, { message: 'invitation vanished' });
    return c.json(out, 200);
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/invitations/{invitationId}/reject',
    tags: ['invitations'],
    summary: 'Reject an invitation',
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ invitationId: uuid }) },
    responses: {
      200: {
        description: 'Rejected',
        content: { 'application/json': { schema: invitationOut } },
      },
      403: errorResponse('Forbidden'),
      404: errorResponse('Not found'),
      409: errorResponse('Already decided'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { invitationId } = c.req.valid('param');
    const db = getDb();
    const existingRows = await db
      .select()
      .from(campaignInvitations)
      .where(eq(campaignInvitations.id, invitationId));
    const invitation = existingRows[0];
    if (!invitation) throw new HTTPException(404, { message: 'invitation not found' });
    if (invitation.inviteeId !== user.id) {
      throw new HTTPException(403, { message: 'not the invitee' });
    }
    if (invitation.status !== 'pending') {
      throw new HTTPException(409, {
        message: `invitation is ${invitation.status}, not pending`,
      });
    }
    // Same conditional-update pattern as cancel/accept: zero rows means
    // a parallel decision already terminated the invitation.
    const updated = await db
      .update(campaignInvitations)
      .set({ status: 'rejected', decidedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(campaignInvitations.id, invitationId), eq(campaignInvitations.status, 'pending')),
      )
      .returning({ id: campaignInvitations.id });
    if (updated.length === 0) {
      throw new HTTPException(409, { message: 'invitation already decided' });
    }
    await markInvitationNotificationsRead(invitationId);
    const out = await loadInvitationOut(invitationId);
    if (!out) throw new HTTPException(500, { message: 'invitation vanished' });
    return c.json(out, 200);
  },
);

// Touch unused imports so biome doesn't trip on them once the file
// stabilises (`or` reserved for future or-of-status filters).
export const _ = { or };
export const invitationsRouter = router;
