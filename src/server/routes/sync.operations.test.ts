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
  return { accessToken: body.accessToken, email };
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

// ===================== character_language =====================

/**
 * S11 coverage for the `character_language` sync surface: success,
 * server rejection, stale-base, and the S12 authorization parity check
 * (a campaign member who can only READ another player's sheet must not
 * be able to write a language through /sync any more than through REST).
 */
describe('POST /api/v1/sync/operations -- character_language', () => {
  async function createLanguageViaSync(
    accessToken: string,
    characterId: string,
    attemptedValue: Record<string, unknown>,
  ) {
    const languageId = crypto.randomUUID();
    const body = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_language' as const,
        entityId: languageId,
        command: 'create' as const,
        attemptedValue: { ...attemptedValue, characterId },
        parentId: characterId,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    return { languageId, outcome: body.outcomes[0] };
  }

  it('create → patch → delete all apply and the detail payload follows', async () => {
    const { accessToken } = await registerUser('sync-lang-crud');
    const character = await createCharacter(accessToken);

    const { languageId, outcome } = await createLanguageViaSync(accessToken, character.id, {
      name: 'Latin',
      spokenFluency: 'accented',
      writtenFluency: 'none',
      points: 2,
    });
    expect(outcome?.status).toBe('applied');
    expect(typeof outcome?.newRevision).toBe('number');

    const afterCreate = await getCharacter(accessToken, character.id);
    expect((afterCreate.languages as { name: string }[])[0]?.name).toBe('Latin');
    expect((afterCreate.points as Record<string, number>).languages).toBe(2);

    const patch = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_language' as const,
        entityId: languageId,
        command: 'patch' as const,
        fieldPath: 'writtenFluency',
        attemptedValue: 'native',
        baseRevision: outcome?.newRevision,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(patch.outcomes[0]?.status).toBe('applied');
    const afterPatch = await getCharacter(accessToken, character.id);
    expect((afterPatch.languages as { writtenFluency: string }[])[0]?.writtenFluency).toBe(
      'native',
    );

    const del = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_language' as const,
        entityId: languageId,
        command: 'delete' as const,
        attemptedValue: { characterId: character.id },
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(del.outcomes[0]?.status).toBe('applied');
    const afterDelete = await getCharacter(accessToken, character.id);
    expect(afterDelete.languages).toEqual([]);
  });

  it('a replayed delete of an already-deleted language is idempotently applied', async () => {
    const { accessToken } = await registerUser('sync-lang-redelete');
    const character = await createCharacter(accessToken);
    const { languageId } = await createLanguageViaSync(accessToken, character.id, {
      name: 'Greek',
    });
    const deleteOp = () => ({
      clientOpId: crypto.randomUUID(),
      entityClass: 'character_language' as const,
      entityId: languageId,
      command: 'delete' as const,
      attemptedValue: { characterId: character.id },
      parentId: character.id,
      validationVersion: 1,
      createdAt: new Date().toISOString(),
    });
    expect((await postOperations(accessToken, [deleteOp()])).outcomes[0]?.status).toBe('applied');
    expect((await postOperations(accessToken, [deleteOp()])).outcomes[0]?.status).toBe('applied');
  });

  it('a replayed create with the same id settles as applied, not conflict', async () => {
    const { accessToken } = await registerUser('sync-lang-recreate');
    const character = await createCharacter(accessToken);
    const languageId = crypto.randomUUID();
    const createOp = () => ({
      clientOpId: crypto.randomUUID(),
      entityClass: 'character_language' as const,
      entityId: languageId,
      command: 'create' as const,
      attemptedValue: { name: 'Latin', characterId: character.id },
      parentId: character.id,
      validationVersion: 1,
      createdAt: new Date().toISOString(),
    });
    expect((await postOperations(accessToken, [createOp()])).outcomes[0]?.status).toBe('applied');
    const replay = await postOperations(accessToken, [createOp()]);
    expect(replay.outcomes[0]?.status).toBe('applied');
    const detail = await getCharacter(accessToken, character.id);
    expect(detail.languages).toHaveLength(1);
  });

  it('rejects an out-of-range fluency value', async () => {
    const { accessToken } = await registerUser('sync-lang-reject');
    const character = await createCharacter(accessToken);
    const { languageId, outcome } = await createLanguageViaSync(accessToken, character.id, {
      name: 'Latin',
    });
    expect(outcome?.status).toBe('applied');
    const body = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_language' as const,
        entityId: languageId,
        command: 'patch' as const,
        fieldPath: 'spokenFluency',
        attemptedValue: 'fluent',
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(body.outcomes[0]?.status).toBe('rejected');
  });

  it('rejects a fieldPath that is not on languageUpdate (writable-field parity, S12.3)', async () => {
    const { accessToken } = await registerUser('sync-lang-field');
    const character = await createCharacter(accessToken);
    const { languageId } = await createLanguageViaSync(accessToken, character.id, {
      name: 'Latin',
    });
    const body = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_language' as const,
        entityId: languageId,
        command: 'patch' as const,
        fieldPath: 'characterId',
        attemptedValue: crypto.randomUUID(),
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(body.outcomes[0]?.status).toBe('rejected');
    expect(body.outcomes[0]?.reason).toContain('not writable');
  });

  it('returns stale_base when the server row moved past the op base revision', async () => {
    const { accessToken } = await registerUser('sync-lang-stale');
    const character = await createCharacter(accessToken);
    const { languageId, outcome } = await createLanguageViaSync(accessToken, character.id, {
      name: 'Latin',
      points: 1,
    });
    const staleBase = outcome?.newRevision as number;
    // A foreign write advances the row past `staleBase`.
    const bump = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_language' as const,
        entityId: languageId,
        command: 'patch' as const,
        fieldPath: 'points',
        attemptedValue: 5,
        baseRevision: staleBase,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(bump.outcomes[0]?.status).toBe('applied');

    const stale = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_language' as const,
        entityId: languageId,
        command: 'patch' as const,
        fieldPath: 'name',
        attemptedValue: 'Vulgar Latin',
        baseRevision: staleBase,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(stale.outcomes[0]?.status).toBe('stale_base');
    expect(stale.outcomes[0]?.latestEntity).toBeTruthy();
  });

  it('a read-only campaign member cannot create or patch another player’s language (S12.1)', async () => {
    const gm = await registerUser('sync-lang-gm');
    const owner = await registerUser('sync-lang-owner');
    const viewer = await registerUser('sync-lang-viewer');
    const campaignRes = await app.request('/api/v1/campaigns', {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ name: `Camp ${Date.now()}-${Math.random()}` }),
    });
    const campaign = (await campaignRes.json()) as { id: string };
    for (const member of [owner, viewer]) {
      await app.request(`/api/v1/campaigns/${campaign.id}/members`, {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ email: member.email }),
      });
    }
    const charRes = await app.request('/api/v1/characters', {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ name: 'Shared PC', campaignId: campaign.id }),
    });
    const character = (await charRes.json()) as { id: string };

    const { outcome } = await createLanguageViaSync(viewer.accessToken, character.id, {
      name: 'Latin',
    });
    expect(outcome?.status).toBe('unauthorized');

    // And the owner's own create still works, proving the block is about
    // the actor rather than the payload.
    const ownerCreate = await createLanguageViaSync(owner.accessToken, character.id, {
      name: 'Latin',
    });
    expect(ownerCreate.outcome?.status).toBe('applied');

    const viewerPatch = await postOperations(viewer.accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_language' as const,
        entityId: ownerCreate.languageId,
        command: 'patch' as const,
        fieldPath: 'points',
        attemptedValue: 99,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(viewerPatch.outcomes[0]?.status).toBe('unauthorized');
  });

  it('a bulk batch of ten language creates all apply under one batchId', async () => {
    const { accessToken } = await registerUser('sync-lang-bulk');
    const character = await createCharacter(accessToken);
    const batchId = crypto.randomUUID();
    const ops = Array.from({ length: 10 }, (_, i) => ({
      clientOpId: crypto.randomUUID(),
      entityClass: 'character_language' as const,
      entityId: crypto.randomUUID(),
      command: 'create' as const,
      attemptedValue: {
        name: `Tongue ${i}`,
        spokenFluency: 'broken',
        points: 1,
        characterId: character.id,
      },
      parentId: character.id,
      batchId,
      validationVersion: 1,
      createdAt: new Date().toISOString(),
    }));
    const body = await postOperations(accessToken, ops);
    expect(body.outcomes.every((o) => o.status === 'applied')).toBe(true);

    const detail = await getCharacter(accessToken, character.id);
    expect(detail.languages).toHaveLength(10);
    expect((detail.points as Record<string, number>).languages).toBe(10);

    const historyRes = await app.request(`/api/v1/characters/${character.id}/history`, {
      headers: bearer(accessToken),
    });
    const events = (await historyRes.json()) as { entityClass: string; batchId: string | null }[];
    const langEvents = events.filter((e) => e.entityClass === 'character_language');
    expect(langEvents).toHaveLength(10);
    // H5: every op in the gesture shares the client-supplied batch id.
    expect(new Set(langEvents.map((e) => e.batchId))).toEqual(new Set([batchId]));
  });

  it('a cursor pull returns the language rows and their tombstone after deletion', async () => {
    const { accessToken } = await registerUser('sync-lang-cursor');
    const character = await createCharacter(accessToken);
    const { languageId } = await createLanguageViaSync(accessToken, character.id, {
      name: 'Latin',
      points: 2,
    });

    const pull = async (since: number) => {
      const res = await app.request('/api/v1/sync/cursor', {
        method: 'POST',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({
          cursors: [{ entityClass: 'character_language', sinceRevision: since }],
        }),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as {
        changes: Array<{
          entityClass: string;
          entityId: string;
          command: string;
          revision: number;
          data?: Record<string, unknown>;
        }>;
        nextCursor: Record<string, number>;
      };
    };

    const first = await pull(0);
    const upsert = first.changes.find((c) => c.entityId === languageId);
    expect(upsert?.command).toBe('patch');
    expect(upsert?.data?.name).toBe('Latin');
    expect(upsert?.data?.spokenFluency).toBe('none');
    expect(upsert?.data?.points).toBe(2);

    await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_language' as const,
        entityId: languageId,
        command: 'delete' as const,
        attemptedValue: { characterId: character.id },
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);

    const second = await pull(first.nextCursor.character_language ?? 0);
    const tombstone = second.changes.find((c) => c.entityId === languageId);
    expect(tombstone?.command).toBe('delete');
  });

  it('a minimal-view member does not receive another player’s language rows on cursor pull', async () => {
    const gm = await registerUser('sync-lang-minimal-gm');
    const owner = await registerUser('sync-lang-minimal-owner');
    const viewer = await registerUser('sync-lang-minimal-viewer');
    const campaignRes = await app.request('/api/v1/campaigns', {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        name: `Camp ${Date.now()}-${Math.random()}`,
        shareCharacterSheets: false,
      }),
    });
    const campaign = (await campaignRes.json()) as { id: string };
    for (const member of [owner, viewer]) {
      await app.request(`/api/v1/campaigns/${campaign.id}/members`, {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ email: member.email }),
      });
    }
    const charRes = await app.request('/api/v1/characters', {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ name: 'Private PC', campaignId: campaign.id }),
    });
    const character = (await charRes.json()) as { id: string };
    const { languageId } = await createLanguageViaSync(owner.accessToken, character.id, {
      name: 'Secret Tongue',
    });

    const res = await app.request('/api/v1/sync/cursor', {
      method: 'POST',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({
        cursors: [{ entityClass: 'character_language', sinceRevision: 0 }],
      }),
    });
    const body = (await res.json()) as { changes: Array<{ entityId: string }> };
    expect(body.changes.some((c) => c.entityId === languageId)).toBe(false);
  });
});

