/**
 * Integration tests for the batch-local revision fast-forward in
 * POST /api/v1/sync/operations (see `createBatchRevisionChains` in
 * sync.ts). These require a live Postgres -- same harness as
 * `syncDispatch.test.ts`'s "field writability parity" describe block.
 *
 * The scenario under test: a burst of rapid same-entity edits (e.g.
 * add item -> mark as weapon -> tweak stats) gets enqueued client-side
 * with the SAME baseRevision, since nothing has been acked yet to
 * advance it. Before this fix, only the first op in such a batch would
 * apply; every later op would come back `stale_base` even though it
 * was a valid, non-conflicting edit.
 */

import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return { ...bearer(token), 'content-type': 'application/json' };
}

async function registerUser(suffix: string) {
  const email = `sync-ops-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Test ${suffix}` }),
  });
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken };
}

async function createCharacter(
  accessToken: string,
  name = `Sync ops test ${Date.now()}-${Math.random()}`,
): Promise<{ id: string; revision: number }> {
  const res = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { id: string; revision: number };
  return body;
}

async function getCharacter(accessToken: string, id: string) {
  const res = await app.request(`/api/v1/characters/${id}`, {
    method: 'GET',
    headers: bearer(accessToken),
  });
  return (await res.json()) as Record<string, unknown> & { revision: number };
}

function patchOp(args: {
  clientOpId: string;
  entityId: string;
  fieldPath: string;
  attemptedValue: unknown;
  baseRevision: number;
}) {
  return {
    clientOpId: args.clientOpId,
    entityClass: 'character' as const,
    entityId: args.entityId,
    command: 'patch' as const,
    fieldPath: args.fieldPath,
    attemptedValue: args.attemptedValue,
    baseRevision: args.baseRevision,
    validationVersion: 1,
    createdAt: new Date().toISOString(),
  };
}

async function postOperations(accessToken: string, operations: unknown[]) {
  const res = await app.request('/api/v1/sync/operations', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ operations }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    outcomes: Array<{
      clientOpId: string;
      status: string;
      newRevision?: number;
      reason?: string;
      latestEntity?: unknown;
    }>;
  };
}

