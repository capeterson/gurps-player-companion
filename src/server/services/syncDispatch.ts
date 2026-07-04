/**
 * Per-operation dispatcher for /api/v1/sync/operations.
 *
 * Each client OperationEnvelope is mapped to a service function that
 * applies it to Postgres inside its own transaction.  Failures are
 * caught and returned as outcomes (rejected | unauthorized | conflict
 * | stale_base | transient) so a single bad op never poisons the rest
 * of the batch.
 *
 * Field-level patches are validated against per-entity-class
 * `WRITABLE_FIELDS` whitelists.  We carve per-field Zod parsers from
 * the existing `xxxUpdate.shape[field]` definitions in
 * `src/shared/schemas/*.ts` so the sync path enforces the exact same
 * constraints as the legacy CRUD routes.
 *
 * Every write runs inside withAudit() (src/server/db/auditContext.ts)
 * which sets the transaction-local session GUCs app.actor_id and
 * app.batch_id before the write.  The entity_history triggers read
 * those GUCs so every history row is properly attributed.
 */

import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { computeDerived } from '../../shared/domain/characterCalc.ts';
import { characterCreate, characterUpdate } from '../../shared/schemas/character.ts';
import { combatStateUpdate } from '../../shared/schemas/combat.ts';
import { inventoryItemCreate, inventoryItemUpdate } from '../../shared/schemas/inventory.ts';
import { skillCreate, skillUpdate } from '../../shared/schemas/skill.ts';
import { spellCreate, spellUpdate } from '../../shared/schemas/spell.ts';
import type {
  EntityClass,
  OperationEnvelope,
  OperationOutcome,
} from '../../shared/schemas/sync.ts';
import { traitCreate, traitUpdate } from '../../shared/schemas/trait.ts';
import { assertWrite, loadCampaignOr403, loadCharacterOr403 } from '../auth/permissions.ts';
import { type AuditTx, withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  campaignMemberships,
  campaigns,
  characterSkills,
  characterSpells,
  characterTraits,
  characters,
  combatStates,
  inventoryItems,
} from '../db/schema.ts';
import { characterAttrsFromRow } from './characterSummary.ts';
import { publish as wsPublish } from './wsBus.ts';

/**
 * Per-entity field whitelist.  Each entry is the partial Zod object
 * whose `.shape[field]` we use to parse the incoming `attemptedValue`.
 * This is intentionally narrow: any field path the user could send
 * that isn't enumerated below comes back as `rejected` with reason
 * "field not writable".
 */
const FIELD_VALIDATORS = {
  character: characterUpdate,
  character_trait: traitUpdate,
  character_skill: skillUpdate,
  character_spell: spellUpdate,
  character_inventory: inventoryItemUpdate,
  character_combat: combatStateUpdate,
} as const;

type WritableEntityClass = keyof typeof FIELD_VALIDATORS;

const WRITABLE_FOR_PATCH: Record<EntityClass, readonly string[] | null> = {
  character: Object.keys(characterUpdate.shape) as readonly string[],
  character_trait: Object.keys(traitUpdate.shape) as readonly string[],
  character_skill: Object.keys(skillUpdate.shape) as readonly string[],
  character_spell: Object.keys(spellUpdate.shape) as readonly string[],
  character_inventory: Object.keys(inventoryItemUpdate.shape) as readonly string[],
  character_combat: Object.keys(combatStateUpdate.shape) as readonly string[],
  // Not yet exposed via /sync (no client UI mutations today).
  campaign: null,
  campaign_membership: null,
  campaign_library_trait: null,
  campaign_library_skill: null,
  campaign_library_spell: null,
  campaign_library_item: null,
  adventure_log: null,
};

const NUMERIC_INVENTORY_FIELDS = new Set(['weightLbs', 'cost', 'hideawayCapacityLbs']);

interface DispatchContext {
  readonly userId: string;
  readonly batchId?: string | undefined;
}

