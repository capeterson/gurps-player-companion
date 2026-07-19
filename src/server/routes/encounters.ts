/**
 * Online-only campaign encounter tracker.  Members consume an aggregate
 * projection; owners and managers control live combat state.  Mutations are
 * audited and publish invalidations only, never encounter rows, over WS.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { effectiveDodge } from '../../shared/domain/defenseCalc.ts';
import { advanceTurn, previousTurn } from '../../shared/domain/encounterTurns.ts';
import { effectiveMove } from '../../shared/domain/encumbrance.ts';
import { uuid } from '../../shared/schemas/common.ts';
import {
  advanceRequest,
  combatantCreate,
  combatantOut,
  combatantUpdate,
  effectCreate,
  effectOut,
  effectUpdate,
  encounterCreate,
  encounterOut,
  encounterUpdate,
} from '../../shared/schemas/encounter.ts';
import type { CombatantCreate } from '../../shared/schemas/encounter.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { requireCampaignAdmin, requireCampaignMember } from '../auth/permissions.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  type DbEncounter,
  type DbEncounterCombatant,
  type DbEncounterEffect,
  campaignMemberships,
  campaigns,
  characters,
  encounterCombatants,
  encounterEffects,
  encounters,
} from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { loadCharacterDetail } from '../services/characterSummary.ts';
import { buildPatchSet } from '../services/patchSet.ts';
import { publish } from '../services/wsBus.ts';

const router = createOpenApiApp();
router.use('/campaigns/*/encounters', requireActiveUser);
router.use('/campaigns/*/encounters/*', requireActiveUser);

function canViewCombatant(row: DbEncounterCombatant, isAdmin: boolean) {
  if (!isAdmin && row.kind === 'npc' && row.hiddenFromPlayers) return false;
  return true;
}

