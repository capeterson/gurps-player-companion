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
 */

import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
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
import { getDb } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import {
  characterSkills,
  characterSpells,
  characterTraits,
  characters,
  combatStates,
  inventoryItems,
} from '../db/schema.ts';
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
  campaign_library_item: null,
  adventure_log: null,
};

const NUMERIC_INVENTORY_FIELDS = new Set(['weightLbs', 'cost', 'hideawayCapacityLbs']);

interface DispatchContext {
  readonly userId: string;
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
  try {
    const outcome = await dispatchOperationInner(ctx, op);
    if (outcome.status === 'applied') {
      // Wake any other tabs/devices for this user.  WS messages carry
      // no row data — the client always reconciles via /sync/cursor.
      wsPublish(ctx.userId, {
        kind: 'sync_invalidate',
        entityClasses: [op.entityClass],
        emittedAt: new Date().toISOString(),
      });
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

async function dispatchOperationInner(
  ctx: DispatchContext,
  op: OperationEnvelope,
): Promise<OperationOutcome> {
  switch (op.entityClass) {
    case 'character':
      return dispatchCharacter(ctx, op);
    case 'character_trait':
      return dispatchTrait(ctx, op);
    case 'character_skill':
      return dispatchSkill(ctx, op);
    case 'character_spell':
      return dispatchSpell(ctx, op);
    case 'character_inventory':
      return dispatchInventory(ctx, op);
    case 'character_combat':
      return dispatchCombat(ctx, op);
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
): Promise<OperationOutcome> {
  const db = getDb();
  if (op.command === 'create') {
    const body = characterCreate.parse(op.attemptedValue);
    if (body.campaignId) {
      await loadCampaignOr403(body.campaignId, ctx.userId);
    }
    // Honor a client-supplied id so the local Dexie row keeps its
    // identity after the create round-trips.  If the id is already
    // taken, the unique index returns conflict via isUniqueViolation.
    const [created] = await db
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
    await db.delete(characters).where(eq(characters.id, op.entityId));
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
): Promise<OperationOutcome> {
  const db = getDb();
  if (op.command === 'create') {
    const body = traitCreate.parse(op.attemptedValue);
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    const [created] = await db
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
    const result = await db
      .delete(characterTraits)
      .where(and(eq(characterTraits.id, op.entityId), eq(characterTraits.characterId, characterId)))
      .returning({ id: characterTraits.id });
    if (result.length === 0) {
      return { clientOpId: op.clientOpId, status: 'unauthorized', reason: 'trait not found' };
    }
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
    table: characterTraits,
    parentLookup: async () => {
      const [row] = await db
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
): Promise<OperationOutcome> {
  const db = getDb();
  if (op.command === 'create') {
    const body = skillCreate.parse(op.attemptedValue);
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    const [created] = await db
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
    const result = await db
      .delete(characterSkills)
      .where(and(eq(characterSkills.id, op.entityId), eq(characterSkills.characterId, characterId)))
      .returning({ id: characterSkills.id });
    if (result.length === 0) {
      return { clientOpId: op.clientOpId, status: 'unauthorized', reason: 'skill not found' };
    }
    return { clientOpId: op.clientOpId, status: 'applied' };
  }

  const characterId = requireParentId(op);
  const access = await loadCharacterOr403(characterId, ctx.userId);
  assertWrite(access);
  return await patchEntity({
    op,
    userId: ctx.userId,
    entityClass: 'character_skill',
    table: characterSkills,
    parentLookup: async () => {
      const [row] = await db
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
): Promise<OperationOutcome> {
  const db = getDb();
  if (op.command === 'create') {
    const body = spellCreate.parse(op.attemptedValue);
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    const [created] = await db
      .insert(characterSpells)
      .values({
        ...(op.entityId ? { id: op.entityId } : {}),
        characterId,
        name: body.name,
        college: body.college ?? null,
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
    const result = await db
      .delete(characterSpells)
      .where(and(eq(characterSpells.id, op.entityId), eq(characterSpells.characterId, characterId)))
      .returning({ id: characterSpells.id });
    if (result.length === 0) {
      return { clientOpId: op.clientOpId, status: 'unauthorized', reason: 'spell not found' };
    }
    return { clientOpId: op.clientOpId, status: 'applied' };
  }

  const characterId = requireParentId(op);
  const access = await loadCharacterOr403(characterId, ctx.userId);
  assertWrite(access);
  return await patchEntity({
    op,
    userId: ctx.userId,
    entityClass: 'character_spell',
    table: characterSpells,
    parentLookup: async () => {
      const [row] = await db
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
): Promise<OperationOutcome> {
  const db = getDb();
  if (op.command === 'create') {
    const body = inventoryItemCreate.parse(op.attemptedValue);
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    const created = await db.transaction(async (tx) => {
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
      const [row] = await tx
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
          libraryItemId: body.libraryItemId ?? null,
        })
        .returning();
      return row;
    });
    if (!created) throw new HTTPException(500, { message: 'insert failed' });
    return appliedOutcome(op, Number(created.revision));
  }

  if (op.command === 'delete') {
    const characterId = requireParentId(op);
    const access = await loadCharacterOr403(characterId, ctx.userId);
    assertWrite(access);
    const [doomed] = await db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, op.entityId), eq(inventoryItems.characterId, characterId)));
    if (!doomed) {
      return { clientOpId: op.clientOpId, status: 'unauthorized', reason: 'item not found' };
    }
    await db
      .update(inventoryItems)
      .set({ parentId: doomed.parentId, updatedAt: new Date() })
      .where(
        and(eq(inventoryItems.parentId, op.entityId), eq(inventoryItems.characterId, characterId)),
      );
    await db
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
    table: inventoryItems,
    parentLookup: async () => {
      const [row] = await db
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
          // Cycle check inside the same transaction — pessimistic lock
          // is taken by the calling patchEntity if needed.
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
  const db = getDb();

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
  const [row] = await db
    .insert(combatStates)
    .values({
      characterId,
      currentHp: (body.currentHp as number | undefined) ?? 10,
      currentFp: (body.currentFp as number | undefined) ?? 10,
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
  // biome-ignore lint/suspicious/noExplicitAny: drizzle table object
  readonly table: any;
  readonly parentLookup: () => Promise<{ revision: number | bigint } | undefined>;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle expression
  readonly childWhere: () => any;
  readonly valueTransform?: (field: string, value: unknown) => unknown | Promise<unknown>;
  readonly extraValidate?: (field: string, value: unknown) => Promise<void> | void;
}

async function patchEntity(args: PatchEntityArgs): Promise<OperationOutcome> {
  const { op, entityClass, table, parentLookup, childWhere, valueTransform, extraValidate } = args;
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
    const result = await getDb().update(table).set(updates).where(childWhere()).returning();
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
  const result = await getDb().update(table).set(updates).where(childWhere()).returning();
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
