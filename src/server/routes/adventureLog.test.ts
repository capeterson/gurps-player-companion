/**
 * Integration tests for the adventure-log routes: session number and
 * location columns (migration 0030) — create round-trip, list projection,
 * edit-preserves, explicit-null clears, and validation bounds.
 *
 * Requires a running Postgres test DB configured by ../testConfig.ts.
 */

import { describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { XpAward } from '../../shared/schemas/adventureLog.ts';
import { createApp } from '../app.ts';
import { type AuditTx, withAudit } from '../db/auditContext.ts';
import { adventureLogEntries, characters } from '../db/schema.ts';
import { lockLogCampaign, resolveLogAwards } from '../services/adventureLogAwards.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);

function jsonHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function registerUser(suffix: string) {
  const email = `log-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Test ${suffix}` }),
  });
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, email };
}

async function createCampaign(accessToken: string): Promise<string> {
  const res = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Campaign ${Date.now()}-${Math.random()}` }),
  });
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function createEntry(
  accessToken: string,
  campaignId: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({
      sessionDate: '2026-01-15',
      title: 'Session 13 — The Hollow Beneath Greymoor',
      ...overrides,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, unknown>;
}

async function createCharacter(accessToken: string, campaignId: string, name: string) {
  const response = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name, campaignId }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function earnedPoints(accessToken: string, characterId: string) {
  const response = await app.request(`/api/v1/characters/${characterId}`, {
    headers: jsonHeaders(accessToken),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { earnedPoints: number }).earnedPoints;
}

describe('adventure-log sessionNumber + location', () => {
  it('creates an entry with both fields and returns them verbatim', async () => {
    const { accessToken } = await registerUser('log-create');
    const campaignId = await createCampaign(accessToken);
    const entry = await createEntry(accessToken, campaignId, {
      sessionNumber: 13,
      location: 'The Hollow Beneath Greymoor',
    });
    expect(entry.sessionNumber).toBe(13);
    expect(entry.location).toBe('The Hollow Beneath Greymoor');
  });

  it('defaults both fields to null when omitted', async () => {
    const { accessToken } = await registerUser('log-defaults');
    const campaignId = await createCampaign(accessToken);
    const entry = await createEntry(accessToken, campaignId);
    expect(entry.sessionNumber).toBeNull();
    expect(entry.location).toBeNull();
  });

  it('list returns the fields alongside existing columns', async () => {
    const { accessToken } = await registerUser('log-list');
    const campaignId = await createCampaign(accessToken);
    await createEntry(accessToken, campaignId, {
      sessionNumber: 7,
      location: 'Tal Cabal',
    });
    await createEntry(accessToken, campaignId, { title: 'No metadata' });

    const res = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
      headers: jsonHeaders(accessToken),
    });
    expect(res.status).toBe(200);
    const entries = (await res.json()) as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
    const withMeta = entries.find((e) => e.sessionNumber === 7);
    const withoutMeta = entries.find((e) => e.title === 'No metadata');
    expect(withMeta?.location).toBe('Tal Cabal');
    expect(withoutMeta?.sessionNumber).toBeNull();
    expect(withoutMeta?.location).toBeNull();
  });

  it('supports bounded search and offset pagination', async () => {
    const { accessToken } = await registerUser('log-filter');
    const campaignId = await createCampaign(accessToken);
    await createEntry(accessToken, campaignId, { title: 'Dragon one' });
    await createEntry(accessToken, campaignId, { title: 'Quiet interlude' });
    await createEntry(accessToken, campaignId, { title: 'Dragon two' });

    const response = await app.request(
      `/api/v1/campaigns/${campaignId}/log?search=dragon&limit=1&offset=1`,
      { headers: jsonHeaders(accessToken) },
    );
    expect(response.status).toBe(200);
    const entries = (await response.json()) as Array<{ title: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title.toLowerCase()).toContain('dragon');
  });

  it('PATCH updates the fields and preserves them on later partial edits', async () => {
    const { accessToken } = await registerUser('log-patch');
    const campaignId = await createCampaign(accessToken);
    const entry = await createEntry(accessToken, campaignId, {
      sessionNumber: 3,
      location: 'Old ruins',
    });

    // A patch that touches neither new field preserves both.
    const res = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ title: 'Retitled' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated.title).toBe('Retitled');
    expect(updated.sessionNumber).toBe(3);
    expect(updated.location).toBe('Old ruins');

    // Updating just one leaves the other alone.
    const res2 = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ sessionNumber: 4 }),
    });
    const updated2 = (await res2.json()) as Record<string, unknown>;
    expect(updated2.sessionNumber).toBe(4);
    expect(updated2.location).toBe('Old ruins');

    // Explicit null clears; the unrelated field survives.
    const res3 = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ location: null }),
    });
    const updated3 = (await res3.json()) as Record<string, unknown>;
    expect(updated3.location).toBeNull();
    expect(updated3.sessionNumber).toBe(4);
  });

  it('accepts session zero and rejects negative or over-length values', async () => {
    const { accessToken } = await registerUser('log-validation');
    const campaignId = await createCampaign(accessToken);

    const zero = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ sessionDate: '2026-01-15', title: 'T', sessionNumber: 0 }),
    });
    expect(zero.status).toBe(201);
    expect(((await zero.json()) as Record<string, unknown>).sessionNumber).toBe(0);

    const badNumber = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ sessionDate: '2026-01-15', title: 'T', sessionNumber: -1 }),
    });
    expect(badNumber.status).toBe(422);

    const badLocation = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        sessionDate: '2026-01-15',
        title: 'T',
        location: 'x'.repeat(201),
      }),
    });
    expect(badLocation.status).toBe(422);
  });

  it('a non-author member cannot edit another member’s entry', async () => {
    const owner = await registerUser('log-access-owner');
    const author = await registerUser('log-access-author');
    const other = await registerUser('log-access-other');
    const campaignId = await createCampaign(owner.accessToken);
    // owner created the campaign; invite author + other member.
    for (const u of [author, other]) {
      const res = await app.request(`/api/v1/campaigns/${campaignId}/members`, {
        method: 'POST',
        headers: jsonHeaders(owner.accessToken),
        body: JSON.stringify({ email: u.email }),
      });
      expect(res.status).toBe(200);
    }

    const entry = await createEntry(author.accessToken, campaignId, {
      sessionNumber: 1,
      location: 'Somewhere',
    });

    const res = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(other.accessToken),
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    expect(res.status).toBe(403);

    // The campaign owner can still edit it.
    const res2 = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ location: 'Somewhere else' }),
    });
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as Record<string, unknown>).location).toBe('Somewhere else');
  });
});

describe('adventure-log point award boundaries', () => {
  it('accepts an empty subset, zero, and clearing while keeping omitted points notes-only', async () => {
    const { accessToken } = await registerUser('points-clear');
    const campaignId = await createCampaign(accessToken);
    const character = await createCharacter(accessToken, campaignId, 'Uncredited');
    const notes = await createEntry(accessToken, campaignId);
    expect(notes.pointsGained).toBeNull();
    expect(notes.xpAwards).toEqual([]);
    const empty = await createEntry(accessToken, campaignId, {
      pointsGained: 9,
      awardCharacterIds: [],
    });
    expect(empty.xpAwards).toEqual([]);
    expect(await earnedPoints(accessToken, character.id)).toBe(0);
    const zero = await createEntry(accessToken, campaignId, { pointsGained: 0 });
    expect(zero.xpAwards).toEqual([{ characterId: character.id, amount: 0 }]);
    const credited = await createEntry(accessToken, campaignId, { pointsGained: 1000 });
    expect(await earnedPoints(accessToken, character.id)).toBe(1000);
    const cleared = await app.request(`/api/v1/campaigns/${campaignId}/log/${credited.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ pointsGained: null }),
    });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { xpAwards: unknown[] }).xpAwards).toEqual([]);
    expect(await earnedPoints(accessToken, character.id)).toBe(0);
  });

  it('rejects invalid amounts and duplicate recipients atomically', async () => {
    const { accessToken } = await registerUser('points-invalid');
    const campaignId = await createCampaign(accessToken);
    const character = await createCharacter(accessToken, campaignId, 'Validation PC');
    for (const body of [
      { pointsGained: -1 },
      { pointsGained: 1001 },
      { pointsGained: 1.5 },
      { pointsGained: 5, awardCharacterIds: [character.id, character.id] },
      {
        xpAwards: [
          { characterId: character.id, amount: 5 },
          { characterId: character.id, amount: 5 },
        ],
      },
    ]) {
      const response = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
        method: 'POST',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({ sessionDate: '2026-01-15', title: 'Invalid award', ...body }),
      });
      expect(response.status).toBe(422);
      expect(await earnedPoints(accessToken, character.id)).toBe(0);
    }
    const listed = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
      headers: jsonHeaders(accessToken),
    });
    expect(await listed.json()).toEqual([]);
  });

  it('allows a member to credit their own character but rolls back a default award to other players', async () => {
    const owner = await registerUser('points-auth-owner');
    const member = await registerUser('points-auth-member');
    const campaignId = await createCampaign(owner.accessToken);
    const added = await app.request(`/api/v1/campaigns/${campaignId}/members`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ email: member.email }),
    });
    expect(added.status).toBe(200);
    const own = await createCharacter(member.accessToken, campaignId, 'Member PC');
    const other = await createCharacter(owner.accessToken, campaignId, 'Owner PC');
    const entry = await createEntry(member.accessToken, campaignId, {
      pointsGained: 4,
      awardCharacterIds: [own.id],
    });
    expect(await earnedPoints(member.accessToken, own.id)).toBe(4);
    const rejected = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
      method: 'POST',
      headers: jsonHeaders(member.accessToken),
      body: JSON.stringify({ sessionDate: '2026-01-15', title: 'All PCs', pointsGained: 7 }),
    });
    expect(rejected.status).toBe(403);
    expect(await earnedPoints(member.accessToken, own.id)).toBe(4);
    expect(await earnedPoints(owner.accessToken, other.id)).toBe(0);
    const deleted = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(member.accessToken),
    });
    expect(deleted.status).toBe(204);
    expect(await earnedPoints(member.accessToken, own.id)).toBe(0);
  });

  it('retains historical recipients after transfer and rejects additional credit outside the campaign', async () => {
    const { accessToken } = await registerUser('points-transfer');
    const campaignId = await createCampaign(accessToken);
    const destination = await createCampaign(accessToken);
    const character = await createCharacter(accessToken, campaignId, 'Transferred PC');
    const entry = await createEntry(accessToken, campaignId, { pointsGained: 5 });
    const transferred = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ campaignId: destination }),
    });
    expect(transferred.status).toBe(200);
    const newcomer = await createCharacter(accessToken, campaignId, 'New PC');
    const path = `/api/v1/campaigns/${campaignId}/log/${entry.id}`;
    for (const body of [{ body: 'Later notes' }, { pointsGained: 5 }]) {
      const preserved = await app.request(path, {
        method: 'PATCH',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify(body),
      });
      expect(preserved.status).toBe(200);
      expect(((await preserved.json()) as { xpAwards: unknown[] }).xpAwards).toEqual([
        { characterId: character.id, amount: 5 },
      ]);
    }
    const extra = await app.request(path, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ pointsGained: 8 }),
    });
    expect(extra.status).toBe(422);
    expect(await earnedPoints(accessToken, character.id)).toBe(5);
    expect(await earnedPoints(accessToken, newcomer.id)).toBe(0);
    const removed = await app.request(path, {
      method: 'DELETE',
      headers: jsonHeaders(accessToken),
    });
    expect(removed.status).toBe(204);
    expect(await earnedPoints(accessToken, character.id)).toBe(0);
  });

  it('serializes concurrent amount edits and concurrent delete without double credit', async () => {
    const { accessToken } = await registerUser('points-concurrent');
    const campaignId = await createCampaign(accessToken);
    const character = await createCharacter(accessToken, campaignId, 'Concurrent PC');
    const entry = await createEntry(accessToken, campaignId, { pointsGained: 3 });
    const path = `/api/v1/campaigns/${campaignId}/log/${entry.id}`;
    const edits = await Promise.all(
      [7, 11].map((pointsGained) =>
        app.request(path, {
          method: 'PATCH',
          headers: jsonHeaders(accessToken),
          body: JSON.stringify({ pointsGained }),
        }),
      ),
    );
    expect(edits.map((response) => response.status)).toEqual([200, 200]);
    const listed = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
      headers: jsonHeaders(accessToken),
    });
    const current = ((await listed.json()) as Array<{ pointsGained: number }>)[0];
    if (!current) throw new Error('Award entry was not listed');
    expect([7, 11]).toContain(current.pointsGained);
    expect(await earnedPoints(accessToken, character.id)).toBe(current.pointsGained);
    const deleted = await Promise.all(
      [1, 2].map(() =>
        app.request(path, {
          method: 'DELETE',
          headers: jsonHeaders(accessToken),
        }),
      ),
    );
    expect(deleted.map((response) => response.status).sort()).toEqual([204, 404]);
    expect(await earnedPoints(accessToken, character.id)).toBe(0);
  });

  it('advances character revision and records actor-attributed history for point credits', async () => {
    const { accessToken } = await registerUser('points-history');
    const campaignId = await createCampaign(accessToken);
    const character = await createCharacter(accessToken, campaignId, 'Audit PC');
    const before = await app.request(`/api/v1/characters/${character.id}`, {
      headers: jsonHeaders(accessToken),
    });
    const original = (await before.json()) as { revision: number; ownerId: string };
    await createEntry(accessToken, campaignId, { pointsGained: 6 });
    const after = await app.request(`/api/v1/characters/${character.id}`, {
      headers: jsonHeaders(accessToken),
    });
    const updated = (await after.json()) as { revision: number; earnedPoints: number };
    expect(updated.revision).toBeGreaterThan(original.revision);
    expect(updated.earnedPoints).toBe(6);
    const history = await app.request(`/api/v1/characters/${character.id}/history?detail=1`, {
      headers: jsonHeaders(accessToken),
    });
    expect(history.status).toBe(200);
    const events = (await history.json()) as Array<{
      op: string;
      entityClass: string;
      actorUserId: string;
      batchId: string | null;
      oldRow: { earned_points?: number };
      newRow: { earned_points?: number };
      summary: string;
    }>;
    const awardEvent = events.find(
      (event) => event.op === 'update' && event.entityClass === 'character',
    );
    expect(awardEvent?.actorUserId).toBe(original.ownerId);
    expect(awardEvent?.batchId).toBeString();
    expect(awardEvent?.oldRow.earned_points).toBe(0);
    expect(awardEvent?.newRow.earned_points).toBe(6);
    expect(awardEvent?.summary).toContain('points');
  });
});