/** Entity classes that have a write dispatcher below. */
const DISPATCHABLE_CLASSES = new Set<EntityClass>([
  'character',
  'character_trait',
  'character_skill',
  'character_spell',
  'character_inventory',
  'character_combat',
]);

/**
 * Rejections that need no DB access at all.  Returned before opening the
 * withAudit transaction so an unsupported op (or a delete on the
 * non-deletable combat state) never checks out a pooled connection.  The
 * matching branches inside dispatchOperationInner stay as defensive
 * duplicates.
 */
function dbFreeRejection(op: OperationEnvelope): OperationOutcome | null {
  if (!DISPATCHABLE_CLASSES.has(op.entityClass)) {
    return {
      clientOpId: op.clientOpId,
      status: 'rejected',
      reason: `entity class ${op.entityClass} not yet supported by /sync`,
    };
  }
  if (op.entityClass === 'character_combat' && op.command === 'delete') {
    return {
      clientOpId: op.clientOpId,
      status: 'rejected',
      reason: 'combat state is not deletable',
    };
  }
  return null;
}

/**
 * Apply one operation.  Returns the outcome — never throws.
 * The shape mirrors what the client outbox needs to advance state:
 * `applied` carries the new `revision`; `rejected | unauthorized` carry
 * a reason; `stale_base | conflict` may carry the latest server entity.
 */
export async function dispatchOperation(
  ctx: DispatchContext,
  op: OperationEnvelope,
): Promise<OperationOutcome> {
  // Reject DB-free cases before opening a transaction so they don't
  // borrow a pooled connection just to roll back.
  const early = dbFreeRejection(op);
  if (early) return early;

  // Use the op's batchId if present, fall back to clientOpId so even
  // singleton edits have a stable non-null batch_id in entity_history.
  const batchId = op.batchId ?? op.clientOpId;
  try {
    const outcome = await withAudit(ctx.userId, batchId, (tx) =>
      dispatchOperationInner({ ...ctx, batchId }, op, tx),
    );
    if (outcome.status === 'applied') {
      // Wake the actor's other tabs/devices AND every other user who
      // can see the affected character (owner, campaign GM, campaign
      // members) so a GM editing a player's sheet -- or vice versa --
      // doesn't wait up to 30s for the periodic pull.  WS messages
      // carry no row data (rule S8) — every recipient still reconciles
      // via /sync/cursor.
      await publishSyncInvalidation(ctx.userId, op);
    }
    return outcome;
  } catch (err) {
    if (err instanceof HTTPException) {
      // 403 / 404 → unauthorized (the client doesn't get to see the
      // distinction; "you can't touch this" is the only useful signal).
      if (err.status === 403 || err.status === 404) {
        return { clientOpId: op.clientOpId, status: 'unauthorized', reason: err.message };
      }
      if (err.status === 422 || err.status === 400) {
        return { clientOpId: op.clientOpId, status: 'rejected', reason: err.message };
      }
    }
    if (err instanceof z.ZodError) {
      return {
        clientOpId: op.clientOpId,
        status: 'rejected',
        reason: err.issues[0]?.message ?? 'invalid value',
      };
    }
    if (isUniqueViolation(err)) {
      // A `create` hitting a unique violation is very often the client
      // replaying an op whose ack got lost (crash / network drop after
      // the server applied it).  Treating that as a conflict makes the
      // client roll back — deleting its perfectly good local row.  If
      // the row with the client's id already exists and the user may
      // write it, the create already happened: report `applied` with
      // the current revision so the replay settles idempotently.
      if (op.command === 'create') {
        const replayed = await resolveReplayedCreate(ctx.userId, op);
        if (replayed) return replayed;
      }
      return { clientOpId: op.clientOpId, status: 'conflict', reason: 'unique constraint' };
    }
    // Network / serialization / unexpected: tell the client to retry.
    return {
      clientOpId: op.clientOpId,
      status: 'transient',
      reason: err instanceof Error ? err.message : 'transient error',
    };
  }
}

