/**
 * Campaign-library sync (AGENTS.md S0/S11/S13): library entries are created,
 * whole-entry patched and deleted through the outbox and reconciled by the
 * cursor, with the same guarantees as the character classes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationEnvelope } from '../../shared/schemas/sync.ts';
import { type LocalLibrarySkill, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { type FlashEvent, flashBus } from './flashBus.ts';
import {
  getSyncOrchestrator,
  resetSyncOrchestratorForTests,
  setRejectionNotifier,
} from './orchestrator.ts';
import { enqueueCreate, enqueueDelete, enqueueEntityPatch } from './outbox.ts';
import { syncStateStore } from './state.ts';

const CAMPAIGN = '0193b3c0-f1f0-7000-8000-00000000ca01';
const SKILL_A = '0193b3c0-f1f0-7000-8000-00000000a001';
const SKILL_B = '0193b3c0-f1f0-7000-8000-00000000b001';
const NEW_LIBRARY_ROWS = [
  {
    label: 'language',
    entityClass: 'campaign_library_language',
    store: 'campaignLibraryLanguages',
    entityId: '0193b3c0-f1f0-7000-8000-00000000c001',
    attemptedValue: { name: 'Trade', isSignLanguage: false },
    baseValue: { name: 'Trade', description: 'Server text', source: 'B222', isSignLanguage: false },
  },
  {
    label: 'technique',
    entityClass: 'campaign_library_technique',
    store: 'campaignLibraryTechniques',
    entityId: '0193b3c0-f1f0-7000-8000-00000000c002',
    attemptedValue: { name: 'Feint', defaultSkillName: 'Sword', difficulty: 'A' },
    baseValue: {
      name: 'Feint',
      defaultSkillName: 'Sword',
      difficulty: 'A',
      maxLevel: null,
      defaultModifier: 0,
      description: 'Server text',
      source: 'B222',
      prereq: null,
    },
  },
  {
    label: 'style',
    entityClass: 'campaign_library_style',
    store: 'campaignLibraryStyles',
    entityId: '0193b3c0-f1f0-7000-8000-00000000c003',
    attemptedValue: { name: 'Sword Style', techniques: [], perks: [], skills: [] },
    baseValue: {
      name: 'Sword Style',
      description: 'Server text',
      source: 'B222',
      techniques: [],
      perks: [],
      skills: [],
    },
  },
] as const;

function libraryTable(store: string) {
  return (
    getLocalDb() as unknown as Record<
      string,
      { get: (id: string) => Promise<unknown>; put: (row: unknown) => Promise<unknown> }
    >
  )[store];
}

function categoryRow(
  entityId: string,
  value: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: entityId,
    campaignId: CAMPAIGN,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 5,
    ...value,
    ...overrides,
  };
}

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function skill(id: string, overrides: Partial<LocalLibrarySkill> = {}): LocalLibrarySkill {
  return {
    id,
    campaignId: CAMPAIGN,
    name: id === SKILL_A ? 'Stealth' : 'Climbing',
    attribute: 'DX',
    difficulty: 'A',
    techLevel: null,
    techLevelPolicy: { kind: 'not_applicable' },
    description: 'Server text',
    source: null,
    defaultSpecialization: null,
    specializationPolicy: { kind: 'none' },
    defaults: null,
    prerequisites: null,
    prerequisiteRules: null,
    groups: [],
    tags: [],
    procedures: [],
    situationalModifiers: [],
    effects: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 5,
    ...overrides,
  } as LocalLibrarySkill;
}

type Outcome = Record<string, unknown>;

/**
 * Route `/sync/operations` to `respond` (which may return a deferred
 * promise to model a slow save) and answer `/sync/cursor` with `cursor()`.
 */
function stubServer(
  respond: (ops: OperationEnvelope[]) => Promise<Outcome[]> | Outcome[],
  cursor: () => unknown[] = () => [],
) {
  const sent: OperationEnvelope[][] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/sync/operations')) {
      const { operations } = JSON.parse(String(init?.body)) as { operations: OperationEnvelope[] };
      sent.push(operations);
      return json({ outcomes: await respond(operations) });
    }
    return json({ changes: cursor(), nextCursor: {}, hasMore: {} });
  });
  vi.stubGlobal('fetch', fetchMock);
  return sent;
}

function drain(): Promise<number | undefined> {
  return (
    getSyncOrchestrator() as unknown as { maybeDrainOnce(): Promise<number | undefined> }
  ).maybeDrainOnce();
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setRejectionNotifier(null);
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  syncStateStore.reset('synced');
  await resetLocalDb();
});