it('awards the whole current roster once and adjusts amounts and subset edits by their deltas', async () => {
  const { accessToken } = await registerUser('points-roster');
  const campaignId = await createCampaign(accessToken);
  const characters = await Promise.all(
    ['A', 'B', 'C'].map((name) => createCharacter(accessToken, campaignId, name)),
  );
  const first = characters[0];
  if (!first) throw new Error('Missing first character');
  const entry = await createEntry(accessToken, campaignId, { pointsGained: 5 });
  expect(entry.xpAwards).toHaveLength(3);
  const balances = () =>
    Promise.all(characters.map((character) => earnedPoints(accessToken, character.id)));
  expect(await balances()).toEqual([5, 5, 5]);
  const path = `/api/v1/campaigns/${campaignId}/log/${entry.id}`;
  for (const [body, expected] of [
    [{ body: 'Revised notes' }, [5, 5, 5]],
    [{ pointsGained: 8 }, [8, 8, 8]],
    [{ pointsGained: 3, awardCharacterIds: [first.id] }, [3, 0, 0]],
  ] as const) {
    const response = await app.request(path, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(await balances()).toEqual([...expected]);
  }
  const foreignCampaign = await createCampaign(accessToken);
  const foreign = await createCharacter(accessToken, foreignCampaign, 'Foreign');
  const rejected = await app.request(path, {
    method: 'PATCH',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ pointsGained: 6, awardCharacterIds: [foreign.id] }),
  });
  expect(rejected.status).toBe(422);
  expect(await balances()).toEqual([3, 0, 0]);
  expect(await earnedPoints(accessToken, foreign.id)).toBe(0);
  expect(
    (await app.request(path, { method: 'DELETE', headers: jsonHeaders(accessToken) })).status,
  ).toBe(204);
  expect(await balances()).toEqual([0, 0, 0]);
});