/**
 * Fan out a `sync_invalidate` WS nudge to every user who can see the
 * change: the actor (their other tabs/devices), the character's owner,
 * the campaign owner (GM), and campaign members when the character
 * belongs to a campaign.
 *
 * Resolves the character id for the op (entityId for `character`,
 * `requireParentId` for child classes) and does at most one query for
 * the character row and one for campaign owner+members.  Both the
 * parent-id resolution and the queries are wrapped so a failure here
 * (deleted character, missing parentId, DB hiccup) can never affect the
 * outcome already returned to the client — WS is acceleration only
 * (rule S8).  When the character row can't be resolved (e.g. it was
 * just deleted), we fall back to publishing to the actor alone; other
 * members converge via the periodic pull plus the accessible-set prune.
 */
async function publishSyncInvalidation(actorId: string, op: OperationEnvelope): Promise<void> {
  const recipients = new Set<string>([actorId]);
  if (DISPATCHABLE_CLASSES.has(op.entityClass)) {
    try {
      const characterId = op.entityClass === 'character' ? op.entityId : requireParentId(op);
      const db = getDb();
      const [charRow] = await db
        .select({ ownerId: characters.ownerId, campaignId: characters.campaignId })
        .from(characters)
        .where(eq(characters.id, characterId));
      if (charRow) {
        recipients.add(charRow.ownerId);
        if (charRow.campaignId) {
          const [campaignRow] = await db
            .select({ ownerId: campaigns.ownerId })
            .from(campaigns)
            .where(eq(campaigns.id, charRow.campaignId));
          if (campaignRow) recipients.add(campaignRow.ownerId);
          const members = await db
            .select({ userId: campaignMemberships.userId })
            .from(campaignMemberships)
            .where(eq(campaignMemberships.campaignId, charRow.campaignId));
          for (const m of members) recipients.add(m.userId);
        }
      }
    } catch {
      // Row gone, parentId missing (combat/character delete), or a
      // transient DB error -- fall back to the actor-only recipient
      // set already seeded above.
    }
  }
  const message = {
    kind: 'sync_invalidate' as const,
    entityClasses: [op.entityClass],
    emittedAt: new Date().toISOString(),
  };
  for (const userId of recipients) {
    wsPublish(userId, message);
  }
}

/**
 * Check whether a unique-violating `create` is a replay of an op the
 * server already applied.  Returns an `applied` outcome carrying the
 * existing row's revision when the entity with the client-supplied id
 * exists and the user is allowed to write it; null otherwise (genuine
 * conflict).  Read-only — runs after the failed insert's transaction
 * rolled back.
 */
async function resolveReplayedCreate(
  userId: string,
  op: OperationEnvelope,
): Promise<OperationOutcome | null> {
  try {
    const db = getDb();
    switch (op.entityClass) {
      case 'character': {
        const [row] = await db.select().from(characters).where(eq(characters.id, op.entityId));
        return row && row.ownerId === userId ? appliedOutcome(op, Number(row.revision)) : null;
      }
      case 'character_trait': {
        const characterId = requireParentId(op);
        assertWrite(await loadCharacterOr403(characterId, userId));
        const [row] = await db
          .select()
          .from(characterTraits)
          .where(
            and(eq(characterTraits.id, op.entityId), eq(characterTraits.characterId, characterId)),
          );
        return row ? appliedOutcome(op, Number(row.revision)) : null;
      }
      case 'character_skill': {
        const characterId = requireParentId(op);
        assertWrite(await loadCharacterOr403(characterId, userId));
        const [row] = await db
          .select()
          .from(characterSkills)
          .where(
            and(eq(characterSkills.id, op.entityId), eq(characterSkills.characterId, characterId)),
          );
        return row ? appliedOutcome(op, Number(row.revision)) : null;
      }
      case 'character_spell': {
        const characterId = requireParentId(op);
        assertWrite(await loadCharacterOr403(characterId, userId));
        const [row] = await db
          .select()
          .from(characterSpells)
          .where(
            and(eq(characterSpells.id, op.entityId), eq(characterSpells.characterId, characterId)),
          );
        return row ? appliedOutcome(op, Number(row.revision)) : null;
      }
      case 'character_inventory': {
        const characterId = requireParentId(op);
        assertWrite(await loadCharacterOr403(characterId, userId));
        const [row] = await db
          .select()
          .from(inventoryItems)
          .where(
            and(eq(inventoryItems.id, op.entityId), eq(inventoryItems.characterId, characterId)),
          );
        return row ? appliedOutcome(op, Number(row.revision)) : null;
      }
      default:
        // character_combat creates are upserts (no unique violation);
        // other classes have no create dispatcher.
        return null;
    }
  } catch {
    // Any access/parent-resolution failure means this is not a clean
    // replay — fall through to the normal conflict outcome.
    return null;
  }
}