function outCombatant(
  row: DbEncounterCombatant,
  isAdmin: boolean,
  canManageCharacters: boolean,
  shareCharacterSheets: boolean,
  ownedCharacterIds: ReadonlySet<string>,
) {
  if (!canViewCombatant(row, isAdmin)) return null;
  // Masking follows the same share gate as `decideCharacterAccess`: a manager
  // without `allowGmCharacterEditing` gets the minimal view here just like the
  // character detail/list/sync surfaces, even though they are otherwise admins.
  const maskCharacterCombat =
    !canManageCharacters &&
    !shareCharacterSheets &&
    row.kind === 'pc' &&
    !ownedCharacterIds.has(row.characterId ?? '');
  return {
    id: row.id,
    encounterId: row.encounterId,
    kind: row.kind,
    characterId: row.characterId,
    name: row.name,
    basicSpeed: maskCharacterCombat
      ? null
      : row.basicSpeed === null
        ? null
        : Number(row.basicSpeed),
    dx: maskCharacterCombat ? null : row.dx,
    orderKey: Number(row.orderKey),
    active: row.active,
    maxHp: maskCharacterCombat ? null : row.maxHp,
    currentHp: maskCharacterCombat ? null : row.currentHp,
    move: maskCharacterCombat ? null : row.move,
    dodge: maskCharacterCombat ? null : row.dodge,
    dr: maskCharacterCombat ? null : row.dr,
    maneuver: maskCharacterCombat ? null : row.maneuver,
    conditions: maskCharacterCombat ? [] : row.conditions,
    hiddenFromPlayers: isAdmin ? row.hiddenFromPlayers : false,
    notes: isAdmin ? row.notes : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function outEffect(row: DbEncounterEffect) {
  return {
    id: row.id,
    encounterId: row.encounterId,
    targetCombatantId: row.targetCombatantId,
    casterCombatantId: row.casterCombatantId,
    createdById: row.createdById,
    name: row.name,
    duration: row.duration,
    startedAtRound: row.startedAtRound,
    maintenanceCost: row.maintenanceCost,
    lastMaintainedRound: row.lastMaintainedRound,
    expiryAcknowledgedAtRound: row.expiryAcknowledgedAtRound,
    linkedCondition: row.linkedCondition,
    linkedTempEffectId: row.linkedTempEffectId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadEncounter(campaignId: string, encounterId: string) {
  const row = (
    await getDb()
      .select()
      .from(encounters)
      .where(and(eq(encounters.id, encounterId), eq(encounters.campaignId, campaignId)))
  )[0];
  if (!row) throw new HTTPException(404, { message: 'encounter not found' });
  return row;
}

export async function projectEncounterForViewer(
  row: DbEncounter,
  userId: string,
  isAdmin: boolean,
  canManageCharacters: boolean,
) {
  const db = getDb();
  const [[campaign], combatants, effects] = await Promise.all([
    db
      .select({ shareCharacterSheets: campaigns.shareCharacterSheets })
      .from(campaigns)
      .where(eq(campaigns.id, row.campaignId)),
    db
      .select()
      .from(encounterCombatants)
      .where(eq(encounterCombatants.encounterId, row.id))
      .orderBy(asc(encounterCombatants.orderKey), asc(encounterCombatants.createdAt)),
    db.select().from(encounterEffects).where(eq(encounterEffects.encounterId, row.id)),
  ]);
  if (!campaign) throw new HTTPException(404, { message: 'campaign not found' });
  const pcCharacterIds = combatants.flatMap((combatant) =>
    combatant.kind === 'pc' && combatant.characterId ? [combatant.characterId] : [],
  );
  // Managers/owners with character access never mask, so the ownership lookup
  // only matters for viewers subject to the share gate.
  const ownedCharacterIds =
    canManageCharacters || campaign.shareCharacterSheets || pcCharacterIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ id: characters.id })
              .from(characters)
              .where(and(eq(characters.ownerId, userId), inArray(characters.id, pcCharacterIds)))
          ).map((character) => character.id),
        );
  const visible = combatants
    .map((combatant) =>
      outCombatant(
        combatant,
        isAdmin,
        canManageCharacters,
        campaign.shareCharacterSheets,
        ownedCharacterIds,
      ),
    )
    .filter((combatant): combatant is NonNullable<typeof combatant> => combatant !== null);
  const visibleIds = new Set(visible.map((combatant) => combatant.id));
  return {
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    status: row.status,
    round: row.round,
    // This remains an opaque turn-state token even when its combatant is hidden.
    // The hidden row and every effect targeting it are still excluded below.
    activeCombatantId: row.activeCombatantId,
    version: row.version,
    endedAt: row.endedAt?.toISOString() ?? null,
    combatants: visible,
    effects: effects
      .filter((effect) => visibleIds.has(effect.targetCombatantId))
      .map((effect) => ({
        ...outEffect(effect),
        // Do not reveal a hidden NPC's stable combatant id through an effect.
        casterCombatantId: visibleIds.has(effect.casterCombatantId ?? '')
          ? effect.casterCombatantId
          : null,
      })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function invalidateEncounter(campaignId: string, encounterId: string) {
  const memberships = await getDb()
    .select({ userId: campaignMemberships.userId })
    .from(campaignMemberships)
    .where(eq(campaignMemberships.campaignId, campaignId));
  const owner = (
    await getDb()
      .select({ ownerId: campaigns.ownerId })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
  )[0];
  const recipients = new Set(memberships.map((membership) => membership.userId));
  if (owner) recipients.add(owner.ownerId);
  for (const userId of recipients) {
    publish(userId, {
      kind: 'encounter_invalidate',
      campaignId,
      encounterId,
      emittedAt: new Date().toISOString(),
    });
  }
}

async function touchEncounter(
  tx: Parameters<Parameters<typeof withAudit>[2]>[0],
  encounterId: string,
) {
  await tx
    .update(encounters)
    .set({ version: sql`${encounters.version} + 1`, updatedAt: new Date() })
    .where(eq(encounters.id, encounterId));
}

function isAdmin(role: string) {
  return role === 'owner' || role === 'manager';
}

/**
 * Whether the viewer may see other players' copied combat stats.  Mirrors
 * `decideCharacterAccess`: owners always can; managers only when the campaign
 * enables GM character editing.  Members fall back to the share gate / ownership
 * checks in `outCombatant`.
 */
function canManageCharacters(role: string, allowGmCharacterEditing: boolean) {
  return role === 'owner' || (role === 'manager' && allowGmCharacterEditing);
}

async function pcValues(characterId: string, campaignId: string) {
  const detail = await loadCharacterDetail(characterId);
  if (detail.campaignId !== campaignId) {
    throw new HTTPException(422, { message: 'PC must belong to this campaign' });
  }
  return {
    kind: 'pc' as const,
    characterId,
    name: detail.name,
    basicSpeed: String(detail.derived.basicSpeed),
    dx: detail.derived.effectiveDx,
    maxHp: detail.derived.hp,
    currentHp: detail.combat?.currentHp ?? detail.derived.hp,
    move: effectiveMove(detail.derived.basicMove, detail.encumbrance),
    dodge: effectiveDodge(detail.derived.dodge, detail.encumbrance.dodgePenalty),
    conditions: detail.combat?.conditions ?? [],
    maneuver: detail.combat?.maneuver ?? null,
  };
}

function assertUniquePcCombatants(combatants: readonly CombatantCreate[]) {
  const characterIds = combatants.flatMap((combatant) =>
    combatant.kind === 'pc' ? [combatant.characterId] : [],
  );
  if (new Set(characterIds).size !== characterIds.length)
    throw new HTTPException(422, { message: 'PC is already a combatant in this encounter' });
}

function npcValues(
  body: Extract<CombatantCreate, { kind: 'npc' }>,
  encounterId: string,
  orderKey: string,
) {
  return {
    encounterId,
    kind: 'npc' as const,
    characterId: null,
    name: body.name,
    basicSpeed: String(body.basicSpeed),
    dx: body.dx,
    orderKey,
    currentHp: body.currentHp ?? body.maxHp,
    maxHp: body.maxHp,
    move: body.move ?? null,
    dodge: body.dodge ?? null,
    dr: body.dr ?? null,
    hiddenFromPlayers: body.hiddenFromPlayers ?? false,
    notes: body.notes ?? null,
    maneuver: body.maneuver ?? null,
    conditions: body.conditions ?? [],
    active: body.active ?? true,
  };
}

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns/{id}/encounters',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid }) },
    responses: {
      200: {
        description: 'Encounter aggregates',
        content: { 'application/json': { schema: z.array(encounterOut) } },
      },
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const access = await requireCampaignMember(id, user.id);
    const rows = await getDb()
      .select()
      .from(encounters)
      .where(eq(encounters.campaignId, id))
      .orderBy(asc(encounters.createdAt));
    return c.json(
      await Promise.all(
        rows.map((row) =>
          projectEncounterForViewer(
            row,
            user.id,
            isAdmin(access.role),
            canManageCharacters(access.role, access.campaign.allowGmCharacterEditing),
          ),
        ),
      ),
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'get',
    path: '/campaigns/{id}/encounters/{encounterId}',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid, encounterId: uuid }) },
    responses: {
      200: {
        description: 'Encounter aggregate',
        content: { 'application/json': { schema: encounterOut } },
      },
      404: errorResponse('Not found'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, encounterId } = c.req.valid('param');
    const access = await requireCampaignMember(id, user.id);
    return c.json(
      await projectEncounterForViewer(
        await loadEncounter(id, encounterId),
        user.id,
        isAdmin(access.role),
        canManageCharacters(access.role, access.campaign.allowGmCharacterEditing),
      ),
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/encounters',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid }),
      body: { required: true, content: { 'application/json': { schema: encounterCreate } } },
    },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: encounterOut } } },
      403: errorResponse('Forbidden'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const access = await requireCampaignAdmin(id, user.id);
    assertUniquePcCombatants(body.combatants);
    const rows = await Promise.all(
      body.combatants.map(async (combatant, index) => {
        const orderKey = String((index + 1) * 10);
        return combatant.kind === 'pc'
          ? { ...(await pcValues(combatant.characterId, id)), orderKey }
          : npcValues(combatant, '', orderKey);
      }),
    );
    const created = await withAudit(user.id, undefined, async (tx) => {
      const [encounter] = await tx
        .insert(encounters)
        .values({ campaignId: id, name: body.name ?? 'Encounter' })
        .returning();
      if (!encounter) throw new HTTPException(500, { message: 'insert failed' });
      if (rows.length)
        await tx
          .insert(encounterCombatants)
          .values(rows.map((row) => ({ ...row, encounterId: encounter.id })));
      return encounter;
    });
    await invalidateEncounter(id, created.id);
    return c.json(
      await projectEncounterForViewer(
        created,
        user.id,
        true,
        canManageCharacters(access.role, access.campaign.allowGmCharacterEditing),
      ),
      201,
    );
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/campaigns/{id}/encounters/{encounterId}',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid, encounterId: uuid }),
      body: { required: true, content: { 'application/json': { schema: encounterUpdate } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: encounterOut } } },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, encounterId } = c.req.valid('param');
    const body = c.req.valid('json');
    const access = await requireCampaignAdmin(id, user.id);
    await loadEncounter(id, encounterId);
    if (body.activeCombatantId) await assertCombatantsBelong(encounterId, [body.activeCombatantId]);
    const endedAt =
      body.status === 'ended' ? new Date() : body.status === 'active' ? null : undefined;
    const updated = await withAudit(user.id, undefined, async (tx) => {
      const [row] = await tx
        .update(encounters)
        .set({
          ...buildPatchSet(body),
          ...(endedAt === undefined ? {} : { endedAt }),
          version: sql`${encounters.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(encounters.id, encounterId))
        .returning();
      if (!row) throw new HTTPException(500, { message: 'update failed' });
      return row;
    });
    await invalidateEncounter(id, encounterId);
    return c.json(
      await projectEncounterForViewer(
        updated,
        user.id,
        true,
        canManageCharacters(access.role, access.campaign.allowGmCharacterEditing),
      ),
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/encounters/{encounterId}/advance',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid, encounterId: uuid }),
      body: { required: true, content: { 'application/json': { schema: advanceRequest } } },
    },
    responses: {
      200: { description: 'Advanced', content: { 'application/json': { schema: encounterOut } } },
      409: errorResponse('Turn state changed'),
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, encounterId } = c.req.valid('param');
    const body = c.req.valid('json');
    const access = await requireCampaignAdmin(id, user.id);
    const encounter = await loadEncounter(id, encounterId);
    if (encounter.status === 'ended')
      throw new HTTPException(409, { message: 'encounter has ended; refresh encounter' });
    const combatants = await getDb()
      .select()
      .from(encounterCombatants)
      .where(eq(encounterCombatants.encounterId, encounterId));
    const turns = combatants.map((combatant) => ({
      id: combatant.id,
      orderKey: Number(combatant.orderKey),
      active: combatant.active,
    }));
    const state =
      body.direction === 'next'
        ? advanceTurn(
            { round: body.expectedRound, activeCombatantId: body.expectedActiveCombatantId },
            turns,
          )
        : previousTurn(
            { round: body.expectedRound, activeCombatantId: body.expectedActiveCombatantId },
            turns,
          );
    const activeMatch =
      body.expectedActiveCombatantId === null
        ? isNull(encounters.activeCombatantId)
        : eq(encounters.activeCombatantId, body.expectedActiveCombatantId);
    const updated = await withAudit(
      user.id,
      undefined,
      async (tx) =>
        (
          await tx
            .update(encounters)
            .set({
              round: state.round,
              activeCombatantId: state.activeCombatantId,
              version: sql`${encounters.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(encounters.id, encounter.id),
                eq(encounters.status, 'active'),
                eq(encounters.round, body.expectedRound),
                activeMatch,
                eq(encounters.version, body.expectedVersion),
              ),
            )
            .returning()
        )[0],
    );
    if (!updated)
      throw new HTTPException(409, { message: 'turn state changed; refresh encounter' });
    await invalidateEncounter(id, encounterId);
    return c.json(
      await projectEncounterForViewer(
        updated,
        user.id,
        true,
        canManageCharacters(access.role, access.campaign.allowGmCharacterEditing),
      ),
      200,
    );
  },
);

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/encounters/{encounterId}/combatants',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid, encounterId: uuid }),
      body: { required: true, content: { 'application/json': { schema: combatantCreate } } },
    },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: combatantOut } } },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, encounterId } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignAdmin(id, user.id);
    await loadEncounter(id, encounterId);
    const existing = await getDb()
      .select({
        orderKey: encounterCombatants.orderKey,
        characterId: encounterCombatants.characterId,
      })
      .from(encounterCombatants)
      .where(eq(encounterCombatants.encounterId, encounterId))
      .orderBy(asc(encounterCombatants.orderKey));
    const orderKey = String((Number(existing.at(-1)?.orderKey ?? 0) || 0) + 10);
    if (
      body.kind === 'pc' &&
      existing.some((combatant) => combatant.characterId === body.characterId)
    )
      throw new HTTPException(422, { message: 'PC is already a combatant in this encounter' });
    const values =
      body.kind === 'pc'
        ? { ...(await pcValues(body.characterId, id)), encounterId, orderKey }
        : npcValues(body, encounterId, orderKey);
    let row: DbEncounterCombatant;
    try {
      row = await withAudit(user.id, undefined, async (tx) => {
        const [created] = await tx.insert(encounterCombatants).values(values).returning();
        if (!created) throw new HTTPException(500, { message: 'insert failed' });
        await touchEncounter(tx, encounterId);
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'encounter_combatants_pc_character_key'))
        throw new HTTPException(409, { message: 'PC is already a combatant in this encounter' });
      throw error;
    }
    await invalidateEncounter(id, encounterId);
    const projected = outCombatant(row, true, true, true, new Set());
    if (!projected) throw new HTTPException(500, { message: 'combatant projection failed' });
    return c.json(projected, 201);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/campaigns/{id}/encounters/{encounterId}/combatants/{combatantId}',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid, encounterId: uuid, combatantId: uuid }),
      body: { required: true, content: { 'application/json': { schema: combatantUpdate } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: combatantOut } } },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, encounterId, combatantId } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignAdmin(id, user.id);
    await loadEncounter(id, encounterId);
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [updated] = await tx
        .update(encounterCombatants)
        .set({ ...buildPatchSet(body), updatedAt: new Date() })
        .where(
          and(
            eq(encounterCombatants.id, combatantId),
            eq(encounterCombatants.encounterId, encounterId),
          ),
        )
        .returning();
      if (!updated) throw new HTTPException(404, { message: 'combatant not found' });
      // Deactivating the acting combatant must also drop the stale active-turn
      // token so the tracker never renders an inactive combatant as "Acting".
      if (body.active === false) {
        await tx
          .update(encounters)
          .set({
            activeCombatantId: sql`case when ${encounters.activeCombatantId} = ${combatantId} then null else ${encounters.activeCombatantId} end`,
            version: sql`${encounters.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(encounters.id, encounterId));
      } else {
        await touchEncounter(tx, encounterId);
      }
      return updated;
    });
    await invalidateEncounter(id, encounterId);
    const projected = outCombatant(row, true, true, true, new Set());
    if (!projected) throw new HTTPException(500, { message: 'combatant projection failed' });
    return c.json(projected, 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/campaigns/{id}/encounters/{encounterId}/combatants/{combatantId}',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid, encounterId: uuid, combatantId: uuid }) },
    responses: { 204: { description: 'Deleted' } },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, encounterId, combatantId } = c.req.valid('param');
    await requireCampaignAdmin(id, user.id);
    await loadEncounter(id, encounterId);
    await withAudit(user.id, undefined, async (tx) => {
      const deleted = await tx
        .delete(encounterCombatants)
        .where(
          and(
            eq(encounterCombatants.id, combatantId),
            eq(encounterCombatants.encounterId, encounterId),
          ),
        )
        .returning();
      if (!deleted[0]) throw new HTTPException(404, { message: 'combatant not found' });
      await tx
        .update(encounters)
        .set({
          activeCombatantId: sql`case when ${encounters.activeCombatantId} = ${combatantId} then null else ${encounters.activeCombatantId} end`,
          version: sql`${encounters.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(encounters.id, encounterId));
    });
    await invalidateEncounter(id, encounterId);
    return c.body(null, 204);
  },
);