it('reverses every historical duplicate award when a legacy log entry is deleted', async () => {
  const { accessToken } = await registerUser('points-legacy');
  const campaignId = await createCampaign(accessToken);
  const character = await createCharacter(accessToken, campaignId, 'Legacy PC');
  const entry = await createEntry(accessToken, campaignId);
  const me = await app.request('/api/v1/auth/me', { headers: jsonHeaders(accessToken) });
  const actor = (await me.json()) as { id: string };
  await withAudit(actor.id, crypto.randomUUID(), async (tx) => {
    await tx.update(characters).set({ earnedPoints: 7 }).where(eq(characters.id, character.id));
    await tx
      .update(adventureLogEntries)
      .set({
        xpAwards: [
          { characterId: character.id, amount: 3 },
          { characterId: character.id, amount: 4 },
        ],
      })
      .where(eq(adventureLogEntries.id, entry.id as string));
  });
  const listed = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
    headers: jsonHeaders(accessToken),
  });
  expect(listed.status).toBe(200);
  expect(((await listed.json()) as Array<{ xpAwards: unknown[] }>)[0]?.xpAwards).toHaveLength(2);
  const deleted = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
    method: 'DELETE',
    headers: jsonHeaders(accessToken),
  });
  expect(deleted.status).toBe(204);
  expect(await earnedPoints(accessToken, character.id)).toBe(0);
});