async function dispatchOperationInner(
  ctx: DispatchContext,
  op: OperationEnvelope,
  tx: AuditTx,
): Promise<OperationOutcome> {
  switch (op.entityClass) {
    case 'character':
      return dispatchCharacter(ctx, op, tx);
    case 'character_trait':
      return dispatchTrait(ctx, op, tx);
    case 'character_skill':
      return dispatchSkill(ctx, op, tx);
    case 'character_spell':
      return dispatchSpell(ctx, op, tx);
    case 'character_inventory':
      return dispatchInventory(ctx, op, tx);
    case 'character_combat':
      return dispatchCombat(ctx, op, tx);
    default:
      return {
        clientOpId: op.clientOpId,
        status: 'rejected',
        reason: `entity class ${op.entityClass} not yet supported by /sync`,
      };
  }
}

// ---------- character ----------

async function dispatchCharacter(
  ctx: DispatchContext,
  op: OperationEnvelope,
  tx: AuditTx,
): Promise<OperationOutcome> {
  if (op.command === 'create') {
    const body = characterCreate.parse(op.attemptedValue);
    if (body.campaignId) {
      await loadCampaignOr403(body.campaignId, ctx.userId);
    }
    // Honor a client-supplied id so the local Dexie row keeps its
    // identity after the create round-trips.  If the id is already
    // taken, the unique index returns conflict via isUniqueViolation.
    const [created] = await tx
      .insert(characters)
      .values({
        ...(op.entityId ? { id: op.entityId } : {}),
        ownerId: ctx.userId,
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
    return appliedOutcome(op, Number(created.revision));
  }

  if (op.command === 'delete') {
    const access = await loadCharacterOr403(op.entityId, ctx.userId);
    assertWrite(access);
    await tx.delete(characters).where(eq(characters.id, op.entityId));
    // Tombstone trigger inserts a tombstone row whose revision becomes
    // the cursor for "this entity was deleted".  We don't know it
    // ahead of time, so we don't include `newRevision` here -- the
    // client picks it up on the next /sync/cursor pull.
    return { clientOpId: op.clientOpId, status: 'applied' };
  }

  // patch
  return await patchEntity({
    op,
    userId: ctx.userId,
    entityClass: 'character',
    tx,
    table: characters,
    parentLookup: () => loadCharacterOr403(op.entityId, ctx.userId).then((a) => a.character),
    childWhere: () => eq(characters.id, op.entityId),
    valueTransform: (field, value) => {
      if (field === 'campaignId' && value !== null && value !== undefined) {
        return loadCampaignOr403(value as string, ctx.userId).then(() => value);
      }
      return value;
    },
  });
}

// ---------- character_trait ----------

async function dispatchTrait(
  ctx: DispatchContext,
  op: OperationEnvelope,
  tx: AuditTx,
): Promise<OperationOutcome> {
  if (op.command === 'create') {
    const body = traitCreate.parse(op.attemptedValue);
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    const [created] = await tx
      .insert(characterTraits)
      .values({
        ...(op.entityId ? { id: op.entityId } : {}),
        characterId,
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
    return appliedOutcome(op, Number(created.revision));
  }

  if (op.command === 'delete') {
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    // No existence check: deletes are idempotent.  A replayed delete
    // whose first ack got lost finds the row already gone; write
    // access to the parent was asserted above, so "nothing to delete"
    // is success — returning unauthorized would make the client roll
    // back and resurrect the row locally.
    await tx
      .delete(characterTraits)
      .where(
        and(eq(characterTraits.id, op.entityId), eq(characterTraits.characterId, characterId)),
      );
    return { clientOpId: op.clientOpId, status: 'applied' };
  }

  // patch
  const characterId = requireParentId(op);
  const access = await loadCharacterOr403(characterId, ctx.userId);
  assertWrite(access);
  return await patchEntity({
    op,
    userId: ctx.userId,
    entityClass: 'character_trait',
    tx,
    table: characterTraits,
    parentLookup: async () => {
      const [row] = await getDb()
        .select()
        .from(characterTraits)
        .where(
          and(eq(characterTraits.id, op.entityId), eq(characterTraits.characterId, characterId)),
        );
      if (!row) throw new HTTPException(404, { message: 'trait not found' });
      return row;
    },
    childWhere: () =>
      and(eq(characterTraits.id, op.entityId), eq(characterTraits.characterId, characterId)),
  });
}

// ---------- character_skill ----------

async function dispatchSkill(
  ctx: DispatchContext,
  op: OperationEnvelope,
  tx: AuditTx,
): Promise<OperationOutcome> {
  if (op.command === 'create') {
    const body = skillCreate.parse(op.attemptedValue);
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    const [created] = await tx
      .insert(characterSkills)
      .values({
        ...(op.entityId ? { id: op.entityId } : {}),
        characterId,
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
    return appliedOutcome(op, Number(created.revision));
  }

  if (op.command === 'delete') {
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    // Idempotent delete — see the trait dispatcher for rationale.
    await tx
      .delete(characterSkills)
      .where(
        and(eq(characterSkills.id, op.entityId), eq(characterSkills.characterId, characterId)),
      );
    return { clientOpId: op.clientOpId, status: 'applied' };
  }

  const characterId = requireParentId(op);
  const access = await loadCharacterOr403(characterId, ctx.userId);
  assertWrite(access);
  return await patchEntity({
    op,
    userId: ctx.userId,
    entityClass: 'character_skill',
    tx,
    table: characterSkills,
    parentLookup: async () => {
      const [row] = await getDb()
        .select()
        .from(characterSkills)
        .where(
          and(eq(characterSkills.id, op.entityId), eq(characterSkills.characterId, characterId)),
        );
      if (!row) throw new HTTPException(404, { message: 'skill not found' });
      return row;
    },
    childWhere: () =>
      and(eq(characterSkills.id, op.entityId), eq(characterSkills.characterId, characterId)),
  });
}

// ---------- character_spell ----------

async function dispatchSpell(
  ctx: DispatchContext,
  op: OperationEnvelope,
  tx: AuditTx,
): Promise<OperationOutcome> {
  if (op.command === 'create') {
    const body = spellCreate.parse(op.attemptedValue);
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    const [created] = await tx
      .insert(characterSpells)
      .values({
        ...(op.entityId ? { id: op.entityId } : {}),
        characterId,
        name: body.name,
        college: body.college ?? null,
        difficulty: body.difficulty ?? 'H',
        points: body.points ?? 1,
        baseEnergyCost: body.baseEnergyCost ?? 1,
        maintenanceCost: body.maintenanceCost ?? null,
        castingTime: body.castingTime ?? null,
        duration: body.duration ?? null,
        prerequisites: body.prerequisites ?? null,
        notes: body.notes ?? null,
        librarySpellId: body.librarySpellId ?? null,
      })
      .returning();
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    return appliedOutcome(op, Number(created.revision));
  }

  if (op.command === 'delete') {
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    // Idempotent delete — see the trait dispatcher for rationale.
    await tx
      .delete(characterSpells)
      .where(
        and(eq(characterSpells.id, op.entityId), eq(characterSpells.characterId, characterId)),
      );
    return { clientOpId: op.clientOpId, status: 'applied' };
  }

  const characterId = requireParentId(op);
  const access = await loadCharacterOr403(characterId, ctx.userId);
  assertWrite(access);
  return await patchEntity({
    op,
    userId: ctx.userId,
    entityClass: 'character_spell',
    tx,
    table: characterSpells,
    parentLookup: async () => {
      const [row] = await getDb()
        .select()
        .from(characterSpells)
        .where(
          and(eq(characterSpells.id, op.entityId), eq(characterSpells.characterId, characterId)),
        );
      if (!row) throw new HTTPException(404, { message: 'spell not found' });
      return row;
    },
    childWhere: () =>
      and(eq(characterSpells.id, op.entityId), eq(characterSpells.characterId, characterId)),
  });
}

// ---------- character_inventory ----------

async function dispatchInventory(
  ctx: DispatchContext,
  op: OperationEnvelope,
  tx: AuditTx,
): Promise<OperationOutcome> {
  if (op.command === 'create') {
    const body = inventoryItemCreate.parse(op.attemptedValue);
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    // Lock the character row to prevent race conditions on inventory parent
    // validation, then validate the parent item if specified.
    await tx
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, characterId))
      .for('update');
    if (body.parentId) {
      const [parent] = await tx
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(
          and(eq(inventoryItems.id, body.parentId), eq(inventoryItems.characterId, characterId)),
        );
      if (!parent) {
        throw new HTTPException(400, {
          message: 'parentId must reference an item on this character',
        });
      }
    }
    const [created] = await tx
      .insert(inventoryItems)
      .values({
        ...(op.entityId ? { id: op.entityId } : {}),
        characterId,
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
        powerstoneData: body.powerstoneData ?? null,
        magicItemData: body.magicItemData ?? null,
        libraryItemId: body.libraryItemId ?? null,
      })
      .returning();
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    return appliedOutcome(op, Number(created.revision));
  }

  if (op.command === 'delete') {
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    const [doomed] = await getDb()
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, op.entityId), eq(inventoryItems.characterId, characterId)));
    if (!doomed) {
      // Idempotent delete — see the trait dispatcher for rationale.
      return { clientOpId: op.clientOpId, status: 'applied' };
    }
    await tx
      .update(inventoryItems)
      .set({ parentId: doomed.parentId, updatedAt: new Date() })
      .where(
        and(eq(inventoryItems.parentId, op.entityId), eq(inventoryItems.characterId, characterId)),
      );
    await tx
      .delete(inventoryItems)
      .where(and(eq(inventoryItems.id, op.entityId), eq(inventoryItems.characterId, characterId)));
    return { clientOpId: op.clientOpId, status: 'applied' };
  }

  // patch
  const characterId = requireParentId(op);
  const access = await loadCharacterOr403(characterId, ctx.userId);
  assertWrite(access);
  return await patchEntity({
    op,
    userId: ctx.userId,
    entityClass: 'character_inventory',
    tx,
    table: inventoryItems,
    parentLookup: async () => {
      const [row] = await getDb()
        .select()
        .from(inventoryItems)
        .where(
          and(eq(inventoryItems.id, op.entityId), eq(inventoryItems.characterId, characterId)),
        );
      if (!row) throw new HTTPException(404, { message: 'item not found' });
      return row;
    },
    childWhere: () =>
      and(eq(inventoryItems.id, op.entityId), eq(inventoryItems.characterId, characterId)),
    valueTransform: (field, value) => {
      // numeric columns expect strings (drizzle decimal mapping)
      if (NUMERIC_INVENTORY_FIELDS.has(field)) return String(value);
      return value;
    },
    extraValidate: async (field, value) => {
      if (field === 'parentId') {
        if (value === op.entityId) {
          throw new HTTPException(400, { message: 'an item cannot be its own parent' });
        }
        if (value !== null && value !== undefined) {
          await assertNoCycle(op.entityId, value as string, characterId);
        }
      }
    },
  });
}

async function assertNoCycle(itemId: string, proposedParent: string, characterId: string) {
  const db = getDb();
  const seen = new Set<string>();
  let current: string | null = proposedParent;
  while (current !== null) {
    if (current === itemId) {
      throw new HTTPException(400, { message: 'parent change would create an inventory cycle' });
    }
    if (seen.has(current)) {
      throw new HTTPException(400, { message: 'detected existing inventory cycle' });
    }
    seen.add(current);
    const [row] = await db
      .select({ parentId: inventoryItems.parentId })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, current), eq(inventoryItems.characterId, characterId)));
    if (!row) break;
    current = row.parentId;
  }
}

