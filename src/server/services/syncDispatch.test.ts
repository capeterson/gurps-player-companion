/**
 * Pure schema/dispatcher tests that do NOT require a live Postgres.
 * The DB-dependent paths (apply, stale_base, conflict, etc.) are
 * exercised manually via the docker-compose dev stack.
 *
 * The `POST /api/v1/sync/operations` describe block below is the one
 * exception: field-writability parity (AGENTS.md S12.3 -- the sync
 * whitelist must match what the client is allowed to enqueue) can only
 * be observed by actually running an op through `dispatchOperation`'s
 * DB-backed `patchEntity` path, so it goes through the same
 * `createApp` + live-Postgres harness `routes/characters.test.ts` uses.
 */

import { describe, expect, it } from 'bun:test';
import {
  operationEnvelope,
  syncOperationsRequest,
  syncOperationsResponse,
} from '../../shared/schemas/sync.ts';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { dispatchOperation } from './syncDispatch.ts';

describe('sync schemas', () => {
  it('parses a well-formed envelope', () => {
    const ok = operationEnvelope.parse({
      clientOpId: '0193b3c0-f1f0-7000-8000-000000000001',
      entityClass: 'character',
      entityId: '0193b3c0-f1f0-7000-8000-000000000002',
      command: 'patch',
      fieldPath: 'st',
      attemptedValue: 12,
      validationVersion: 1,
      createdAt: new Date().toISOString(),
    });
    expect(ok.entityClass).toBe('character');
    expect(ok.command).toBe('patch');
  });

  it('rejects an unknown entity class', () => {
    const result = operationEnvelope.safeParse({
      clientOpId: '0193b3c0-f1f0-7000-8000-000000000001',
      entityClass: 'no_such_thing',
      entityId: '0193b3c0-f1f0-7000-8000-000000000002',
      command: 'patch',
      attemptedValue: 12,
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it('caps batches at 50 operations', () => {
    const op = {
      clientOpId: '0193b3c0-f1f0-7000-8000-000000000001',
      entityClass: 'character' as const,
      entityId: '0193b3c0-f1f0-7000-8000-000000000002',
      command: 'patch' as const,
      fieldPath: 'st',
      attemptedValue: 12,
      validationVersion: 1,
      createdAt: new Date().toISOString(),
    };
    const tooMany = syncOperationsRequest.safeParse({
      operations: Array.from({ length: 51 }, () => op),
    });
    expect(tooMany.success).toBe(false);
  });

  it('round-trips an outcomes payload', () => {
    const payload = {
      outcomes: [
        {
          clientOpId: '0193b3c0-f1f0-7000-8000-000000000001',
          status: 'applied' as const,
          newRevision: 42,
        },
        {
          clientOpId: '0193b3c0-f1f0-7000-8000-000000000003',
          status: 'rejected' as const,
          reason: 'ST must be >= 1',
        },
      ],
    };
    expect(syncOperationsResponse.parse(payload)).toEqual(payload);
  });
});

describe('dispatchOperation (DB-free branches)', () => {
  it('rejects an op against an unsupported entity class', async () => {
    // campaign_library_trait has no dispatcher branch yet — this hits
    // the default in dispatchOperationInner and returns rejected
    // without touching the DB.
    const outcome = await dispatchOperation(
      { userId: '0193b3c0-f1f0-7000-8000-000000000010' },
      {
        clientOpId: '0193b3c0-f1f0-7000-8000-000000000011',
        entityClass: 'campaign_library_trait',
        entityId: '0193b3c0-f1f0-7000-8000-000000000012',
        command: 'patch',
        fieldPath: 'name',
        attemptedValue: 'whatever',
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    );
    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toMatch(/not yet supported/);
  });

  it('rejects a delete op on combat state (combat is not deletable)', async () => {
    const outcome = await dispatchOperation(
      { userId: '0193b3c0-f1f0-7000-8000-000000000010' },
      {
        clientOpId: '0193b3c0-f1f0-7000-8000-000000000020',
        entityClass: 'character_combat',
        entityId: '0193b3c0-f1f0-7000-8000-000000000021',
        command: 'delete',
        attemptedValue: null,
        validationVersion: 1,
        createdAt: new Date().toISOString(),
      },
    );
    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toMatch(/not deletable/);
  });
});

// ---------- field-writability parity (AGENTS.md S12.3) ----------

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return { ...bearer(token), 'content-type': 'application/json' };
}

async function registerUser(suffix: string) {
  const email = `sync-dispatch-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Test ${suffix}` }),
  });
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken };
}

async function createCharacter(accessToken: string): Promise<{ id: string; revision: number }> {
  const res = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Sync dispatch test ${Date.now()}-${Math.random()}` }),
  });
  const body = (await res.json()) as { id: string; revision: number };
  return body;
}

describe('POST /api/v1/sync/operations -- character field writability parity', () => {
  it('accepts a valid tempEffects array patch', async () => {
    const { accessToken } = await registerUser('temp-effects-ok');
    const character = await createCharacter(accessToken);
    const res = await app.request('/api/v1/sync/operations', {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        operations: [
          {
            clientOpId: '0193b3c0-f1f0-7000-8000-0000000000a1',
            entityClass: 'character',
            entityId: character.id,
            command: 'patch',
            fieldPath: 'tempEffects',
            attemptedValue: [{ id: 'e1', name: 'Might', mods: { st: 2, ht: 1 } }],
            baseRevision: character.revision,
            validationVersion: 1,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcomes: Array<{ status: string }> };
    expect(body.outcomes[0]?.status).toBe('applied');
  });

  it('rejects an invalid tempEffects array (unknown axis key)', async () => {
    const { accessToken } = await registerUser('temp-effects-bad');
    const character = await createCharacter(accessToken);
    const res = await app.request('/api/v1/sync/operations', {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        operations: [
          {
            clientOpId: '0193b3c0-f1f0-7000-8000-0000000000a2',
            entityClass: 'character',
            entityId: character.id,
            command: 'patch',
            fieldPath: 'tempEffects',
            attemptedValue: [{ id: 'e1', name: 'Might', mods: { strength: 2 } }],
            baseRevision: character.revision,
            validationVersion: 1,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcomes: Array<{ status: string }> };
    expect(body.outcomes[0]?.status).toBe('rejected');
  });

  it('rejects tempSt as no longer writable -- the scalar field was replaced by tempEffects', async () => {
    const { accessToken } = await registerUser('temp-st-gone');
    const character = await createCharacter(accessToken);
    const res = await app.request('/api/v1/sync/operations', {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        operations: [
          {
            clientOpId: '0193b3c0-f1f0-7000-8000-0000000000a3',
            entityClass: 'character',
            entityId: character.id,
            command: 'patch',
            fieldPath: 'tempSt',
            attemptedValue: 5,
            baseRevision: character.revision,
            validationVersion: 1,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcomes: Array<{ status: string; reason?: string }> };
    expect(body.outcomes[0]?.status).toBe('rejected');
    expect(body.outcomes[0]?.reason).toMatch(/not writable/);
  });
});