it('locks transferred historical and new recipients together without cross-campaign deadlock', async () => {
  const { accessToken } = await registerUser('points-cross-campaign');
  const campaignA = await createCampaign(accessToken);
  const campaignB = await createCampaign(accessToken);
  const x = await createCharacter(accessToken, campaignA, 'Cross-campaign X');
  const y = await createCharacter(accessToken, campaignB, 'Cross-campaign Y');
  const entryA = await createEntry(accessToken, campaignA, { pointsGained: 3 });
  const entryB = await createEntry(accessToken, campaignB, { pointsGained: 5 });
  for (const [characterId, campaignId] of [
    [x.id, campaignB],
    [y.id, campaignA],
  ]) {
    const response = await app.request(`/api/v1/characters/${characterId}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ campaignId }),
    });
    expect(response.status).toBe(200);
  }
  const me = await app.request('/api/v1/auth/me', { headers: jsonHeaders(accessToken) });
  const actor = (await me.json()) as { id: string };

  // Hold both edits just after their roster lookup. If that lookup also
  // locked rows, each transaction would now hold the other's next recipient
  // before both tried to lock the full union, deterministically deadlocking.
  let arrivals = 0;
  let release = () => {};
  let rejectBarrier = (_error: Error) => {};
  const barrier = new Promise<void>((resolve, reject) => {
    release = resolve;
    rejectBarrier = reject;
  });
  const barrierTimeout = setTimeout(
    () => rejectBarrier(new Error('Both roster snapshots must complete before recipient locks')),
    5000,
  );
  const withRosterBarrier = (tx: AuditTx): AuditTx => {
    let characterLookups = 0;
    const wrapQuery = (query: object, roster = false): object =>
      new Proxy(query, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (property === 'then' && roster) {
            return (resolve: (rows: unknown) => unknown, reject: (error: unknown) => unknown) =>
              new Promise<unknown>((done, fail) => {
                if (typeof value !== 'function')
                  throw new Error('Expected thenable database query');
                Reflect.apply(value, target, [done, fail]);
              })
                .then(async (rows) => {
                  arrivals += 1;
                  if (arrivals === 2) {
                    clearTimeout(barrierTimeout);
                    release();
                  }
                  await barrier;
                  return rows;
                })
                .then(resolve, reject);
          }
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            const result: unknown = Reflect.apply(value, target, args);
            const isRoster =
              roster || (property === 'from' && args[0] === characters && characterLookups++ === 0);
            return result !== null && typeof result === 'object'
              ? wrapQuery(result, isRoster)
              : result;
          };
        },
      });
    return new Proxy(tx, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (property === 'select' && typeof value === 'function') {
          return (...args: unknown[]) => wrapQuery(Reflect.apply(value, target, args) as object);
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  try {
    await Promise.all(
      [
        { campaignId: campaignA, entry: entryA, recipient: y.id, points: 7 },
        { campaignId: campaignB, entry: entryB, recipient: x.id, points: 9 },
      ].map(({ campaignId, entry, recipient, points }) =>
        withAudit(actor.id, crypto.randomUUID(), async (tx) => {
          const campaign = await lockLogCampaign(tx, campaignId, actor.id);
          const xpAwards = await resolveLogAwards(
            withRosterBarrier(tx),
            campaignId,
            actor.id,
            campaign.ownerId,
            { pointsGained: points, awardCharacterIds: [recipient] },
            entry.xpAwards as XpAward[],
            entry.pointsGained as number,
          );
          await tx
            .update(adventureLogEntries)
            .set({ pointsGained: points, xpAwards })
            .where(eq(adventureLogEntries.id, entry.id as string));
        }),
      ),
    );
  } finally {
    clearTimeout(barrierTimeout);
  }
  expect(arrivals).toBe(2);
  expect(await earnedPoints(accessToken, x.id)).toBe(9);
  expect(await earnedPoints(accessToken, y.id)).toBe(7);
}, 10000);

describe('adventure-log character attachments', () => {
  it('defaults to Campaign, supports any owned character, guards ownership, and keeps private history hidden', async () => {
    const owner = await registerUser('attachment-owner');
    const author = await registerUser('attachment-author');
    const campaignId = await createCampaign(owner.accessToken);
    const otherCampaign = await createCampaign(author.accessToken);
    expect(
      (
        await app.request(`/api/v1/campaigns/${campaignId}/members`, {
          method: 'POST',
          headers: jsonHeaders(owner.accessToken),
          body: JSON.stringify({ email: author.email }),
        })
      ).status,
    ).toBe(200);
    const own = await createCharacter(author.accessToken, otherCampaign, 'Owned elsewhere');
    const foreign = await createCharacter(owner.accessToken, campaignId, 'Foreign');
    const shared = await createEntry(author.accessToken, campaignId);
    expect(shared.characterId).toBeNull();
    expect(shared.visibility).toBe('campaign');
    const entry = await createEntry(author.accessToken, campaignId, {
      characterId: own.id,
      title: 'Hidden secret',
    });
    expect(entry.characterId).toBe(own.id);
    expect(entry.visibility).toBe('private');
    const list = async (token: string) =>
      (await (
        await app.request(`/api/v1/campaigns/${campaignId}/log`, { headers: jsonHeaders(token) })
      ).json()) as Array<{ id: string }>;
    expect((await list(author.accessToken)).some((row) => row.id === entry.id)).toBe(true);
    expect((await list(owner.accessToken)).some((row) => row.id === entry.id)).toBe(false);
    const history = await app.request(`/api/v1/campaigns/${campaignId}/history?detail=1`, {
      headers: jsonHeaders(owner.accessToken),
    });
    expect(history.status).toBe(200);
    expect(JSON.stringify(await history.json())).not.toContain('Hidden secret');
    const entryPath = `/api/v1/campaigns/${campaignId}/log/${entry.id}`;
    for (const characterId of [foreign.id, '11111111-1111-4111-8111-111111111111']) {
      expect(
        (
          await app.request(`/api/v1/campaigns/${campaignId}/log`, {
            method: 'POST',
            headers: jsonHeaders(author.accessToken),
            body: JSON.stringify({ sessionDate: '2026-01-15', title: 'Forged', characterId }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request(entryPath, {
            method: 'PATCH',
            headers: jsonHeaders(author.accessToken),
            body: JSON.stringify({ characterId }),
          })
        ).status,
      ).toBe(403);
    }
    const preserved = await app.request(entryPath, {
      method: 'PATCH',
      headers: jsonHeaders(author.accessToken),
      body: JSON.stringify({ body: 'More secret notes' }),
    });
    expect(preserved.status).toBe(200);
    expect(((await preserved.json()) as { characterId: string }).characterId).toBe(own.id);
    const published = await app.request(entryPath, {
      method: 'PATCH',
      headers: jsonHeaders(author.accessToken),
      body: JSON.stringify({ characterId: null }),
    });
    expect(published.status).toBe(200);
    expect(((await published.json()) as { visibility: string }).visibility).toBe('campaign');
    expect((await list(owner.accessToken)).some((row) => row.id === entry.id)).toBe(true);
    // Publishing does not expose the old private snapshot through detailed history.
    const afterHistory = await app.request(`/api/v1/campaigns/${campaignId}/history?detail=1`, {
      headers: jsonHeaders(owner.accessToken),
    });
    expect(JSON.stringify(await afterHistory.json())).not.toContain('More secret notes');
    expect(
      (
        await app.request(`/api/v1/campaigns/${campaignId}/log`, {
          method: 'POST',
          headers: jsonHeaders(author.accessToken),
          body: JSON.stringify({
            sessionDate: '2026-01-15',
            title: 'Unattached',
            visibility: 'private',
          }),
        })
      ).status,
    ).toBe(422);
  });

  it('preserves legacy and deleted-character private notes without publishing them', async () => {
    const author = await registerUser('attachment-legacy');
    const campaignId = await createCampaign(author.accessToken);
    const own = await createCharacter(author.accessToken, campaignId, 'Deleted later');
    const entry = await createEntry(author.accessToken, campaignId, { characterId: own.id });
    expect(
      (
        await app.request(`/api/v1/characters/${own.id}`, {
          method: 'DELETE',
          headers: jsonHeaders(author.accessToken),
        })
      ).status,
    ).toBe(204);
    const edited = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(author.accessToken),
      body: JSON.stringify({ body: 'Still private' }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ characterId: null, visibility: 'private' });
  });
});