// ---------- character_combat ----------

async function dispatchCombat(
  ctx: DispatchContext,
  op: OperationEnvelope,
  tx: AuditTx,
): Promise<OperationOutcome> {
  if (op.command === 'delete') {
    return {
      clientOpId: op.clientOpId,
      status: 'rejected',
      reason: 'combat state is not deletable',
    };
  }
  const characterId = requireParentId(op);
  const access = await loadCharacterOr403(characterId, ctx.userId);
  assertWrite(access);

  // Combat state is 1:1 keyed on character_id.  Whether the client
  // sends `(command='patch', fieldPath='currentHp', attemptedValue=10)`
  // or `(command='create', attemptedValue={ currentHp: 10, ... })`,
  // we treat both as upserts: the legacy CRUD route was always an
  // upsert (PATCH /characters/{id}/combat created on first call), and
  // a field-path patch hitting a missing row should not 404 just
  // because no combat row has been persisted yet.
  let body: Record<string, unknown>;
  if (op.command === 'patch' && op.fieldPath) {
    // Validate the single field through the partial schema so it
    // gets the same constraints as a whole-body patch (e.g. posture
    // enum, hp/fp range), then build a one-key body.
    const fieldShape = (combatStateUpdate.shape as Record<string, z.ZodTypeAny>)[op.fieldPath];
    if (!fieldShape) {
      return {
        clientOpId: op.clientOpId,
        status: 'rejected',
        reason: `field "${op.fieldPath}" not writable on character_combat`,
      };
    }
    const parsed = fieldShape.parse(op.attemptedValue);
    body = { [op.fieldPath]: parsed };
  } else {
    body = combatStateUpdate.parse(op.attemptedValue) as Record<string, unknown>;
  }

  const setOnUpdate: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    setOnUpdate[k] = v;
  }
  // Default the missing pool to the character's derived value, not the
  // literal 10.  Without this, a per-field patch on a character with
  // no combat row yet (e.g. a first-cast spending FP from CastSpellDialog)
  // would create the row at currentHp=10 even when derived HP is 14,
  // and the cursor pull would clobber the local pool.  The legacy CRUD
  // route in characterSubResources.ts already computes derived for the
  // same reason.
  const derived = computeDerived(characterAttrsFromRow(access.character));
  const [row] = await tx
    .insert(combatStates)
    .values({
      characterId,
      currentHp: (body.currentHp as number | undefined) ?? derived.hp,
      currentFp: (body.currentFp as number | undefined) ?? derived.fp,
      conditions: (body.conditions as string[] | undefined) ?? [],
      maneuver: (body.maneuver as string | null | undefined) ?? null,
      posture: (body.posture as 'standing' | undefined) ?? 'standing',
    })
    .onConflictDoUpdate({
      target: combatStates.characterId,
      set: setOnUpdate,
    })
    .returning();
  if (!row) throw new HTTPException(500, { message: 'combat upsert failed' });
  return appliedOutcome(op, Number(row.revision));
}