async function assertCombatantsBelong(encounterId: string, ids: string[]) {
  const rows = await getDb()
    .select({ id: encounterCombatants.id })
    .from(encounterCombatants)
    .where(
      and(eq(encounterCombatants.encounterId, encounterId), inArray(encounterCombatants.id, ids)),
    );
  if (rows.length !== new Set(ids).size)
    throw new HTTPException(422, { message: 'effect combatant must belong to encounter' });
}

router.openapi(
  createRoute({
    method: 'post',
    path: '/campaigns/{id}/encounters/{encounterId}/effects',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid, encounterId: uuid }),
      body: { required: true, content: { 'application/json': { schema: effectCreate } } },
    },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: effectOut } } },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, encounterId } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignAdmin(id, user.id);
    const encounter = await loadEncounter(id, encounterId);
    await assertCombatantsBelong(encounterId, [
      body.targetCombatantId,
      ...(body.casterCombatantId ? [body.casterCombatantId] : []),
    ]);
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [created] = await tx
        .insert(encounterEffects)
        .values({
          ...body,
          encounterId,
          casterCombatantId: body.casterCombatantId ?? null,
          createdById: user.id,
          startedAtRound: encounter.round,
          maintenanceCost: body.maintenanceCost ?? null,
          linkedCondition: body.linkedCondition ?? null,
          linkedTempEffectId: body.linkedTempEffectId ?? null,
          notes: body.notes ?? null,
        })
        .returning();
      if (!created) throw new HTTPException(500, { message: 'insert failed' });
      await touchEncounter(tx, encounterId);
      return created;
    });
    await invalidateEncounter(id, encounterId);
    return c.json(outEffect(row), 201);
  },
);