describe('POST /api/v1/sync/operations -- batch-local revision fast-forward', () => {
  it('applies a burst of same-base patches to distinct fields in one request', async () => {
    const { accessToken } = await registerUser('burst-character');
    const character = await createCharacter(accessToken);

    const body = await postOperations(accessToken, [
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: character.id,
        fieldPath: 'name',
        attemptedValue: 'Renamed Hero',
        baseRevision: character.revision,
      }),
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: character.id,
        fieldPath: 'st',
        attemptedValue: 13,
        baseRevision: character.revision,
      }),
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: character.id,
        fieldPath: 'hpMod',
        attemptedValue: 2,
        baseRevision: character.revision,
      }),
    ]);

    expect(body.outcomes).toHaveLength(3);
    for (const outcome of body.outcomes) {
      expect(outcome.status).toBe('applied');
    }
    // Revisions strictly increase across the chain.
    const revisions = body.outcomes.map((o) => o.newRevision);
    expect(revisions[0]).toBeLessThan(revisions[1] as number);
    expect(revisions[1]).toBeLessThan(revisions[2] as number);

    const updated = await getCharacter(accessToken, character.id);
    expect(updated.name).toBe('Renamed Hero');
    expect(updated.st).toBe(13);
    expect(updated.hpMod).toBe(2);
  });

  it('applies a burst of same-base patches on a child entity (inventory item) in one request', async () => {
    const { accessToken } = await registerUser('burst-inventory');
    const character = await createCharacter(accessToken);

    const itemId = crypto.randomUUID();
    const createOutcome = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_inventory' as const,
        entityId: itemId,
        command: 'create' as const,
        attemptedValue: { name: 'Broadsword', quantity: 1 },
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(createOutcome.outcomes[0]?.status).toBe('applied');
    const itemRevision = createOutcome.outcomes[0]?.newRevision as number;

    // Mimic "mark as weapon" -- several field patches on the SAME item,
    // all stamped with the same post-create revision (nothing has been
    // acked to advance it yet).
    const body = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_inventory' as const,
        entityId: itemId,
        command: 'patch' as const,
        fieldPath: 'isArmor',
        attemptedValue: false,
        baseRevision: itemRevision,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_inventory' as const,
        entityId: itemId,
        command: 'patch' as const,
        fieldPath: 'weaponData',
        attemptedValue: { damage: 'sw+2 cut', reach: '1', parry: '0' },
        baseRevision: itemRevision,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_inventory' as const,
        entityId: itemId,
        command: 'patch' as const,
        fieldPath: 'weightLbs',
        attemptedValue: 3,
        baseRevision: itemRevision,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);

    expect(body.outcomes).toHaveLength(3);
    for (const outcome of body.outcomes) {
      expect(outcome.status).toBe('applied');
    }
  });

  it('still returns stale_base for a base older than the batch chain start (genuine conflict)', async () => {
    const { accessToken } = await registerUser('genuine-conflict');
    const character = await createCharacter(accessToken);
    const originalRevision = character.revision;

    // Advance the character out from under the client via a separate REST PATCH
    // (simulating a write the client's queued ops don't know about).
    const patchRes = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Advanced Elsewhere' }),
    });
    expect(patchRes.status).toBe(200);
    const advanced = (await patchRes.json()) as { revision: number };
    expect(advanced.revision).toBeGreaterThan(originalRevision);

    // A batch where op1 carries the fresh (post-REST-PATCH) base and applies,
    // but op2 carries the STALE original base -- older than the chain start,
    // so it must NOT be fast-forwarded; it's a genuine conflict.
    const body = await postOperations(accessToken, [
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: character.id,
        fieldPath: 'st',
        attemptedValue: 14,
        baseRevision: advanced.revision,
      }),
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: character.id,
        fieldPath: 'dx',
        attemptedValue: 14,
        baseRevision: originalRevision,
      }),
    ]);

    expect(body.outcomes[0]?.status).toBe('applied');
    expect(body.outcomes[1]?.status).toBe('stale_base');
    expect(body.outcomes[1]?.latestEntity).toBeDefined();
  });

  it('returns stale_base for the first op of a batch when its base is already stale (no chain to seed from)', async () => {
    const { accessToken } = await registerUser('first-op-stale');
    const character = await createCharacter(accessToken);
    const originalRevision = character.revision;

    const patchRes = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Someone Else Edited This' }),
    });
    expect(patchRes.status).toBe(200);

    // Both ops share the now-stale original base. Since op1 itself fails
    // stale_base, no chain is ever seeded, so op2 must ALSO fail stale_base
    // (never fast-forwarded from a non-applied outcome).
    const body = await postOperations(accessToken, [
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: character.id,
        fieldPath: 'st',
        attemptedValue: 14,
        baseRevision: originalRevision,
      }),
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: character.id,
        fieldPath: 'dx',
        attemptedValue: 14,
        baseRevision: originalRevision,
      }),
    ]);

    expect(body.outcomes[0]?.status).toBe('stale_base');
    expect(body.outcomes[1]?.status).toBe('stale_base');
  });

  it('keeps revision chains isolated per entity -- interleaved patches to two characters both fast-forward independently', async () => {
    const { accessToken } = await registerUser('cross-entity');
    const charA = await createCharacter(accessToken, `Char A ${Date.now()}`);
    const charB = await createCharacter(accessToken, `Char B ${Date.now()}`);

    const body = await postOperations(accessToken, [
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: charA.id,
        fieldPath: 'name',
        attemptedValue: 'A1',
        baseRevision: charA.revision,
      }),
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: charB.id,
        fieldPath: 'name',
        attemptedValue: 'B1',
        baseRevision: charB.revision,
      }),
      // Both of these carry their character's ORIGINAL base, and both
      // should fast-forward off their own entity's chain -- not each
      // other's.
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: charA.id,
        fieldPath: 'st',
        attemptedValue: 13,
        baseRevision: charA.revision,
      }),
      patchOp({
        clientOpId: crypto.randomUUID(),
        entityId: charB.id,
        fieldPath: 'st',
        attemptedValue: 13,
        baseRevision: charB.revision,
      }),
    ]);

    expect(body.outcomes.map((o) => o.status)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
    ]);
  });

  it('does not disturb the undefined-base skip for a patch queued right after an unacked create', async () => {
    const { accessToken } = await registerUser('create-then-patch');
    const character = await createCharacter(accessToken);
    const traitId = crypto.randomUUID();

    const body = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_trait' as const,
        entityId: traitId,
        command: 'create' as const,
        attemptedValue: { kind: 'advantage', name: 'Toughness', points: 10 },
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_trait' as const,
        entityId: traitId,
        command: 'patch' as const,
        fieldPath: 'points',
        attemptedValue: 15,
        // No baseRevision -- mirrors the client's `readEntityRevision`
        // returning undefined for a not-yet-acked create.
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);

    expect(body.outcomes[0]?.status).toBe('applied');
    expect(body.outcomes[1]?.status).toBe('applied');
  });
});