// ---------- shared patch helper ----------

interface PatchEntityArgs {
  readonly op: OperationEnvelope;
  readonly userId: string;
  readonly entityClass: WritableEntityClass;
  readonly tx: AuditTx;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle table object
  readonly table: any;
  readonly parentLookup: () => Promise<{ revision: number | bigint } | undefined>;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle expression
  readonly childWhere: () => any;
  readonly valueTransform?: (field: string, value: unknown) => unknown | Promise<unknown>;
  readonly extraValidate?: (field: string, value: unknown) => Promise<void> | void;
}

async function patchEntity(args: PatchEntityArgs): Promise<OperationOutcome> {
  const { op, entityClass, tx, table, parentLookup, childWhere, valueTransform, extraValidate } =
    args;
  const writableFields = WRITABLE_FOR_PATCH[entityClass];
  if (!writableFields) {
    return { clientOpId: op.clientOpId, status: 'rejected', reason: 'entity class not writable' };
  }

  const fieldPath = op.fieldPath;
  if (!fieldPath) {
    // Whole-body patch: validate against the partial schema and apply
    // every present field.  Used for create-style upserts (combat) and
    // for legacy clients that don't bother with per-field paths.
    const validator = FIELD_VALIDATORS[entityClass];
    const body = validator.parse(op.attemptedValue);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      const transformed = valueTransform ? await valueTransform(k, v) : v;
      updates[k] = transformed;
    }
    const current = await parentLookup();
    if (current && op.baseRevision !== undefined && Number(current.revision) > op.baseRevision) {
      return {
        clientOpId: op.clientOpId,
        status: 'stale_base',
        reason: 'newer server revision',
        latestEntity: current,
      };
    }
    const result = await tx.update(table).set(updates).where(childWhere()).returning();
    const updated = result[0];
    if (!updated) return { clientOpId: op.clientOpId, status: 'unauthorized', reason: 'not found' };
    return appliedOutcome(op, Number(updated.revision));
  }

  if (!writableFields.includes(fieldPath)) {
    return {
      clientOpId: op.clientOpId,
      status: 'rejected',
      reason: `field "${fieldPath}" not writable on ${entityClass}`,
    };
  }

  const validator = FIELD_VALIDATORS[entityClass];
  const fieldShape = (validator.shape as Record<string, z.ZodTypeAny>)[fieldPath];
  if (!fieldShape) {
    return {
      clientOpId: op.clientOpId,
      status: 'rejected',
      reason: `no validator for field ${fieldPath}`,
    };
  }
  const parsed = fieldShape.parse(op.attemptedValue);
  if (extraValidate) await extraValidate(fieldPath, parsed);

  const current = await parentLookup();
  if (current && op.baseRevision !== undefined && Number(current.revision) > op.baseRevision) {
    return {
      clientOpId: op.clientOpId,
      status: 'stale_base',
      reason: 'newer server revision',
      latestEntity: current,
    };
  }

  const transformed = valueTransform ? await valueTransform(fieldPath, parsed) : parsed;
  const updates: Record<string, unknown> = {
    [fieldPath]: transformed,
    updatedAt: new Date(),
  };
  const result = await tx.update(table).set(updates).where(childWhere()).returning();
  const updated = result[0];
  if (!updated) return { clientOpId: op.clientOpId, status: 'unauthorized', reason: 'not found' };
  return appliedOutcome(op, Number(updated.revision));
}

function appliedOutcome(op: OperationEnvelope, newRevision: number): OperationOutcome {
  return { clientOpId: op.clientOpId, status: 'applied', newRevision };
}

function requireParentId(op: OperationEnvelope): string {
  // Prefer the top-level `parentId` field on the envelope -- it's the
  // canonical home for child-entity routing.  We still fall back to
  // `attemptedValue.characterId` / `prevValue.characterId` so legacy
  // create envelopes (which include the parent on the body itself)
  // continue to work.
  if (typeof op.parentId === 'string') return op.parentId;
  const fromAttempted = (op.attemptedValue as { characterId?: string } | undefined)?.characterId;
  if (typeof fromAttempted === 'string') return fromAttempted;
  const fromPrev = (op.prevValue as { characterId?: string } | undefined)?.characterId;
  if (typeof fromPrev === 'string') return fromPrev;
  throw new HTTPException(400, {
    message: 'characterId required for child entity operations',
  });
}
