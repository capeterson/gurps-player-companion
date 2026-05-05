/**
 * Pure schema/dispatcher tests that do NOT require a live Postgres.
 * The DB-dependent paths (apply, stale_base, conflict, etc.) are
 * exercised manually via the docker-compose dev stack.
 */

import { describe, expect, it } from 'bun:test';
import {
  operationEnvelope,
  syncOperationsRequest,
  syncOperationsResponse,
} from '../../shared/schemas/sync.ts';
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