router.openapi(
  createRoute({
    method: 'patch',
    path: '/campaigns/{id}/encounters/{encounterId}/effects/{effectId}',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: uuid, encounterId: uuid, effectId: uuid }),
      body: { required: true, content: { 'application/json': { schema: effectUpdate } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: effectOut } } },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, encounterId, effectId } = c.req.valid('param');
    const body = c.req.valid('json');
    await requireCampaignAdmin(id, user.id);
    const encounter = await loadEncounter(id, encounterId);
    if (body.casterCombatantId) await assertCombatantsBelong(encounterId, [body.casterCombatantId]);
    // Round markers are written from the live encounter round; a value past the
    // current round would hide maintenance/expiry prompts for state that has not
    // happened yet, so reject it rather than persist an out-of-range marker.
    for (const marker of [body.lastMaintainedRound, body.expiryAcknowledgedAtRound]) {
      if (marker != null && marker > encounter.round)
        throw new HTTPException(422, {
          message: 'effect round marker cannot exceed current round',
        });
    }
    const row = await withAudit(user.id, undefined, async (tx) => {
      const [updated] = await tx
        .update(encounterEffects)
        .set({ ...buildPatchSet(body), updatedAt: new Date() })
        .where(
          and(eq(encounterEffects.id, effectId), eq(encounterEffects.encounterId, encounterId)),
        )
        .returning();
      if (!updated) throw new HTTPException(404, { message: 'effect not found' });
      await touchEncounter(tx, encounterId);
      return updated;
    });
    await invalidateEncounter(id, encounterId);
    return c.json(outEffect(row), 200);
  },
);

router.openapi(
  createRoute({
    method: 'delete',
    path: '/campaigns/{id}/encounters/{encounterId}/effects/{effectId}',
    tags: ['encounters'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: uuid, encounterId: uuid, effectId: uuid }) },
    responses: { 204: { description: 'Deleted' } },
  }),
  async (c) => {
    const user = c.get('user');
    const { id, encounterId, effectId } = c.req.valid('param');
    await requireCampaignAdmin(id, user.id);
    await loadEncounter(id, encounterId);
    await withAudit(user.id, undefined, async (tx) => {
      const deleted = await tx
        .delete(encounterEffects)
        .where(
          and(eq(encounterEffects.id, effectId), eq(encounterEffects.encounterId, encounterId)),
        )
        .returning();
      if (!deleted[0]) throw new HTTPException(404, { message: 'effect not found' });
      await touchEncounter(tx, encounterId);
    });
    await invalidateEncounter(id, encounterId);
    return c.body(null, 204);
  },
);

export const encounterRouter = router;