// ===================== character_technique =====================

describe('POST /api/v1/sync/operations -- character_technique', () => {
  async function createTechniqueViaSync(
    accessToken: string,
    characterId: string,
    attemptedValue: Record<string, unknown>,
  ) {
    const techniqueId = crypto.randomUUID();
    const body = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_technique' as const,
        entityId: techniqueId,
        command: 'create' as const,
        attemptedValue: { ...attemptedValue, characterId },
        parentId: characterId,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    return { techniqueId, outcome: body.outcomes[0] };
  }

  async function addSkill(accessToken: string, characterId: string, body: Record<string, unknown>) {
    const res = await app.request(`/api/v1/characters/${characterId}/skills`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
  }

  it('create → patch → delete all apply and the resolved level follows', async () => {
    const { accessToken } = await registerUser('sync-tech-crud');
    const character = await createCharacter(accessToken);
    await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ dx: 14 }),
    });
    await addSkill(accessToken, character.id, {
      name: 'Broadsword',
      attribute: 'DX',
      difficulty: 'A',
      points: 2,
    });

    const { techniqueId, outcome } = await createTechniqueViaSync(accessToken, character.id, {
      name: 'Feint',
      defaultSkillName: 'Broadsword',
      difficulty: 'A',
      points: 1,
    });
    expect(outcome?.status).toBe('applied');

    const afterCreate = await getCharacter(accessToken, character.id);
    expect((afterCreate.techniques as { level: number }[])[0]?.level).toBe(15);
    expect((afterCreate.points as Record<string, number>).techniques).toBe(1);

    const patch = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_technique' as const,
        entityId: techniqueId,
        command: 'patch' as const,
        fieldPath: 'points',
        attemptedValue: 4,
        baseRevision: outcome?.newRevision,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(patch.outcomes[0]?.status).toBe('applied');
    const afterPatch = await getCharacter(accessToken, character.id);
    expect((afterPatch.techniques as { level: number }[])[0]?.level).toBe(18);

    const del = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_technique' as const,
        entityId: techniqueId,
        command: 'delete' as const,
        attemptedValue: { characterId: character.id },
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(del.outcomes[0]?.status).toBe('applied');
    expect((await getCharacter(accessToken, character.id)).techniques).toEqual([]);
  });

  it('a create whose defaultSkillName is not on the sheet still applies, with a null level', async () => {
    const { accessToken } = await registerUser('sync-tech-nolevel');
    const character = await createCharacter(accessToken);
    const { outcome } = await createTechniqueViaSync(accessToken, character.id, {
      name: 'Feint',
      defaultSkillName: 'Broadsword',
      points: 2,
    });
    expect(outcome?.status).toBe('applied');
    const detail = await getCharacter(accessToken, character.id);
    expect((detail.techniques as { level: number | null }[])[0]?.level).toBeNull();
    // The points are still spent even though the technique can't roll yet.
    expect((detail.points as Record<string, number>).techniques).toBe(2);
  });

  it('a replayed create settles as applied and does not duplicate the row', async () => {
    const { accessToken } = await registerUser('sync-tech-replay');
    const character = await createCharacter(accessToken);
    const techniqueId = crypto.randomUUID();
    const createOp = () => ({
      clientOpId: crypto.randomUUID(),
      entityClass: 'character_technique' as const,
      entityId: techniqueId,
      command: 'create' as const,
      attemptedValue: {
        name: 'Feint',
        defaultSkillName: 'Broadsword',
        characterId: character.id,
      },
      parentId: character.id,
      validationVersion: 1,
      createdAt: new Date().toISOString(),
    });
    expect((await postOperations(accessToken, [createOp()])).outcomes[0]?.status).toBe('applied');
    expect((await postOperations(accessToken, [createOp()])).outcomes[0]?.status).toBe('applied');
    expect((await getCharacter(accessToken, character.id)).techniques).toHaveLength(1);
  });

  it('rejects an invalid difficulty and an unwritable fieldPath', async () => {
    const { accessToken } = await registerUser('sync-tech-reject');
    const character = await createCharacter(accessToken);
    const { techniqueId } = await createTechniqueViaSync(accessToken, character.id, {
      name: 'Feint',
      defaultSkillName: 'Broadsword',
    });

    const badValue = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_technique' as const,
        entityId: techniqueId,
        command: 'patch' as const,
        fieldPath: 'difficulty',
        attemptedValue: 'VH',
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(badValue.outcomes[0]?.status).toBe('rejected');

    const badField = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_technique' as const,
        entityId: techniqueId,
        command: 'patch' as const,
        fieldPath: 'level',
        attemptedValue: 99,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(badField.outcomes[0]?.status).toBe('rejected');
    expect(badField.outcomes[0]?.reason).toContain('not writable');
  });

  it('returns stale_base when the server row moved past the op base revision', async () => {
    const { accessToken } = await registerUser('sync-tech-stale');
    const character = await createCharacter(accessToken);
    const { techniqueId, outcome } = await createTechniqueViaSync(accessToken, character.id, {
      name: 'Feint',
      defaultSkillName: 'Broadsword',
      points: 1,
    });
    const staleBase = outcome?.newRevision as number;
    const bump = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_technique' as const,
        entityId: techniqueId,
        command: 'patch' as const,
        fieldPath: 'points',
        attemptedValue: 5,
        baseRevision: staleBase,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(bump.outcomes[0]?.status).toBe('applied');

    const stale = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_technique' as const,
        entityId: techniqueId,
        command: 'patch' as const,
        fieldPath: 'defaultSkillName',
        attemptedValue: 'Rapier',
        baseRevision: staleBase,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(stale.outcomes[0]?.status).toBe('stale_base');
  });

  it('a read-only campaign member cannot write another player’s technique (S12.1)', async () => {
    const gm = await registerUser('sync-tech-gm');
    const owner = await registerUser('sync-tech-owner');
    const viewer = await registerUser('sync-tech-viewer');
    const campaignRes = await app.request('/api/v1/campaigns', {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ name: `Camp ${Date.now()}-${Math.random()}` }),
    });
    const campaign = (await campaignRes.json()) as { id: string };
    for (const member of [owner, viewer]) {
      await app.request(`/api/v1/campaigns/${campaign.id}/members`, {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ email: member.email }),
      });
    }
    const charRes = await app.request('/api/v1/characters', {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ name: 'Shared PC', campaignId: campaign.id }),
    });
    const character = (await charRes.json()) as { id: string };

    const viewerCreate = await createTechniqueViaSync(viewer.accessToken, character.id, {
      name: 'Feint',
      defaultSkillName: 'Broadsword',
    });
    expect(viewerCreate.outcome?.status).toBe('unauthorized');

    const ownerCreate = await createTechniqueViaSync(owner.accessToken, character.id, {
      name: 'Feint',
      defaultSkillName: 'Broadsword',
    });
    expect(ownerCreate.outcome?.status).toBe('applied');

    const viewerPatch = await postOperations(viewer.accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_technique' as const,
        entityId: ownerCreate.techniqueId,
        command: 'patch' as const,
        fieldPath: 'points',
        attemptedValue: 99,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(viewerPatch.outcomes[0]?.status).toBe('unauthorized');
  });

  it('adopting a style: a batch of technique creates all apply under one batchId', async () => {
    const { accessToken } = await registerUser('sync-tech-style');
    const character = await createCharacter(accessToken);
    const batchId = crypto.randomUUID();
    const names = ['Feint', 'Disarming', 'Retain Weapon', 'Close Combat'];
    const ops = names.map((name) => ({
      clientOpId: crypto.randomUUID(),
      entityClass: 'character_technique' as const,
      entityId: crypto.randomUUID(),
      command: 'create' as const,
      attemptedValue: {
        name,
        defaultSkillName: 'Broadsword',
        difficulty: 'H',
        points: 2,
        characterId: character.id,
      },
      parentId: character.id,
      batchId,
      validationVersion: 1,
      createdAt: new Date().toISOString(),
    }));
    const body = await postOperations(accessToken, ops);
    expect(body.outcomes.every((o) => o.status === 'applied')).toBe(true);

    const detail = await getCharacter(accessToken, character.id);
    expect(detail.techniques).toHaveLength(4);
    expect((detail.points as Record<string, number>).techniques).toBe(8);

    const historyRes = await app.request(`/api/v1/characters/${character.id}/history`, {
      headers: bearer(accessToken),
    });
    const events = (await historyRes.json()) as { entityClass: string; batchId: string | null }[];
    const techEvents = events.filter((e) => e.entityClass === 'character_technique');
    expect(techEvents).toHaveLength(4);
    expect(new Set(techEvents.map((e) => e.batchId))).toEqual(new Set([batchId]));
  });

  it('a cursor pull returns technique rows and their tombstone after deletion', async () => {
    const { accessToken } = await registerUser('sync-tech-cursor');
    const character = await createCharacter(accessToken);
    const { techniqueId } = await createTechniqueViaSync(accessToken, character.id, {
      name: 'Feint',
      defaultSkillName: 'Broadsword',
      difficulty: 'H',
      points: 2,
    });

    const pull = async (since: number) => {
      const res = await app.request('/api/v1/sync/cursor', {
        method: 'POST',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({
          cursors: [{ entityClass: 'character_technique', sinceRevision: since }],
        }),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as {
        changes: Array<{
          entityId: string;
          command: string;
          data?: Record<string, unknown>;
        }>;
        nextCursor: Record<string, number>;
      };
    };

    const first = await pull(0);
    const upsert = first.changes.find((c) => c.entityId === techniqueId);
    expect(upsert?.command).toBe('patch');
    expect(upsert?.data?.defaultSkillName).toBe('Broadsword');
    expect(upsert?.data?.difficulty).toBe('H');

    await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_technique' as const,
        entityId: techniqueId,
        command: 'delete' as const,
        attemptedValue: { characterId: character.id },
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    const second = await pull(first.nextCursor.character_technique ?? 0);
    expect(second.changes.find((c) => c.entityId === techniqueId)?.command).toBe('delete');
  });

  it('create and patch carry the default modifier into the computed level', async () => {
    const { accessToken } = await registerUser('sync-tech-defaultmod');
    const character = await createCharacter(accessToken);
    await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ dx: 14 }),
    });
    await addSkill(accessToken, character.id, {
      name: 'Riding',
      attribute: 'DX',
      difficulty: 'A',
      points: 8,
    });

    const { techniqueId, outcome } = await createTechniqueViaSync(accessToken, character.id, {
      name: 'Combat Riding',
      defaultSkillName: 'Riding',
      difficulty: 'H',
      points: 0,
      defaultModifier: -7,
    });
    expect(outcome?.status).toBe('applied');
    const afterCreate = await getCharacter(accessToken, character.id);
    // Riding is DX 14 +2 (8 pts Average) = 16; default line -7 => 9, not 16.
    const created = (
      afterCreate.techniques as Array<{ level: number; defaultModifier: number }>
    )[0];
    expect(created?.defaultModifier).toBe(-7);
    expect(created?.level).toBe(9);

    const patch = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_technique' as const,
        entityId: techniqueId,
        command: 'patch' as const,
        fieldPath: 'defaultModifier',
        attemptedValue: -3,
        baseRevision: outcome?.newRevision,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(patch.outcomes[0]?.status).toBe('applied');
    const afterPatch = await getCharacter(accessToken, character.id);
    expect((afterPatch.techniques as Array<{ level: number }>)[0]?.level).toBe(13);
  });
});

