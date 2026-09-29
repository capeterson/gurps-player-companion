import { afterEach, describe, expect, it, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { withAudit } from '../db/auditContext.ts';
import { getDb, runInDbTransaction } from '../db/client.ts';
import {
  adventureLogEntries,
  campaignLibraryTraits,
  campaignMemberships,
  campaigns,
  characterTraits,
  characters,
  encounterCombatants,
  encounterEffects,
  encounters,
  entityHistory,
  entityTombstones,
  mediaAssets,
  users,
} from '../db/schema.ts';
import { configureIntegrationTestEnvironment } from '../testConfig.ts';
import {
  nextNightlyPurgeAt,
  startUserPurgeMaintenance,
  stopUserPurgeMaintenance,
  sweepUserPurges,
} from './userPurge.ts';
import { subscribe } from './wsBus.ts';

configureIntegrationTestEnvironment();
const userIds: string[] = [];
const campaignIds: string[] = [];
const assetIds: string[] = [];
const now = new Date();
const due = new Date(now.getTime() - 1000);

afterEach(async () => {
  if (assetIds.length)
    await getDb()
      .delete(mediaAssets)
      .where(inArray(mediaAssets.id, assetIds.splice(0)));
  if (campaignIds.length)
    await getDb()
      .delete(campaigns)
      .where(inArray(campaigns.id, campaignIds.splice(0)));
  if (userIds.length)
    await getDb()
      .delete(users)
      .where(inArray(users.id, userIds.splice(0)));
});

async function account(purgeScheduledAt: Date | null = due, suspendedAt: Date | null = due) {
  const [row] = await getDb()
    .insert(users)
    .values({
      email: `purge-test-${randomUUID()}@example.com`,
      displayName: 'Purge test',
      passwordHash: 'unused',
      purgeScheduledAt,
      suspendedAt,
    })
    .returning();
  if (!row) throw new Error('fixture failed');
  userIds.push(row.id);
  return row;
}
async function campaign(ownerId: string) {
  const [row] = await getDb()
    .insert(campaigns)
    .values({ ownerId, name: 'Purge fixture' })
    .returning();
  if (!row) throw new Error('fixture failed');
  campaignIds.push(row.id);
  return row;
}

describe('nightly account purge', () => {
  it('starts one unreferenced nightly timer, skips tests and clears it on shutdown', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const unref = mock(() => {});
    const fakeTimer = { unref };
    const schedule = mock((_callback: unknown, _delay?: number) => fakeTimer);
    const clear = mock((_timer: unknown) => {});
    globalThis.setTimeout = schedule as unknown as typeof setTimeout;
    globalThis.clearTimeout = clear as unknown as typeof clearTimeout;
    try {
      startUserPurgeMaintenance('test');
      expect(schedule).not.toHaveBeenCalled();
      const before = Date.now();
      startUserPurgeMaintenance('production');
      startUserPurgeMaintenance('production');
      expect(schedule).toHaveBeenCalledTimes(1);
      const delay = schedule.mock.calls[0]?.[1];
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(86400000);
      expect(before + (delay ?? 0)).toBeCloseTo(nextNightlyPurgeAt(new Date(before)).getTime(), -2);
      expect(unref).toHaveBeenCalledTimes(1);
      await stopUserPurgeMaintenance();
      expect(clear).toHaveBeenCalledWith(fakeTimer);
    } finally {
      await stopUserPurgeMaintenance();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it('schedules the next 03:00 UTC boundary across month/year and DST dates', () => {
    for (const [input, output] of [
      ['2026-09-29T02:59:59.999Z', '2026-09-29T03:00:00.000Z'],
      ['2026-09-29T03:00:00.000Z', '2026-09-30T03:00:00.000Z'],
      ['2026-12-31T23:59:00.000Z', '2027-01-01T03:00:00.000Z'],
      ['2026-03-08T10:00:00.000Z', '2026-03-09T03:00:00.000Z'],
    ] as const) {
      expect(nextNightlyPurgeAt(new Date(input)).toISOString()).toBe(output);
    }
  });

  it('only purges suspended, uncancelled, due accounts and is repeatable', async () => {
    const victim = await account(now);
    const future = await account(new Date(now.getTime() + 1));
    const cancelled = await account(null);
    const active = await account(due, null);
    expect(await sweepUserPurges(now)).toBe(1);
    const remaining = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, userIds));
    expect(remaining.map((row) => row.id).sort()).toEqual(
      [future.id, cancelled.id, active.id].sort(),
    );
    expect(remaining.some((row) => row.id === victim.id)).toBe(false);
    expect(await sweepUserPurges(now)).toBe(0);
  });

  it('deletes owned campaigns/characters and RESTRICT effects while preserving other players and audit/sync data', async () => {
    const victim = await account();
    const survivor = await account(null, null);
    const owned = await campaign(victim.id);
    const shared = await campaign(survivor.id);
    await getDb()
      .insert(campaignMemberships)
      .values([
        { campaignId: owned.id, userId: survivor.id, role: 'member' },
        { campaignId: shared.id, userId: victim.id, role: 'member' },
      ]);
    const fixtures = await withAudit(victim.id, undefined, async (tx) => {
      const [lost] = await tx
        .insert(characters)
        .values({ ownerId: victim.id, campaignId: shared.id, name: 'Deleted hero' })
        .returning();
      const [kept] = await tx
        .insert(characters)
        .values({ ownerId: survivor.id, campaignId: owned.id, name: 'Surviving hero' })
        .returning();
      const [source] = await tx
        .insert(campaignLibraryTraits)
        .values({ campaignId: owned.id, name: 'Retained trait', kind: 'advantage', basePoints: 5 })
        .returning();
      if (!lost || !kept || !source) throw new Error('fixture failed');
      const [trait] = await tx
        .insert(characterTraits)
        .values({
          characterId: kept.id,
          libraryTraitId: source.id,
          name: source.name,
          kind: 'advantage',
          points: 5,
          libraryMechanics: {
            sourceId: source.id,
            campaignId: owned.id,
            sourceRevision: source.revision,
            effects: null,
            detached: false,
          },
        })
        .returning();
      const [encounter] = await tx.insert(encounters).values({ campaignId: shared.id }).returning();
      if (!encounter || !trait) throw new Error('fixture failed');
      const [combatant] = await tx
        .insert(encounterCombatants)
        .values({ encounterId: encounter.id, kind: 'npc', name: 'Target' })
        .returning();
      if (!combatant) throw new Error('fixture failed');
      const [effect] = await tx
        .insert(encounterEffects)
        .values({
          encounterId: encounter.id,
          targetCombatantId: combatant.id,
          createdById: victim.id,
          name: 'Expired creator',
          duration: { unit: 'indefinite' },
          startedAtRound: 1,
        })
        .returning();
      return { lost, kept, trait, effect };
    });
    const [asset] = await getDb()
      .insert(mediaAssets)
      .values({
        uploaderId: victim.id,
        clientUploadId: randomUUID(),
        targetType: 'character',
        targetId: fixtures.lost.id,
        inputBytes: 10,
        sha256: 'a'.repeat(64),
        token: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      })
      .returning();
    if (!asset) throw new Error('fixture failed');
    assetIds.push(asset.id);
    const frames: string[] = [];
    const unsubscribe = subscribe(survivor.id, { send: (frame) => frames.push(frame) });
    try {
      expect(await sweepUserPurges(now)).toBe(1);
    } finally {
      unsubscribe();
    }
    expect(await getDb().select().from(users).where(eq(users.id, victim.id))).toHaveLength(0);
    expect(await getDb().select().from(campaigns).where(eq(campaigns.id, owned.id))).toHaveLength(
      0,
    );
    expect(
      await getDb().select().from(characters).where(eq(characters.id, fixtures.lost.id)),
    ).toHaveLength(0);
    expect(
      await getDb()
        .select()
        .from(encounterEffects)
        .where(eq(encounterEffects.createdById, victim.id)),
    ).toHaveLength(0);
    const [kept] = await getDb()
      .select()
      .from(characters)
      .where(eq(characters.id, fixtures.kept.id));
    expect(kept?.campaignId).toBeNull();
    const [trait] = await getDb()
      .select()
      .from(characterTraits)
      .where(eq(characterTraits.id, fixtures.trait.id));
    expect(trait?.points).toBe(5);
    expect(trait?.libraryTraitId).toBeNull();
    expect(trait?.libraryMechanics?.detached).toBe(true);
    expect(
      (await getDb().select().from(campaigns).where(eq(campaigns.id, shared.id)))[0]?.revision,
    ).toBeGreaterThan(shared.revision);
    expect(
      (await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, asset.id)))[0]?.uploaderId,
    ).toBeNull();
    expect(
      await getDb()
        .select()
        .from(entityTombstones)
        .where(eq(entityTombstones.entityId, fixtures.lost.id)),
    ).toHaveLength(1);
    const events = await getDb()
      .select()
      .from(entityHistory)
      .where(and(eq(entityHistory.entityId, fixtures.lost.id), eq(entityHistory.op, 'delete')));
    expect(events).toHaveLength(1);
    expect(events[0]?.actorUserId).toBeNull();
    expect(frames.map((frame) => JSON.parse(frame).kind)).toEqual([
      'sync_invalidate',
      'encounter_invalidate',
    ]);
  });

  it('reverses authored log awards in surviving campaigns, including recipients who moved away', async () => {
    const victim = await account();
    const survivor = await account(null, null);
    const shared = await campaign(survivor.id);
    const [character] = await getDb()
      .insert(characters)
      .values({ ownerId: survivor.id, name: 'Award recipient', earnedPoints: 12 })
      .returning();
    if (!character) throw new Error('fixture failed');
    // The purged author no longer has a membership or character in this campaign.
    const [entry] = await getDb()
      .insert(adventureLogEntries)
      .values({
        authorId: victim.id,
        campaignId: shared.id,
        sessionDate: '2026-09-29',
        title: 'Past award',
        pointsGained: 5,
        xpAwards: [{ characterId: character.id, amount: 5 }],
      })
      .returning();
    if (!entry) throw new Error('fixture failed');
    expect(await sweepUserPurges(now)).toBe(1);
    expect(
      await getDb().select().from(adventureLogEntries).where(eq(adventureLogEntries.id, entry.id)),
    ).toHaveLength(0);
    expect(
      (await getDb().select().from(characters).where(eq(characters.id, character.id)))[0]
        ?.earnedPoints,
    ).toBe(7);
    expect(
      (await getDb().select().from(campaigns).where(eq(campaigns.id, shared.id)))[0]?.revision,
    ).toBeGreaterThan(shared.revision);
    const events = await getDb()
      .select()
      .from(entityHistory)
      .where(and(eq(entityHistory.entityId, character.id), eq(entityHistory.op, 'update')));
    expect(events.at(-1)?.actorUserId).toBeNull();
  });

  it('honors a cancellation holding the account lock after enumeration', async () => {
    const victim = await account();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready = () => {};
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const cancellation = runInDbTransaction(async () => {
      await getDb().update(users).set({ purgeScheduledAt: null }).where(eq(users.id, victim.id));
      ready();
      await gate;
    });
    await started;
    try {
      expect(await sweepUserPurges(now)).toBe(0);
    } finally {
      release();
    }
    await cancellation;
    expect(await sweepUserPurges(now)).toBe(0);
    expect(await getDb().select().from(users).where(eq(users.id, victim.id))).toHaveLength(1);
  });

  it('does not run when another worker holds the advisory lock', async () => {
    await account();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready = () => {};
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const worker = runInDbTransaction(async () => {
      await getDb().execute(sql`select pg_advisory_xact_lock(hashtext('gpc:user-purge'))`);
      ready();
      await gate;
    });
    await started;
    try {
      expect(await sweepUserPurges(now)).toBe(0);
    } finally {
      release();
    }
    await worker;
    expect(await sweepUserPurges(now)).toBe(1);
  });

  it('rolls back one failed account and continues with other due accounts', async () => {
    const failed = await account();
    const success = await account();
    const owned = await campaign(failed.id);
    // A scoped failure at the last deletion proves preceding deletes roll back.
    await getDb().execute(
      sql.raw(
        `CREATE FUNCTION purge_test_failure() RETURNS trigger AS $$ BEGIN IF OLD.id = '${failed.id}'::uuid THEN RAISE EXCEPTION 'injected purge failure'; END IF; RETURN OLD; END; $$ LANGUAGE plpgsql`,
      ),
    );
    await getDb().execute(
      sql`CREATE TRIGGER purge_test_failure BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION purge_test_failure()`,
    );
    try {
      expect(await sweepUserPurges(now)).toBe(1);
      expect(await getDb().select().from(users).where(eq(users.id, failed.id))).toHaveLength(1);
      expect(await getDb().select().from(campaigns).where(eq(campaigns.id, owned.id))).toHaveLength(
        1,
      );
      expect(await getDb().select().from(users).where(eq(users.id, success.id))).toHaveLength(0);
    } finally {
      await getDb().execute(sql`DROP TRIGGER purge_test_failure ON users`);
      await getDb().execute(sql`DROP FUNCTION purge_test_failure()`);
    }
    expect(await sweepUserPurges(now)).toBe(1);
  });
});