function login() {
  tokenStore.write({
    accessToken: jwtForUser('owner'),
    refreshToken: 'refresh',
    accessTokenExpiresIn: 0,
  });
  getSyncOrchestrator().setCurrentUser('owner');
}

describe('campaign library outbox path', () => {
  it.each(NEW_LIBRARY_ROWS)(
    'creates a campaign $label locally and adopts the server revision',
    async ({ entityClass, entityId, attemptedValue, store }) => {
      login();
      await enqueueCreate({
        entityClass,
        entityId,
        campaignId: CAMPAIGN,
        attemptedValue,
        humanName: `library ${entityClass.split('_').at(-1)}`,
      });
      const db = getLocalDb();
      const table = libraryTable(store);
      expect(await table?.get(entityId)).toMatchObject({
        id: entityId,
        campaignId: CAMPAIGN,
        revision: -1,
        ...attemptedValue,
      });
      const sent = stubServer((ops) =>
        ops.map((op) => ({ clientOpId: op.clientOpId, status: 'applied', newRevision: 31 })),
      );

      await drain();

      expect(sent[0]?.[0]).toMatchObject({
        entityClass,
        entityId,
        command: 'create',
        parentId: CAMPAIGN,
      });
      expect(sent[0]?.[0]?.attemptedValue).not.toHaveProperty('campaignId');
      expect(await table?.get(entityId)).toMatchObject({ revision: 31 });
      expect(await db.outbox.count()).toBe(0);
    },
  );

  it.each(NEW_LIBRARY_ROWS)(
    'rolls back a rejected $label edit with a persisted toast and entry flash',
    async ({ entityClass, entityId, label, store, baseValue }) => {
      login();
      const table = libraryTable(store);
      const before = categoryRow(entityId, baseValue);
      await table?.put(before);
      await enqueueEntityPatch({
        entityClass,
        entityId,
        campaignId: CAMPAIGN,
        attemptedValue: { description: 'Rejected local text' },
        humanName: `library ${label} "${String(baseValue.name)}"`,
      });
      const flashes: FlashEvent[] = [];
      const off = flashBus.subscribePrefix(`${entityClass}:${entityId}:`, (event) =>
        flashes.push(event),
      );
      const toasts: string[] = [];
      setRejectionNotifier((record) => toasts.push(`${record.humanName} — ${record.reason}`));
      const sent = stubServer((ops) =>
        ops.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'rejected',
          reason: 'invalid entry',
        })),
      );

      await drain();
      off();

      expect(sent[0]?.[0]).toMatchObject({ entityClass, entityId, parentId: CAMPAIGN });
      expect(await table?.get(entityId)).toMatchObject({
        id: entityId,
        campaignId: CAMPAIGN,
        revision: 5,
        ...baseValue,
      });
      expect(await getLocalDb().rejectionToasts.toArray()).toEqual([
        expect.objectContaining({ entityId, reason: 'invalid entry', status: 'rejected' }),
      ]);
      expect(toasts).toEqual([`library ${label} "${String(baseValue.name)}" — invalid entry`]);
      expect(flashes.map((event) => event.key)).toEqual([`${entityClass}:${entityId}:entry`]);
    },
  );

  it.each(NEW_LIBRARY_ROWS)(
    'queues same-entry and different-entry $label edits through a slow save',
    async ({ entityClass, entityId, label, store, baseValue }) => {
      login();
      const table = libraryTable(store);
      const otherId = `${entityId.slice(0, -1)}4`;
      await table?.put(categoryRow(entityId, baseValue));
      await table?.put(
        categoryRow(otherId, baseValue, { name: `Other ${String(baseValue.name)}` }),
      );
      await enqueueEntityPatch({
        entityClass,
        entityId,
        campaignId: CAMPAIGN,
        attemptedValue: { description: 'First' },
      });
      let release!: () => void;
      const firstSettles = new Promise<void>((resolve) => {
        release = resolve;
      });
      let revision = 5;
      const sent = stubServer(async (ops) => {
        if (sent.length === 1) await firstSettles;
        return ops.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'applied',
          newRevision: ++revision,
        }));
      });

      const firstDrain = drain();
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      await enqueueEntityPatch({
        entityClass,
        entityId,
        campaignId: CAMPAIGN,
        attemptedValue: { description: 'Second' },
      });
      await enqueueEntityPatch({
        entityClass,
        entityId: otherId,
        campaignId: CAMPAIGN,
        attemptedValue: { description: 'Other entry edit' },
      });
      release();
      await firstDrain;
      await drain();

      const operations = sent.flat();
      expect(
        operations.filter((op) => op.entityId === entityId).map((op) => op.attemptedValue),
      ).toEqual([{ description: 'First' }, { description: 'Second' }]);
      expect(operations).toContainEqual(
        expect.objectContaining({
          entityId: otherId,
          attemptedValue: { description: 'Other entry edit' },
        }),
      );
      expect(await table?.get(entityId)).toMatchObject({ description: 'Second' });
      expect(await table?.get(otherId)).toMatchObject({ description: 'Other entry edit' });
      expect(await getLocalDb().outbox.count()).toBe(0);
      expect(label).toBeTruthy();
    },
  );

  it.each(NEW_LIBRARY_ROWS)(
    'preserves pending $label fields while applying unrelated cursor data',
    async ({ entityClass, entityId, store, baseValue }) => {
      login();
      const table = libraryTable(store);
      await table?.put(categoryRow(entityId, baseValue));
      await enqueueEntityPatch({
        entityClass,
        entityId,
        campaignId: CAMPAIGN,
        attemptedValue: { name: 'Local name', description: 'Local text' },
      });
      stubServer(
        () => [],
        () => [
          {
            entityClass,
            entityId,
            command: 'patch',
            revision: 9,
            data: categoryRow(entityId, baseValue, {
              name: 'Server name',
              description: 'Server rewrite',
              source: 'C333',
              revision: 9,
            }),
          },
        ],
      );

      await getSyncOrchestrator().triggerCursorPull();

      expect(await table?.get(entityId)).toMatchObject({
        name: 'Local name',
        description: 'Local text',
        source: 'C333',
        revision: 9,
      });
    },
  );

  it('creates locally under the campaign, sends it with parentId, and stamps the revision', async () => {
    login();
    await enqueueCreate({
      entityClass: 'campaign_library_skill',
      entityId: SKILL_A,
      campaignId: CAMPAIGN,
      attemptedValue: { name: 'Stealth', attribute: 'DX', difficulty: 'A' },
      humanName: 'library skill "Stealth"',
    });
    const db = getLocalDb();
    expect(await db.campaignLibrarySkills.get(SKILL_A)).toMatchObject({
      campaignId: CAMPAIGN,
      name: 'Stealth',
      revision: -1,
    });
    const sent = stubServer((ops) =>
      ops.map((op) => ({ clientOpId: op.clientOpId, status: 'applied', newRevision: 41 })),
    );

    await drain();

    expect(sent[0]?.[0]).toMatchObject({
      entityClass: 'campaign_library_skill',
      command: 'create',
      parentId: CAMPAIGN,
    });
    // The strict create body never carries the campaign id.
    expect(sent[0]?.[0]?.attemptedValue).not.toHaveProperty('campaignId');
    expect(await db.campaignLibrarySkills.get(SKILL_A)).toMatchObject({ revision: 41 });
    expect(await db.outbox.count()).toBe(0);
    await vi.waitFor(() => expect(syncStateStore.value).toBe('synced'), { timeout: 3000 });
  });

  it('reverts a rejected whole-entry patch, persists the toast and flashes the entry', async () => {
    login();
    const db = getLocalDb();
    await db.campaignLibrarySkills.put(skill(SKILL_A));
    await enqueueEntityPatch({
      entityClass: 'campaign_library_skill',
      entityId: SKILL_A,
      campaignId: CAMPAIGN,
      attemptedValue: { name: 'Stealth', description: 'Rejected text', difficulty: 'H' },
      humanName: 'library skill "Stealth"',
    });
    expect(await db.campaignLibrarySkills.get(SKILL_A)).toMatchObject({
      description: 'Rejected text',
      difficulty: 'H',
    });
    const flashes: FlashEvent[] = [];
    const off = flashBus.subscribePrefix(`campaign_library_skill:${SKILL_A}:`, (event) =>
      flashes.push(event),
    );
    const toasts: string[] = [];
    setRejectionNotifier((record) => toasts.push(`${record.humanName} — ${record.reason}`));
    const sent = stubServer((ops) =>
      ops.map((op) => ({ clientOpId: op.clientOpId, status: 'rejected', reason: 'name taken' })),
    );

    await drain();
    off();

    expect(sent[0]?.[0]).toMatchObject({ command: 'patch', parentId: CAMPAIGN, baseRevision: 5 });
    expect(sent[0]?.[0]?.fieldPath).toBeUndefined();
    expect(await db.campaignLibrarySkills.get(SKILL_A)).toMatchObject({
      description: 'Server text',
      difficulty: 'A',
    });
    expect(await db.rejectionToasts.toArray()).toEqual([
      expect.objectContaining({ entityId: SKILL_A, reason: 'name taken', status: 'rejected' }),
    ]);
    expect(toasts).toEqual(['library skill "Stealth" — name taken']);
    expect(flashes.map((event) => event.key)).toEqual([`campaign_library_skill:${SKILL_A}:entry`]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('queues a same-entry edit behind a slow save and sends the later value last', async () => {
    login();
    const db = getLocalDb();
    await db.campaignLibrarySkills.put(skill(SKILL_A));
    await enqueueEntityPatch({
      entityClass: 'campaign_library_skill',
      entityId: SKILL_A,
      campaignId: CAMPAIGN,
      attemptedValue: { description: 'First' },
    });
    let release!: () => void;
    const firstSettles = new Promise<void>((resolve) => {
      release = resolve;
    });
    let revision = 5;
    const sent = stubServer(async (ops) => {
      if (sent.length === 1) await firstSettles;
      return ops.map((op) => ({
        clientOpId: op.clientOpId,
        status: 'applied',
        newRevision: ++revision,
      }));
    });

    const firstDrain = drain();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    // The user edits the same entry again while the first save is in flight.
    await enqueueEntityPatch({
      entityClass: 'campaign_library_skill',
      entityId: SKILL_A,
      campaignId: CAMPAIGN,
      attemptedValue: { description: 'Second' },
    });
    const queued = await db.outbox.toArray();
    expect(queued.map((op) => op.status).sort()).toEqual(['in_flight', 'pending']);
    expect(queued.find((op) => op.status === 'pending')?.predecessorClientOpId).toBe(
      queued.find((op) => op.status === 'in_flight')?.clientOpId,
    );
    release();
    await firstDrain;
    await drain();

    expect(
      sent.map((batch) =>
        batch.map((op) => (op.attemptedValue as { description: string }).description),
      ),
    ).toEqual([['First'], ['Second']]);
    expect(await db.campaignLibrarySkills.get(SKILL_A)).toMatchObject({ description: 'Second' });
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps a different entry edited during a slow save when the first save returns', async () => {
    login();
    const db = getLocalDb();
    await db.campaignLibrarySkills.bulkPut([skill(SKILL_A), skill(SKILL_B)]);
    await enqueueEntityPatch({
      entityClass: 'campaign_library_skill',
      entityId: SKILL_A,
      campaignId: CAMPAIGN,
      attemptedValue: { description: 'A edit' },
    });
    let release!: () => void;
    const firstSettles = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent = stubServer(
      async (ops) => {
        if (sent.length === 1) await firstSettles;
        return ops.map((op) => ({ clientOpId: op.clientOpId, status: 'applied', newRevision: 20 }));
      },
      // The post-drain pull returns the pre-edit server copy of B.
      () => [
        {
          entityClass: 'campaign_library_skill',
          entityId: SKILL_A,
          command: 'patch',
          revision: 20,
          data: skill(SKILL_A, { description: 'A edit', revision: 20 }),
        },
        {
          entityClass: 'campaign_library_skill',
          entityId: SKILL_B,
          command: 'patch',
          revision: 6,
          data: skill(SKILL_B, { description: 'Server text', revision: 6 }),
        },
      ],
    );
    const firstDrain = drain();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await enqueueEntityPatch({
      entityClass: 'campaign_library_skill',
      entityId: SKILL_B,
      campaignId: CAMPAIGN,
      attemptedValue: { description: 'B edit' },
    });
    release();
    await firstDrain;

    expect(await db.campaignLibrarySkills.get(SKILL_A)).toMatchObject({
      description: 'A edit',
      revision: 20,
    });
    expect(await db.campaignLibrarySkills.get(SKILL_B)).toMatchObject({ description: 'B edit' });
    await drain();
    expect(sent.at(-1)?.[0]).toMatchObject({
      entityId: SKILL_B,
      attemptedValue: { description: 'B edit' },
    });
  });

  it('protects every key of a pending whole-entry patch from a stale cursor row (S4)', async () => {
    login();
    const db = getLocalDb();
    await db.campaignLibrarySkills.put(skill(SKILL_A));
    await enqueueEntityPatch({
      entityClass: 'campaign_library_skill',
      entityId: SKILL_A,
      campaignId: CAMPAIGN,
      attemptedValue: { name: 'Stealth (local)', description: 'Local text' },
    });
    stubServer(
      () => [],
      () => [
        {
          entityClass: 'campaign_library_skill',
          entityId: SKILL_A,
          command: 'patch',
          revision: 9,
          data: skill(SKILL_A, {
            name: 'Stealth (server)',
            description: 'Server rewrite',
            source: 'B222',
            revision: 9,
          }),
        },
      ],
    );

    await getSyncOrchestrator().triggerCursorPull();

    expect(await db.campaignLibrarySkills.get(SKILL_A)).toMatchObject({
      name: 'Stealth (local)',
      description: 'Local text',
      source: 'B222',
      revision: 9,
    });
  });

  it('resends a stale-base patch when the server did not touch the edited keys', async () => {
    login();
    const db = getLocalDb();
    await db.campaignLibrarySkills.put(skill(SKILL_A));
    await enqueueEntityPatch({
      entityClass: 'campaign_library_skill',
      entityId: SKILL_A,
      campaignId: CAMPAIGN,
      attemptedValue: { description: 'Mine' },
    });
    const sent = stubServer((ops) =>
      ops.map((op) =>
        sent.length === 1
          ? {
              clientOpId: op.clientOpId,
              status: 'stale_base',
              reason: 'newer server revision',
              // Another device changed only the source.
              latestEntity: skill(SKILL_A, { source: 'B222', revision: 7 }),
            }
          : { clientOpId: op.clientOpId, status: 'applied', newRevision: 8 },
      ),
    );

    await drain();
    const [requeued] = await db.outbox.toArray();
    expect(requeued).toMatchObject({ baseRevision: 7, attemptedValue: { description: 'Mine' } });
    expect(await db.rejectionToasts.count()).toBe(0);
    await drain();
    expect(sent[1]?.[0]).toMatchObject({ baseRevision: 7 });
    expect(await db.campaignLibrarySkills.get(SKILL_A)).toMatchObject({
      description: 'Mine',
      revision: 8,
    });
  });

  it('rolls back a stale-base patch when the server changed an edited key', async () => {
    login();
    const db = getLocalDb();
    await db.campaignLibrarySkills.put(skill(SKILL_A));
    await enqueueEntityPatch({
      entityClass: 'campaign_library_skill',
      entityId: SKILL_A,
      campaignId: CAMPAIGN,
      attemptedValue: { description: 'Mine' },
    });
    stubServer((ops) =>
      ops.map((op) => ({
        clientOpId: op.clientOpId,
        status: 'stale_base',
        reason: 'newer server revision',
        latestEntity: skill(SKILL_A, { description: 'Theirs', revision: 7 }),
      })),
    );

    await drain();

    expect(await db.campaignLibrarySkills.get(SKILL_A)).toMatchObject({
      description: 'Theirs',
      revision: 7,
    });
    expect(await db.rejectionToasts.count()).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('restores a library entry whose delete the server rejects', async () => {
    login();
    const db = getLocalDb();
    await db.campaignLibrarySkills.put(skill(SKILL_A));
    await enqueueDelete({
      entityClass: 'campaign_library_skill',
      entityId: SKILL_A,
      campaignId: CAMPAIGN,
      humanName: 'library skill "Stealth"',
    });
    expect(await db.campaignLibrarySkills.get(SKILL_A)).toBeUndefined();
    const sent = stubServer((ops) =>
      ops.map((op) => ({
        clientOpId: op.clientOpId,
        status: 'unauthorized',
        reason: 'owner required',
      })),
    );

    await drain();

    expect(sent[0]?.[0]).toMatchObject({ command: 'delete', parentId: CAMPAIGN });
    expect(await db.campaignLibrarySkills.get(SKILL_A)).toMatchObject({ name: 'Stealth' });
    expect(await db.rejectionToasts.toArray()).toEqual([
      expect.objectContaining({ status: 'unauthorized', reason: 'owner required' }),
    ]);
  });
});

describe('whole-entry patch coalescing (S3/S13)', () => {
  it('replaces a pending patch for the same entry and keeps the original baseline', async () => {
    const db = getLocalDb();
    await db.campaignLibrarySkills.put(skill(SKILL_A));
    for (const description of ['One', 'Two', 'Three']) {
      await enqueueEntityPatch({
        entityClass: 'campaign_library_skill',
        entityId: SKILL_A,
        campaignId: CAMPAIGN,
        attemptedValue: { description },
      });
    }
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      attemptedValue: { description: 'Three' },
      prevValue: expect.objectContaining({ description: 'Server text' }),
      coalesceKey: `${SKILL_A}|`,
    });
  });

  it('rejects library operations without their campaign id', async () => {
    await expect(
      enqueueCreate({
        entityClass: 'campaign_library_skill',
        entityId: SKILL_A,
        attemptedValue: { name: 'Stealth' },
      }),
    ).rejects.toThrow(/campaign id/);
  });
});