describe('POST /api/v1/sync/operations -- inventory enchantments', () => {
  it('creates an item with enchantments and patches the list through fieldPath', async () => {
    const { accessToken } = await registerUser('sync-enchant');
    const character = await createCharacter(accessToken);

    const itemId = crypto.randomUUID();
    const created = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_inventory' as const,
        entityId: itemId,
        command: 'create' as const,
        attemptedValue: {
          name: 'Phoenix Cloak',
          enchantments: [{ spellName: 'Deflect', category: 'Deflect +2' }],
        },
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(created.outcomes[0]?.status).toBe('applied');
    const revision = created.outcomes[0]?.newRevision as number;

    // A whole-list patch replaces the column (S2/S3 semantics: the bare
    // array is the value, same as any other field).
    const patched = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_inventory' as const,
        entityId: itemId,
        command: 'patch' as const,
        fieldPath: 'enchantments',
        attemptedValue: [
          { spellName: 'Deflect', category: 'Deflect +2' },
          { spellName: 'Fortify', spellLevel: 18, category: 'Fortify +3' },
        ],
        baseRevision: revision,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(patched.outcomes[0]?.status).toBe('applied');

    const detail = (await getCharacter(accessToken, character.id)) as unknown as {
      inventory: Array<{ id: string; enchantments: unknown[] }>;
    };
    const item = detail.inventory.find((i) => i.id === itemId);
    expect(item?.enchantments).toEqual([
      { spellName: 'Deflect', category: 'Deflect +2' },
      { spellName: 'Fortify', spellLevel: 18, category: 'Fortify +3' },
    ]);
  });

  it('rejects an enchantments patch carrying a blank spell name', async () => {
    const { accessToken } = await registerUser('sync-enchant-bad');
    const character = await createCharacter(accessToken);

    const itemId = crypto.randomUUID();
    const created = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_inventory' as const,
        entityId: itemId,
        command: 'create' as const,
        attemptedValue: { name: 'Cloak' },
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    const revision = created.outcomes[0]?.newRevision as number;

    const rejected = await postOperations(accessToken, [
      {
        clientOpId: crypto.randomUUID(),
        entityClass: 'character_inventory' as const,
        entityId: itemId,
        command: 'patch' as const,
        fieldPath: 'enchantments',
        attemptedValue: [{ spellName: '' }],
        baseRevision: revision,
        parentId: character.id,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(rejected.outcomes[0]?.status).toBe('rejected');
  });
});
