/**
 * Characterization tests for src/server/routes/characters.ts.
 *
 * These pin CURRENT behavior (including any surprising bits) ahead of a
 * refactor — they are not a spec for what the routes "should" do.
 *
 * Requires a running Postgres test DB configured by ../testConfig.ts.
 */

import { describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import {
  type CharacterDetailInputCharacter,
  type CharacterDetailInputSkill,
  type CharacterDetailInputTrait,
  buildCharacterDetail,
} from '../../shared/domain/characterDetail.ts';
import type { CharacterDetail } from '../../shared/schemas/character.ts';
import type { TraitEffect } from '../../shared/schemas/effects.ts';
import { libraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import { ownedLibraryEffects } from '../../shared/schemas/libraryMechanics.ts';
import type { SyncCursorResponse } from '../../shared/schemas/sync.ts';
import { createApp } from '../app.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { characterSkills, characterTraits } from '../db/schema.ts';
import { captureLibraryMechanics } from '../services/ownedLibraryMechanics.ts';
import { subscribe } from '../services/wsBus.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);

describe('library changes propagate through incremental character cursors', () => {
  it.each(['rest', 'sync-field', 'sync-body'] as const)(
    'detaches an owned kind change through %s and preserves its prior mechanics',
    async (door) => {
      const owner = await registerUser(`owned-kind-${door}`);
      const campaign = await createCampaign(owner.accessToken);
      const character = await createCharacter(owner.accessToken, { campaignId: campaign.id });
      const request = (path: string, body: unknown, method = 'POST') =>
        app.request(`/api/v1${path}`, {
          method,
          headers: jsonHeaders(owner.accessToken),
          body: JSON.stringify(body),
        });
      const sourceResponse = await request(`/campaigns/${campaign.id}/library/traits`, {
        name: 'Source advantage',
        kind: 'advantage',
        effects: [{ target: 'dx', value: 2 }],
      });
      expect(sourceResponse.status).toBe(201);
      const source = (await sourceResponse.json()) as { id: string };
      const created = await request(`/characters/${character.id}/traits`, {
        name: 'Owned',
        kind: 'advantage',
        points: 20,
        level: 2,
        libraryTraitId: source.id,
      });
      expect(created.status).toBe(201);
      const { trait } = (await created.json()) as { trait: { id: string } };
      const [before] = await getDb()
        .select()
        .from(characterTraits)
        .where(eq(characterTraits.id, trait.id));
      if (door === 'rest') {
        expect(
          (
            await request(
              `/characters/${character.id}/traits/${trait.id}`,
              { kind: 'disadvantage' },
              'PATCH',
            )
          ).status,
        ).toBe(200);
      } else {
        const response = await request('/sync/operations', {
          operations: [
            {
              clientOpId: crypto.randomUUID(),
              entityClass: 'character_trait',
              entityId: trait.id,
              parentId: character.id,
              command: 'patch',
              ...(door === 'sync-field' ? { fieldPath: 'kind' } : {}),
              validationVersion: 1,
              attemptedValue: door === 'sync-field' ? 'disadvantage' : { kind: 'disadvantage' },
              prevValue: door === 'sync-field' ? 'advantage' : { kind: 'advantage' },
              baseRevision: Number(before?.revision),
              createdAt: new Date().toISOString(),
            },
          ],
        });
        expect(response.status).toBe(200);
        expect(
          ((await response.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status,
        ).toBe('applied');
      }
      const [after] = await getDb()
        .select()
        .from(characterTraits)
        .where(eq(characterTraits.id, trait.id));
      expect(after).toMatchObject({
        kind: 'disadvantage',
        points: 20,
        level: 2,
        libraryTraitId: null,
        libraryMechanics: { ...before?.libraryMechanics, detached: true },
      });
      expect(
        (
          await request(
            `/campaigns/${campaign.id}/library/traits/${source.id}`,
            {
              effects: [{ target: 'dx', value: -8 }],
            },
            'PATCH',
          )
        ).status,
      ).toBe(200);
      const [refreshed] = await getDb()
        .select()
        .from(characterTraits)
        .where(eq(characterTraits.id, trait.id));
      expect(refreshed).toEqual(after);
    },
  );
  it.each(['traits', 'skills'] as const)('repairs pre-migration %s cursors', async (kind) => {
    const owner = await registerUser(`fanout-migration-${kind}`);
    const campaign = await createCampaign(owner.accessToken);
    const request = (path: string, body: unknown) =>
      app.request(`/api/v1${path}`, {
        method: 'POST',
        headers: jsonHeaders(owner.accessToken),
        body: JSON.stringify(body),
      });
    const source = (await (
      await request(`/campaigns/${campaign.id}/library/${kind}`, {
        name: 'Migration source',
        ...(kind === 'traits' ? { kind: 'advantage' } : { attribute: 'DX', difficulty: 'A' }),
        effects: [{ target: 'dx', value: 3 }],
      })
    ).json()) as { id: string };
    const character = await createCharacter(owner.accessToken, { campaignId: campaign.id });
    expect(
      (
        await request(`/characters/${character.id}/${kind}`, {
          name: 'Migration copy',
          ...(kind === 'traits'
            ? { kind: 'advantage', libraryTraitId: source.id }
            : { attribute: 'DX', difficulty: 'A', librarySkillId: source.id }),
        })
      ).status,
    ).toBe(201);
    const entityClass = kind === 'traits' ? 'character_trait' : 'character_skill';
    const initial = (await (
      await request('/sync/cursor', { cursors: [{ entityClass, sinceRevision: 0 }] })
    ).json()) as SyncCursorResponse;
    const before = initial.changes.find(
      (row) => (row.data as { characterId?: string }).characterId === character.id,
    );
    if (!before) throw new Error('Missing initial copy');
    const migration = await Bun.file(
      new URL('../db/migrations/0035_library_revision_fanout.sql', import.meta.url),
    ).text();
    // Simulate an installation before the one-time repair marker was written.
    await getDb().execute(sql`COMMENT ON FUNCTION invalidate_owned_library_mechanics() IS NULL`);
    // Do not restore the historical triggers replaced by migration 0036.
    const repairStatements = migration
      .split('--> statement-breakpoint')
      .filter(
        (statement) =>
          statement.includes('DO $repair$') || statement.includes('CREATE INDEX IF NOT EXISTS'),
      );
    for (const statement of repairStatements) await getDb().execute(sql.raw(statement));
    const repaired = (await (
      await request('/sync/cursor', {
        cursors: [{ entityClass, sinceRevision: initial.nextCursor[entityClass] }],
      })
    ).json()) as SyncCursorResponse;
    expect(
      repaired.changes.find((row) => row.entityId === before.entityId)?.revision,
    ).toBeGreaterThan(before.revision);
    // Reapplying migration SQL must not advance the repaired row again.
    for (const statement of repairStatements) await getDb().execute(sql.raw(statement));
    const replay = (await (
      await request('/sync/cursor', {
        cursors: [{ entityClass, sinceRevision: repaired.nextCursor[entityClass] }],
      })
    ).json()) as SyncCursorResponse;
    expect(replay.changes.some((row) => row.entityId === before.entityId)).toBe(false);
  });
  it.each(['traits', 'skills'] as const)(
    'updates two %s clients after CRUD and YAML replace, without relying on WS',
    async (kind) => {
      const gm = await registerUser(`fanout-gm-${kind}`);
      const player = await registerUser(`fanout-player-${kind}`);
      const outsider = await registerUser(`fanout-outsider-${kind}`);
      const campaign = await createCampaign(gm.accessToken);
      await addMember(gm.accessToken, String(campaign.id), player.email);
      const request = (token: string, path: string, body?: unknown, method = 'POST') =>
        app.request(`/api/v1${path}`, {
          method,
          headers: jsonHeaders(token),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const template = {
        name: 'Augmented',
        ...(kind === 'traits'
          ? { kind: 'advantage', basePoints: 10 }
          : { attribute: 'DX', difficulty: 'A' }),
      };
      const effects = (value: number): TraitEffect[] => [{ target: 'dx', value, scaling: 'flat' }];
      const sourceResponse = await request(
        gm.accessToken,
        `/campaigns/${campaign.id}/library/${kind}`,
        { ...template, effects: effects(2) },
      );
      expect(sourceResponse.status).toBe(201);
      const source = (await sourceResponse.json()) as { id: string };
      const character = await createCharacter(player.accessToken, { campaignId: campaign.id });
      const attached = await request(player.accessToken, `/characters/${character.id}/${kind}`, {
        name: template.name,
        points: 10,
        ...(kind === 'traits'
          ? { kind: 'advantage', libraryTraitId: source.id }
          : { attribute: 'DX', difficulty: 'A', librarySkillId: source.id }),
      });
      expect(attached.status).toBe(201);
      const entityClass = kind === 'traits' ? 'character_trait' : 'character_skill';
      const pull = async (token: string, sinceRevision: number) => {
        const response = await request(token, '/sync/cursor', {
          cursors: [{ entityClass, sinceRevision }],
        });
        expect(response.status).toBe(200);
        return (await response.json()) as SyncCursorResponse;
      };
      const initial = await pull(player.accessToken, 0);
      const first = initial.changes.find(
        (change) => (change.data as { characterId?: string }).characterId === character.id,
      );
      if (!first) throw new Error('Missing initial child');
      const baseline = initial.nextCursor[entityClass] ?? 0;
      const messages: string[] = [];
      const outsiderMessages: string[] = [];
      const stop = subscribe(decodeUserId(player.accessToken), {
        send: (text) => messages.push(text),
      });
      const stopOutsider = subscribe(decodeUserId(outsider.accessToken), {
        send: (text) => outsiderMessages.push(text),
      });
      try {
        const patch = await request(
          gm.accessToken,
          `/campaigns/${campaign.id}/library/${kind}/${source.id}`,
          { effects: effects(4) },
          'PATCH',
        );
        expect(patch.status).toBe(200);
        expect(messages.map((message) => JSON.parse(message))).toEqual([
          {
            kind: 'sync_invalidate',
            campaignId: campaign.id,
            entityClasses: ['character_trait', 'character_skill'],
            emittedAt: expect.any(String),
          },
        ]);
        expect(outsiderMessages).toEqual([]);
        const assertClient = async (cursor: number, expectedDx: number) => {
          const response = await pull(player.accessToken, cursor);
          const change = response.changes.find((row) => row.entityId === first.entityId);
          if (!change) throw new Error('Library-only change was missed by incremental cursor');
          expect(change.revision).toBeGreaterThan(cursor);
          const data = change.data as Record<string, unknown>;
          const declarations = ownedLibraryEffects(
            source.id,
            String(campaign.id),
            data.libraryMechanics,
          );
          expect(declarations).not.toBeNull();
          const detailResponse = await request(
            player.accessToken,
            `/characters/${character.id}`,
            undefined,
            'GET',
          );
          const api = (await detailResponse.json()) as CharacterDetail;
          const rootResponse = await request(player.accessToken, '/sync/cursor', {
            cursors: [{ entityClass: 'character', sinceRevision: 0 }],
          });
          const root = ((await rootResponse.json()) as SyncCursorResponse).changes.find(
            (row) => row.entityId === character.id,
          )?.data as CharacterDetailInputCharacter;
          const local = buildCharacterDetail({
            character: root,
            traits:
              kind === 'traits'
                ? [{ ...data, libraryEffects: declarations } as CharacterDetailInputTrait]
                : [],
            skills:
              kind === 'skills'
                ? [{ ...data, libraryEffects: declarations } as CharacterDetailInputSkill]
                : [],
            spells: [],
            languages: [],
            techniques: [],
            inventory: [],
            combat: null,
            campaign: null,
          });
          expect(local.derived.effectiveDx).toBe(expectedDx);
          expect(local.derived).toEqual(api.derived);
          return response.nextCursor[entityClass] ?? 0;
        };
        const onlineCursor = await assertClient(baseline, 14);
        // The other device remains offline at baseline, missing both WS nudges.
        const yaml = JSON.stringify({
          version: 6,
          library: {
            traits: kind === 'traits' ? [{ ...template, effects: effects(6) }] : [],
            skills: kind === 'skills' ? [{ ...template, effects: effects(6) }] : [],
            items: [],
          },
        });
        expect(
          (
            await request(gm.accessToken, `/campaigns/${campaign.id}/library/import`, {
              yaml,
              mode: 'replace',
            })
          ).status,
        ).toBe(200);
        const latest = await assertClient(onlineCursor, 16);
        await assertClient(baseline, 16); // offline client reconnects by HTTP only
        expect(messages).toHaveLength(2);
        const denied = await pull(outsider.accessToken, 0);
        expect(denied.changes.some((row) => row.entityId === first.entityId)).toBe(false);
        expect(
          (
            await request(
              gm.accessToken,
              `/campaigns/${campaign.id}/library/${kind}/${source.id}`,
              undefined,
              'DELETE',
            )
          ).status,
        ).toBe(204);
        const deleted = (await pull(player.accessToken, latest)).changes.find(
          (row) => row.entityId === first.entityId,
        );
        expect(
          libraryMechanics.parse((deleted?.data as Record<string, unknown>)?.libraryMechanics)
            .effects,
        ).toEqual(effects(6));
      } finally {
        stop();
        stopOutsider();
      }
    },
  );
});

describe('character-owned library declarations in the cursor', () => {
  it.each(['traits', 'skills'] as const)(
    'syncs versioned %s effects and preserves known-empty copies on deletion',
    async (kind) => {
      const owner = await registerUser(`mechanics-${kind}`);
      const campaign = await createCampaign(owner.accessToken);
      const request = async (path: string, body?: unknown, method = 'POST') =>
        app.request(`/api/v1${path}`, {
          method,
          headers: jsonHeaders(owner.accessToken),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const create = await request(`/campaigns/${campaign.id}/library/${kind}`, {
        name: 'Augmented',
        ...(kind === 'traits'
          ? { kind: 'advantage', basePoints: 10 }
          : { attribute: 'DX', difficulty: 'A' }),
        effects: [{ target: 'dx', value: 2, scaling: 'flat' }],
      });
      expect(create.status).toBe(201);
      const source = (await create.json()) as { id: string };
      const character = await createCharacter(owner.accessToken, { campaignId: campaign.id });
      const attach = await request(`/characters/${character.id}/${kind}`, {
        name: 'Augmented',
        points: 10,
        ...(kind === 'traits'
          ? { kind: 'advantage', libraryTraitId: source.id }
          : { attribute: 'DX', difficulty: 'A', librarySkillId: source.id }),
      });
      expect(attach.status).toBe(201);
      const attached = (await attach.json()) as {
        trait?: { id: string };
        skill?: { id: string };
        character: { derived: { effectiveDx: number } };
      };
      expect(attached.character.derived.effectiveDx).toBe(12);
      const entityId = attached.trait?.id ?? attached.skill?.id;
      const pull = async () => {
        const response = await request('/sync/cursor', {
          cursors: [
            {
              entityClass: kind === 'traits' ? 'character_trait' : 'character_skill',
              sinceRevision: 0,
            },
          ],
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as SyncCursorResponse;
        return (
          body.changes.find((change) => change.entityId === entityId)?.data as Record<
            string,
            unknown
          >
        )?.libraryMechanics;
      };
      const initial = libraryMechanics.parse(await pull());
      expect(initial).toMatchObject({
        sourceId: source.id,
        campaignId: campaign.id,
        effects: [{ target: 'dx', value: 2, scaling: 'flat' }],
      });
      expect(initial.sourceRevision).toBeGreaterThan(0);
      expect(
        (
          await request(
            `/campaigns/${campaign.id}/library/${kind}/${source.id}`,
            { effects: [] },
            'PATCH',
          )
        ).status,
      ).toBe(200);
      const empty = libraryMechanics.parse(await pull());
      expect(empty.effects).toEqual([]);
      expect(empty.sourceRevision).toBeGreaterThan(initial.sourceRevision ?? 0);
      const deleted = await request(
        `/campaigns/${campaign.id}/library/${kind}/${source.id}`,
        undefined,
        'DELETE',
      );
      expect([200, 204]).toContain(deleted.status);
      expect(libraryMechanics.parse(await pull())).toMatchObject({
        sourceId: source.id,
        effects: [],
        sourceRevision: empty.sourceRevision,
        detached: true,
      });
    },
  );

  it('never projects foreign private effects or a minimal-view character child', async () => {
    const owner = await registerUser('mechanics-owner');
    const member = await registerUser('mechanics-member');
    const privateCampaign = await createCampaign(owner.accessToken);
    const sharedCampaign = await createCampaign(owner.accessToken, { shareCharacterSheets: false });
    await addMember(owner.accessToken, String(sharedCampaign.id), member.email);
    const created = await app.request(`/api/v1/campaigns/${privateCampaign.id}/library/traits`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({
        name: 'Private secret',
        kind: 'advantage',
        effects: [{ target: 'dx', value: 7 }],
      }),
    });
    const source = (await created.json()) as { id: string };
    const character = await createCharacter(member.accessToken, { campaignId: sharedCampaign.id });
    // Seed a legacy invalid reference directly; new writes now reject it.
    const attached = await app.request(`/api/v1/characters/${character.id}/traits`, {
      method: 'POST',
      headers: jsonHeaders(member.accessToken),
      body: JSON.stringify({
        name: 'Owned',
        kind: 'advantage',
        points: 5,
      }),
    });
    expect(attached.status).toBe(201);
    const foreignChild = ((await attached.json()) as { trait: { id: string } }).trait.id;
    await getDb()
      .update(characterTraits)
      .set({ libraryTraitId: source.id, libraryMechanics: null })
      .where(eq(characterTraits.id, foreignChild));
    const otherCharacter = await createCharacter(owner.accessToken, {
      campaignId: sharedCampaign.id,
    });
    const other = await app.request(`/api/v1/characters/${otherCharacter.id}/traits`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ name: 'Other private', kind: 'advantage', points: 5 }),
    });
    const privateChild = ((await other.json()) as { trait: { id: string } }).trait.id;
    const res = await app.request('/api/v1/sync/cursor', {
      method: 'POST',
      headers: jsonHeaders(member.accessToken),
      body: JSON.stringify({ cursors: [{ entityClass: 'character_trait', sinceRevision: 0 }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncCursorResponse;
    expect(body.changes.find((change) => change.entityId === privateChild)).toBeUndefined();
    const row = body.changes.find((change) => change.entityId === foreignChild)?.data as Record<
      string,
      unknown
    >;
    expect(
      ownedLibraryEffects(source.id, String(sharedCampaign.id), row.libraryMechanics),
    ).toBeNull();
    expect(JSON.stringify(body)).not.toContain('Private secret');
  });
});

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('owned mechanics survive source lifecycle changes', () => {
  it('detaches owned traits when a live source changes kind and freezes their paid rules', async () => {
    const owner = await registerUser('source-kind-change');
    const campaign = await createCampaign(owner.accessToken);
    const request = (path: string, body: unknown, method = 'POST') =>
      app.request(`/api/v1${path}`, {
        method,
        headers: jsonHeaders(owner.accessToken),
        body: JSON.stringify(body),
      });
    const sourceResponse = await request(`/campaigns/${campaign.id}/library/traits`, {
      name: 'Mutable kind',
      kind: 'advantage',
      effects: [{ target: 'dx', value: 2 }],
    });
    expect(sourceResponse.status).toBe(201);
    const source = (await sourceResponse.json()) as { id: string };
    const character = await createCharacter(owner.accessToken, { campaignId: campaign.id });
    const attached = await request(`/characters/${character.id}/traits`, {
      name: 'Paid advantage',
      kind: 'advantage',
      points: 20,
      level: 2,
      libraryTraitId: source.id,
    });
    expect(attached.status).toBe(201);
    const paidId = ((await attached.json()) as { trait: { id: string } }).trait.id;
    await getDb()
      .insert(characterTraits)
      .values({
        characterId: String(character.id),
        name: 'Legacy unknown',
        kind: 'advantage',
        libraryTraitId: source.id,
        libraryMechanics: null,
      });
    const detail = async () =>
      (await (
        await app.request(`/api/v1/characters/${character.id}`, {
          headers: bearer(owner.accessToken),
        })
      ).json()) as CharacterDetail;
    const before = await detail();
    expect(
      (
        await request(
          `/campaigns/${campaign.id}/library/traits/${source.id}`,
          { kind: 'disadvantage', effects: [{ target: 'dx', value: -5 }] },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    const detached = await detail();
    expect(detached.traits.find((row) => row.id === paidId)).toMatchObject({
      kind: 'advantage',
      points: 20,
      level: 2,
      libraryTraitId: null,
      libraryMechanics: {
        ...before.traits.find((row) => row.id === paidId)?.libraryMechanics,
        detached: true,
      },
    });
    expect(detached.traits.find((row) => row.name === 'Legacy unknown')).toMatchObject({
      libraryTraitId: null,
      libraryMechanics: { effects: null, detached: true },
    });
    expect(detached.derived).toEqual(before.derived);
    expect(
      (
        await request(
          `/campaigns/${campaign.id}/library/traits/${source.id}`,
          { effects: [{ target: 'dx', value: -9 }] },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await detail()).traits).toEqual(detached.traits);
  });
  it('backfills and detaches same-campaign legacy traits whose source kind changed', async () => {
    const owner = await registerUser('legacy-kind-change');
    const campaign = await createCampaign(owner.accessToken);
    const request = (path: string, body?: unknown, method = 'POST') =>
      app.request(`/api/v1${path}`, {
        method,
        headers: jsonHeaders(owner.accessToken),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const source = (await (
      await request(`/campaigns/${campaign.id}/library/traits`, {
        name: 'Legacy rules',
        kind: 'advantage',
        effects: [{ target: 'dx', value: 2 }],
      })
    ).json()) as { id: string };
    const character = await createCharacter(owner.accessToken, { campaignId: campaign.id });
    // Seed historical data directly: the next stacked change rejects new mismatched links.
    const [child] = await getDb()
      .insert(characterTraits)
      .values({
        characterId: String(character.id),
        name: 'Owned rules',
        kind: 'disadvantage',
        points: -5,
        libraryTraitId: source.id,
        libraryMechanics: null,
      })
      .returning();
    if (!child) throw new Error('Missing legacy fixture');
    const migration = await Bun.file(
      new URL('../db/migrations/0036_owned_library_mechanics.sql', import.meta.url),
    ).text();
    const replay = async () => {
      for (const statement of migration.split('--> statement-breakpoint'))
        await getDb().execute(sql.raw(statement));
    };
    await replay();
    const detail = (await (
      await request(`/characters/${character.id}`, undefined, 'GET')
    ).json()) as CharacterDetail;
    expect(detail.libraryEffectsKnown).toBe(true);
    expect(detail.derived.effectiveDx).toBe(12);
    expect(detail.traits[0]).toMatchObject({
      kind: 'disadvantage',
      points: -5,
      libraryTraitId: null,
      libraryMechanics: {
        sourceId: source.id,
        detached: true,
        effects: [{ target: 'dx', value: 2, scaling: 'flat' }],
      },
    });
    const [saved] = await getDb()
      .select()
      .from(characterTraits)
      .where(eq(characterTraits.id, child.id));
    await replay();
    const [unchanged] = await getDb()
      .select()
      .from(characterTraits)
      .where(eq(characterTraits.id, child.id));
    expect(unchanged?.revision).toBe(saved?.revision);
  });
  it.each(['transfer', 'campaign-delete'] as const)(
    'serializes %s with a captured copy that has not been inserted yet',
    async (action) => {
      const owner = await registerUser(`concurrent-${action}`);
      const campaign = await createCampaign(owner.accessToken);
      const destination = await createCampaign(owner.accessToken);
      const character = await createCharacter(owner.accessToken, { campaignId: campaign.id });
      const sourceResponse = await app.request(`/api/v1/campaigns/${campaign.id}/library/traits`, {
        method: 'POST',
        headers: jsonHeaders(owner.accessToken),
        body: JSON.stringify({
          name: 'Concurrent rules',
          kind: 'advantage',
          effects: [{ target: 'dx', value: 2 }],
        }),
      });
      expect(sourceResponse.status).toBe(201);
      const source = (await sourceResponse.json()) as { id: string };
      const captured = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const copying = withAudit(decodeUserId(owner.accessToken), null, async (tx) => {
        const snapshot = await captureLibraryMechanics(
          tx,
          String(character.id),
          'traits',
          source.id,
        );
        captured.resolve();
        await release.promise;
        await tx.insert(characterTraits).values({
          characterId: String(character.id),
          name: 'Concurrent rules',
          kind: 'advantage',
          libraryTraitId: source.id,
          libraryMechanics: snapshot,
        });
      });
      await captured.promise;
      let settled = false;
      const changing = Promise.resolve(
        app.request(
          action === 'transfer'
            ? `/api/v1/characters/${character.id}`
            : `/api/v1/campaigns/${campaign.id}`,
          {
            method: action === 'transfer' ? 'PATCH' : 'DELETE',
            headers: jsonHeaders(owner.accessToken),
            ...(action === 'transfer'
              ? { body: JSON.stringify({ campaignId: destination.id }) }
              : {}),
          },
        ),
      ).then((response) => {
        settled = true;
        return response;
      });
      try {
        if (action === 'campaign-delete') {
          // The deletion must lock the campaign before waiting for our character.
          // This lock also excludes incoming FK assignments from creates/transfers.
          let locked = false;
          for (let attempt = 0; attempt < 100 && !locked; attempt++) {
            try {
              await getDb().execute(
                sql`SELECT id FROM campaigns WHERE id = ${campaign.id} FOR KEY SHARE NOWAIT`,
              );
              await Bun.sleep(10);
            } catch (error) {
              const cause = error as { cause?: { code?: string }; code?: string };
              if ((cause.cause?.code ?? cause.code) !== '55P03') throw error;
              locked = true;
            }
          }
          expect(locked).toBe(true);
        } else await Bun.sleep(50);
        expect(settled).toBe(false);
      } finally {
        release.resolve();
        await copying;
      }
      expect((await changing).status).toBe(action === 'transfer' ? 200 : 204);
      const detail = (await (
        await app.request(`/api/v1/characters/${character.id}`, {
          headers: bearer(owner.accessToken),
        })
      ).json()) as CharacterDetail;
      expect(detail.libraryEffectsKnown).toBe(true);
      expect(detail.derived.effectiveDx).toBe(12);
      expect(detail.traits[0]?.libraryTraitId).toBeNull();
      expect(detail.traits[0]?.libraryMechanics?.detached).toBe(true);
    },
  );
  it.each(['traits', 'skills'] as const)(
    'backfills authorized %s copies while leaving legacy dangling references visibly unresolved',
    async (kind) => {
      const owner = await registerUser(`backfill-${kind}`);
      const campaign = await createCampaign(owner.accessToken);
      const request = (path: string, body: unknown) =>
        app.request(`/api/v1${path}`, {
          method: 'POST',
          headers: jsonHeaders(owner.accessToken),
          body: JSON.stringify(body),
        });
      const source = (await (
        await request(`/campaigns/${campaign.id}/library/${kind}`, {
          name: 'Backfill',
          ...(kind === 'traits' ? { kind: 'advantage' } : { attribute: 'DX', difficulty: 'A' }),
          effects: [{ target: 'dx', value: 2 }],
        })
      ).json()) as { id: string };
      const character = await createCharacter(owner.accessToken, { campaignId: campaign.id });
      const field = kind === 'traits' ? 'libraryTraitId' : 'librarySkillId';
      const childIds: string[] = [];
      for (const id of [source.id, crypto.randomUUID()]) {
        const response = await request(`/characters/${character.id}/${kind}`, {
          name: id === source.id ? 'Present' : 'Dangling',
          ...(id === source.id ? { [field]: id } : {}),
          ...(kind === 'traits' ? { kind: 'advantage' } : { attribute: 'DX', difficulty: 'A' }),
        });
        expect(response.status).toBe(201);
        const value = (await response.json()) as { trait?: { id: string }; skill?: { id: string } };
        const childId = value.trait?.id ?? value.skill?.id;
        if (!childId) throw new Error('Missing fixture');
        childIds.push(childId);
        await getDb()
          .update(kind === 'traits' ? characterTraits : characterSkills)
          .set({ libraryMechanics: null, [field]: id })
          .where(eq((kind === 'traits' ? characterTraits : characterSkills).id, childId));
      }
      const migration = await Bun.file(
        new URL('../db/migrations/0036_owned_library_mechanics.sql', import.meta.url),
      ).text();
      for (const statement of migration.split('--> statement-breakpoint'))
        await getDb().execute(sql.raw(statement));
      const table = kind === 'traits' ? characterTraits : characterSkills;
      const rows = await getDb()
        .select()
        .from(table)
        .where(eq(table.characterId, String(character.id)));
      expect(rows.find((row) => row.id === childIds[0])?.libraryMechanics?.effects).toEqual([
        { target: 'dx', value: 2, scaling: 'flat' },
      ]);
      expect(rows.find((row) => row.id === childIds[1])?.libraryMechanics).toBeNull();
      const detail = (await (
        await app.request(`/api/v1/characters/${character.id}`, {
          headers: bearer(owner.accessToken),
        })
      ).json()) as CharacterDetail;
      expect(detail.libraryEffectsKnown).toBe(false);
    },
  );
  for (const kind of ['traits', 'skills'] as const) {
    it.each([
      'delete',
      'replace-rename',
      'transfer-rest',
      'transfer-sync-field',
      'transfer-sync-body',
      'campaign-delete',
    ])(
      `${kind}: preserves declarations, paid choices and provenance through %s`,
      async (action) => {
        const owner = await registerUser(`preserve-${kind}-${action}`);
        const campaign = await createCampaign(owner.accessToken);
        const request = (path: string, body?: unknown, method = 'POST') =>
          app.request(`/api/v1${path}`, {
            method,
            headers: jsonHeaders(owner.accessToken),
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const effects: TraitEffect[] = [
          {
            target: 'dx',
            value: kind === 'traits' ? 2 : 4,
            scaling: kind === 'traits' ? 'per_level' : 'flat',
          },
        ];
        const template = {
          name: 'Durable',
          effects,
          ...(kind === 'traits'
            ? {
                kind: 'advantage',
                basePoints: 10,
                variants: [{ name: 'Chosen', pointCostDelta: 2 }],
              }
            : { attribute: 'DX', difficulty: 'A' }),
        };
        const sourceResponse = await request(`/campaigns/${campaign.id}/library/${kind}`, template);
        expect(sourceResponse.status).toBe(201);
        const source = (await sourceResponse.json()) as { id: string };
        const character = await createCharacter(owner.accessToken, { campaignId: campaign.id });
        const referenceField = kind === 'traits' ? 'libraryTraitId' : 'librarySkillId';
        const modifiers = [
          {
            name: 'Selected limitation',
            category: 'limitation',
            costType: 'percent',
            costValue: -20,
          },
        ];
        const body = {
          name: template.name,
          points: 20,
          [referenceField]: source.id,
          ...(kind === 'traits'
            ? { kind: 'advantage', level: 2, variantName: 'Chosen', modifiers }
            : { attribute: 'DX', difficulty: 'A', specialization: 'Chosen' }),
        };
        const entityId = crypto.randomUUID();
        const sync = async (
          entityClass: string,
          command: string,
          id: string,
          attemptedValue: unknown,
          fieldPath?: string,
        ) => {
          const response = await request('/sync/operations', {
            operations: [
              {
                clientOpId: crypto.randomUUID(),
                entityClass,
                command,
                entityId: id,
                parentId: character.id,
                attemptedValue,
                ...(fieldPath ? { fieldPath } : {}),
                validationVersion: 1,
                createdAt: new Date().toISOString(),
              },
            ],
          });
          expect(response.status).toBe(200);
          expect(
            ((await response.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status,
          ).toBe('applied');
        };
        // Exercise snapshot capture through sync create, field patch, and whole-body patch.
        const entityClass = kind === 'traits' ? 'character_trait' : 'character_skill';
        await sync(entityClass, 'create', entityId, body);
        await sync(entityClass, 'patch', entityId, source.id, referenceField);
        await sync(entityClass, 'patch', entityId, { [referenceField]: source.id });
        const detail = async () =>
          (await (
            await request(`/characters/${character.id}`, undefined, 'GET')
          ).json()) as CharacterDetail;
        const before = await detail();
        expect(before.derived.effectiveDx).toBe(14);
        const beforeCopy = before[kind][0]?.libraryMechanics;
        if (!beforeCopy) throw new Error('Missing owned declarations');
        expect(beforeCopy?.effects).toEqual(effects);
        if (action === 'delete') {
          expect(
            (
              await request(
                `/campaigns/${campaign.id}/library/${kind}/${source.id}`,
                undefined,
                'DELETE',
              )
            ).status,
          ).toBe(204);
          const recreated = await request(`/campaigns/${campaign.id}/library/${kind}`, {
            ...template,
            effects: [{ target: 'dx', value: 9 }],
          });
          expect(((await recreated.json()) as { id: string }).id).not.toBe(source.id);
          // A new offline copy replayed after source deletion must be rejected,
          // invoking the client create rollback instead of losing its local rules.
          expect((await request(`/characters/${character.id}/${kind}`, body)).status).toBe(403);
          const failedId = crypto.randomUUID();
          const response = await request('/sync/operations', {
            operations: [
              {
                clientOpId: crypto.randomUUID(),
                entityClass,
                entityId: failedId,
                parentId: character.id,
                command: 'create',
                attemptedValue: body,
                createdAt: new Date().toISOString(),
              },
            ],
          });
          expect(
            ((await response.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status,
          ).toBe('unauthorized');
          const table = kind === 'traits' ? characterTraits : characterSkills;
          expect(await getDb().select().from(table).where(eq(table.id, failedId))).toHaveLength(0);
        } else if (action === 'campaign-delete') {
          expect(
            (await request(`/campaigns/${String(campaign.id).toUpperCase()}`, undefined, 'DELETE'))
              .status,
          ).toBe(204);
        } else if (action === 'replace-rename') {
          const yaml = JSON.stringify({
            version: 6,
            library: {
              traits:
                kind === 'traits'
                  ? [{ ...template, name: 'Renamed', effects: [{ target: 'dx', value: 9 }] }]
                  : [],
              skills:
                kind === 'skills'
                  ? [{ ...template, name: 'Renamed', effects: [{ target: 'dx', value: 9 }] }]
                  : [],
              items: [],
            },
          });
          expect(
            (await request(`/campaigns/${campaign.id}/library/import`, { yaml, mode: 'replace' }))
              .status,
          ).toBe(200);
        } else {
          const destination = await createCampaign(owner.accessToken);
          if (action === 'transfer-rest')
            expect(
              (
                await request(
                  `/characters/${character.id}`,
                  { campaignId: destination.id },
                  'PATCH',
                )
              ).status,
            ).toBe(200);
          else
            await sync(
              'character',
              'patch',
              String(character.id),
              action === 'transfer-sync-field' ? destination.id : { campaignId: destination.id },
              action === 'transfer-sync-field' ? 'campaignId' : undefined,
            );
          expect(
            (
              await request(
                `/campaigns/${campaign.id}/library/${kind}/${source.id}`,
                { effects: [{ target: 'dx', value: 9 }] },
                'PATCH',
              )
            ).status,
          ).toBe(200);
        }
        // REST and legacy whole-body/field sync clients can echo a null link
        // during unrelated edits. That must not erase the retained declarations.
        expect(
          (
            await request(
              `/characters/${character.id}/${kind}/${entityId}`,
              { [referenceField]: null, notes: 'Retained REST edit' },
              'PATCH',
            )
          ).status,
        ).toBe(200);
        await sync(entityClass, 'patch', entityId, {
          [referenceField]: null,
          notes: 'Retained sync edit',
        });
        await sync(entityClass, 'patch', entityId, null, referenceField);
        const after = await detail();
        expect(after.libraryEffectsKnown).toBe(true);
        expect(after.derived).toEqual(before.derived);
        expect(after.points).toEqual(before.points);
        const copy = after[kind][0];
        expect(copy?.name).toBe('Durable');
        expect(copy?.points).toBe(20);
        expect((copy as unknown as Record<string, unknown>)[referenceField]).toBeNull();
        expect(copy?.libraryMechanics).toEqual({ ...beforeCopy, detached: true });
        expect(ownedLibraryEffects(null, after.campaignId ?? null, copy?.libraryMechanics)).toEqual(
          effects,
        );
        if (kind === 'traits')
          expect(after.traits[0]).toMatchObject({ level: 2, variantName: 'Chosen', modifiers });
        else expect(after.skills[0]?.specialization).toBe('Chosen');
        const history = (await (
          await request(`/characters/${character.id}/history`, undefined, 'GET')
        ).json()) as { summary: string; actorUserId: string }[];
        const change = history.find((event) =>
          event.summary.includes('saved library rules retained after detaching'),
        );
        expect(change?.actorUserId).toBe(decodeUserId(owner.accessToken));
      },
    );
  }
});

function jsonHeaders(token: string) {
  return { ...bearer(token), 'content-type': 'application/json' };
}

function decodeUserId(accessToken: string): string {
  const payloadSegment = accessToken.split('.')[1];
  if (!payloadSegment) throw new Error('malformed jwt');
  const json = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as {
    sub: string;
  };
  return json.sub;
}

async function registerUser(suffix: string) {
  const email = `chars-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Test ${suffix}` }),
  });
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, email, userId: decodeUserId(body.accessToken) };
}

async function createCampaign(
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Campaign ${Date.now()}-${Math.random()}`, ...overrides }),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function addMember(ownerToken: string, campaignId: string, email: string) {
  const res = await app.request(`/api/v1/campaigns/${campaignId}/members`, {
    method: 'POST',
    headers: jsonHeaders(ownerToken),
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function createCharacter(
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Character ${Date.now()}-${Math.random()}`, ...overrides }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, unknown>;
}

describe('POST /api/v1/characters', () => {
  it('creates a campaignless character with attribute defaults', async () => {
    const { accessToken, userId } = await registerUser('create-nocamp');
    const character = await createCharacter(accessToken, { name: 'Solo Hero' });
    expect(character.view).toBe('full');
    expect(character.ownerId).toBe(userId);
    expect(character.campaignId).toBeNull();
    expect(character.st).toBe(10);
    expect(character.dx).toBe(10);
    expect(character.iq).toBe(10);
    expect(character.ht).toBe(10);
    expect(character.dismissedWarnings).toEqual([]);
    expect(character.traits).toEqual([]);
    expect(character.combat).toBeNull();
  });

  it('creates a character attached to a campaign the user is a member of', async () => {
    const { accessToken } = await registerUser('create-camp');
    const campaign = await createCampaign(accessToken);
    const character = await createCharacter(accessToken, {
      name: 'Party Member',
      campaignId: campaign.id,
      st: 12,
    });
    expect(character.campaignId).toBe(campaign.id);
    expect(character.st).toBe(12);
  });

  it('enforces the default campaign caps while leaving ST open-ended', async () => {
    const { accessToken } = await registerUser('create-caps');
    const campaign = await createCampaign(accessToken);
    expect(campaign.enforceAttributeCaps).toBe(true);

    const tooDexterous = await app.request('/api/v1/characters', {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Too Dexterous', campaignId: campaign.id, dx: 21 }),
    });
    expect(tooDexterous.status).toBe(422);
    expect(((await tooDexterous.json()) as { error: string }).error).toContain('DX');

    const strong = await createCharacter(accessToken, {
      name: 'Very Strong',
      campaignId: campaign.id,
      st: 30,
    });
    expect(strong.st).toBe(30);
  });

  it('allows over-cap attributes when the campaign rule is disabled', async () => {
    const { accessToken } = await registerUser('create-caps-off');
    const campaign = await createCampaign(accessToken, { enforceAttributeCaps: false });
    const character = await createCharacter(accessToken, {
      name: 'Super',
      campaignId: campaign.id,
      dx: 25,
      iq: 22,
      willMod: 4,
    });
    expect(character.derived).toMatchObject({ will: 26 });
  });

  it('403s creating a character attached to a campaign the user does not belong to', async () => {
    const owner = await registerUser('create-owner');
    const outsider = await registerUser('create-outsider');
    const campaign = await createCampaign(owner.accessToken);
    const res = await app.request('/api/v1/characters', {
      method: 'POST',
      headers: jsonHeaders(outsider.accessToken),
      body: JSON.stringify({ name: 'Trespasser', campaignId: campaign.id }),
    });
    expect(res.status).toBe(403);
  });

  it('401s when unauthenticated', async () => {
    const res = await app.request('/api/v1/characters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nobody' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/v1/characters/{id} -- campaign attribute caps', () => {
  it('rejects Will above 20 and validates the combined value when IQ changes', async () => {
    const { accessToken } = await registerUser('patch-caps');
    const campaign = await createCampaign(accessToken);
    const character = await createCharacter(accessToken, {
      campaignId: campaign.id,
      iq: 18,
      willMod: 2,
    });

    const willRes = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ willMod: 3 }),
    });
    expect(willRes.status).toBe(422);

    const iqRes = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ iq: 19 }),
    });
    expect(iqRes.status).toBe(422);
  });

  it('rejects moving an existing over-cap character into an enforcing campaign', async () => {
    const { accessToken } = await registerUser('patch-campaign-caps');
    const campaign = await createCampaign(accessToken);
    const character = await createCharacter(accessToken, { dx: 25 });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ campaignId: campaign.id }),
    });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/characters (list)', () => {
  it('only returns characters the user owns or shares a campaign with', async () => {
    const { accessToken, email } = await registerUser('list-scope');
    const outsider = await registerUser('list-scope-outsider');
    const mine = await createCharacter(accessToken, { name: `Mine ${email}` });
    await createCharacter(outsider.accessToken, { name: 'Not mine' });

    const res = await app.request('/api/v1/characters', { headers: bearer(accessToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    const ids = body.map((c) => c.id);
    expect(ids).toContain(mine.id);
    expect(body.every((c) => c.id !== undefined)).toBe(true);
  });

  it('excludes minimal-view characters for a fellow member when shareCharacterSheets=false (browsable only from the campaign page)', async () => {
    const gm = await registerUser('list-mask-gm');
    const owner = await registerUser('list-mask-owner');
    const viewer = await registerUser('list-mask-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: false });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Masked One',
      campaignId: campaign.id,
      st: 15,
      dx: 14,
      iq: 13,
      ht: 12,
    });

    // Owner sees their own real stats in the list.
    const ownerListRes = await app.request('/api/v1/characters', {
      headers: bearer(owner.accessToken),
    });
    const ownerList = (await ownerListRes.json()) as Record<string, unknown>[];
    const ownerRow = ownerList.find((c) => c.id === character.id);
    expect(ownerRow?.st).toBe(15);
    expect(ownerRow?.dx).toBe(14);

    // GM sees real stats too — owner/GM short-circuit the share gate.
    const gmListRes = await app.request('/api/v1/characters', { headers: bearer(gm.accessToken) });
    const gmList = (await gmListRes.json()) as Record<string, unknown>[];
    const gmRow = gmList.find((c) => c.id === character.id);
    expect(gmRow?.st).toBe(15);

    // Fellow member does NOT see the masked character on /characters at
    // all — it's browsable from the campaign detail page instead (see
    // docs/specs/campaign-content-sharing.md "Discovery: where minimal
    // characters appear").
    const viewerListRes = await app.request('/api/v1/characters', {
      headers: bearer(viewer.accessToken),
    });
    const viewerList = (await viewerListRes.json()) as Record<string, unknown>[];
    const viewerRow = viewerList.find((c) => c.id === character.id);
    expect(viewerRow).toBeUndefined();
  });

  it('does not mask when shareCharacterSheets=true', async () => {
    const gm = await registerUser('list-share-gm');
    const owner = await registerUser('list-share-owner');
    const viewer = await registerUser('list-share-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: true });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Open Book',
      campaignId: campaign.id,
      st: 16,
    });

    const viewerListRes = await app.request('/api/v1/characters', {
      headers: bearer(viewer.accessToken),
    });
    const viewerList = (await viewerListRes.json()) as Record<string, unknown>[];
    const viewerRow = viewerList.find((c) => c.id === character.id);
    expect(viewerRow?.st).toBe(16);
  });

  it('401s when unauthenticated', async () => {
    const res = await app.request('/api/v1/characters');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/characters/{id} — access matrix', () => {
  async function buildFixture(shareCharacterSheets: boolean) {
    const gm = await registerUser(`detail-gm-${shareCharacterSheets}`);
    const owner = await registerUser(`detail-owner-${shareCharacterSheets}`);
    const viewer = await registerUser(`detail-viewer-${shareCharacterSheets}`);
    const outsider = await registerUser(`detail-outsider-${shareCharacterSheets}`);
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Fixture Character',
      campaignId: campaign.id,
      st: 17,
      birthdate: '3/7/0402',
    });
    return { gm, owner, viewer, outsider, campaign, character };
  }

  it('owner always gets the full view', async () => {
    const { owner, character } = await buildFixture(false);
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(owner.accessToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.view).toBe('full');
    expect(body.st).toBe(17);
  });

  it('campaign GM always gets the full view, even when shareCharacterSheets=false', async () => {
    const { gm, character } = await buildFixture(false);
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(gm.accessToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.view).toBe('full');
    expect(body.st).toBe(17);
  });

  it('fellow member gets the full view when shareCharacterSheets=true', async () => {
    const { viewer, character } = await buildFixture(true);
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(viewer.accessToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.view).toBe('full');
    expect(body.st).toBe(17);
  });

  it('fellow member gets the minimal view when shareCharacterSheets=false — stats/traits are OMITTED, not masked', async () => {
    const { viewer, character } = await buildFixture(false);
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(viewer.accessToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.view).toBe('minimal');
    expect(body.name).toBe('Fixture Character');
    // Birthdate is a public identity bit, same class as height/age.
    expect(body.birthdate).toBe('3/7/0402');
    // Unlike the list endpoint (which masks st/dx/iq/ht to 10), the detail
    // minimal view omits these keys entirely.
    expect(body).not.toHaveProperty('st');
    expect(body).not.toHaveProperty('dx');
    expect(body).not.toHaveProperty('traits');
    expect(body).not.toHaveProperty('warnings');
    expect(body).not.toHaveProperty('dismissedWarnings');
  });

  it('non-member is forbidden (403)', async () => {
    const { outsider, character } = await buildFixture(true);
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(outsider.accessToken),
    });
    expect(res.status).toBe(403);
  });

  it('404s for a nonexistent character id', async () => {
    const { owner } = await buildFixture(true);
    const res = await app.request('/api/v1/characters/00000000-0000-0000-0000-000000000000', {
      headers: bearer(owner.accessToken),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/sync/cursor — minimal-view masking includes tempEffects', () => {
  it("a fellow member with only minimal access gets an identity-only cursor row, never the owner's real stats, mods, tempEffects, or dismissed warnings", async () => {
    const gm = await registerUser('cursor-mask-gm');
    const owner = await registerUser('cursor-mask-owner');
    const viewer = await registerUser('cursor-mask-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: false });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Secretly Buffed',
      campaignId: campaign.id,
      st: 17,
      birthdate: '3/7/0402',
    });
    await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({
        tempEffects: [{ id: 'e1', name: 'Might', mods: { st: 4 } }],
        dismissedWarnings: ['over-buffed'],
      }),
    });

    const res = await app.request('/api/v1/sync/cursor', {
      method: 'POST',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({ cursors: [{ entityClass: 'character', sinceRevision: 0 }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      changes: Array<{ entityId: string; data?: Record<string, unknown> }>;
    };
    const change = body.changes.find((c) => c.entityId === character.id);
    expect(change).toBeDefined();
    // Identity columns ship verbatim.
    expect(change?.data?.id).toBe(character.id);
    expect(change?.data?.name).toBe('Secretly Buffed');
    expect(change?.data?.campaignId).toBe(campaign.id);
    expect(change?.data?.birthdate).toBe('3/7/0402');
    // Private columns are masked to safe defaults — never the real values.
    expect(change?.data?.st).toBe(10);
    expect(change?.data?.dx).toBe(10);
    expect(change?.data?.iq).toBe(10);
    expect(change?.data?.ht).toBe(10);
    expect(change?.data?.tempEffects).toEqual([]);
    expect(change?.data?.dismissedWarnings).toEqual([]);
    expect(change?.data?.activeConditionGroups).toEqual([]);
  });

  it('the owner still sees their own real tempEffects through the same cursor pull', async () => {
    const gm = await registerUser('cursor-owner-gm');
    const owner = await registerUser('cursor-owner-owner');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: false });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Openly Buffed',
      campaignId: campaign.id,
    });
    const tempEffects = [{ id: 'e1', name: 'Might', mods: { st: 4 } }];
    await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ tempEffects }),
    });

    const res = await app.request('/api/v1/sync/cursor', {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ cursors: [{ entityClass: 'character', sinceRevision: 0 }] }),
    });
    const body = (await res.json()) as {
      changes: Array<{ entityId: string; data?: Record<string, unknown> }>;
    };
    const change = body.changes.find((c) => c.entityId === character.id);
    expect(change?.data?.tempEffects).toEqual(tempEffects);
  });
});

describe('PATCH /api/v1/characters/{id}', () => {
  it('owner can update attributes and identity fields', async () => {
    const { accessToken } = await registerUser('patch-owner');
    const character = await createCharacter(accessToken, { name: 'Before', st: 10 });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'After', st: 13 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe('After');
    expect(body.st).toBe(13);
  });

  it('create and PATCH round-trip a free-form birthdate', async () => {
    const { accessToken } = await registerUser('patch-birthdate');
    const character = await createCharacter(accessToken, {
      name: 'Born Somewhere',
      birthdate: 'March 3, 1987',
    });
    expect(character.birthdate).toBe('March 3, 1987');

    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ birthdate: '3/3/87' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.birthdate).toBe('3/3/87');

    const getRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(accessToken),
    });
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect(getBody.birthdate).toBe('3/3/87');
  });

  it('PATCH clears birthdate with null and rejects over-length values', async () => {
    const { accessToken } = await registerUser('patch-birthdate-clear');
    const character = await createCharacter(accessToken, {
      name: 'Bday',
      birthdate: 'On a Tuesday',
    });

    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ birthdate: null }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).birthdate).toBeNull();

    const bad = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ birthdate: 'x'.repeat(41) }),
    });
    expect(bad.status).toBe(422);
  });

  it('a non-owner campaign member cannot patch (403 "owner only")', async () => {
    const gm = await registerUser('patch-gm');
    const owner = await registerUser('patch-owner2');
    const viewer = await registerUser('patch-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: true });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Guarded',
      campaignId: campaign.id,
    });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    expect(res.status).toBe(403);
  });

  it('403s when re-pointing campaignId to a campaign the owner does not belong to', async () => {
    const { accessToken } = await registerUser('patch-recamp');
    const other = await registerUser('patch-recamp-other');
    const otherCampaign = await createCampaign(other.accessToken);
    const character = await createCharacter(accessToken, { name: 'Reassign Me' });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ campaignId: otherCampaign.id }),
    });
    expect(res.status).toBe(403);
  });

  it('round-trips tempEffects: PATCH persists the array and folds it into derived stats', async () => {
    const { accessToken } = await registerUser('patch-temp-effects');
    const character = await createCharacter(accessToken, { name: 'Buffed', st: 10 });
    const tempEffects = [
      { id: 'e1', name: 'Might', mods: { st: 2, ht: 1 } },
      { id: 'manual', name: 'Manual adjustment', mods: { hp: 3 } },
    ];
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ tempEffects }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.tempEffects).toEqual(tempEffects);
    // Might raises effective ST to 12 without changing HP; the explicit
    // HP +3 effect raises HP from its base-ST value of 10 to 13 (M37).
    const derived = body.derived as Record<string, unknown>;
    expect(derived.effectiveSt).toBe(12);
    expect(derived.hp).toBe(13);

    // Re-fetch to confirm it persisted, not just echoed on the PATCH response.
    const getRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(accessToken),
    });
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect(getBody.tempEffects).toEqual(tempEffects);
  });

  it('422s on an invalid tempEffects array (per-axis sum out of [-50, 50])', async () => {
    const { accessToken } = await registerUser('patch-temp-effects-invalid');
    const character = await createCharacter(accessToken, { name: 'Overbuffed' });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        tempEffects: [
          { id: 'e1', name: 'A', mods: { st: 30 } },
          { id: 'e2', name: 'B', mods: { st: 30 } },
        ],
      }),
    });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/characters/{id}', () => {
  it('owner can delete; subsequent GET 404s', async () => {
    const { accessToken } = await registerUser('delete-owner');
    const character = await createCharacter(accessToken, { name: 'Doomed' });
    const delRes = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'DELETE',
      headers: bearer(accessToken),
    });
    expect(delRes.status).toBe(204);
    const getRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(accessToken),
    });
    expect(getRes.status).toBe(404);
  });

  it('non-owner campaign member cannot delete (403)', async () => {
    const gm = await registerUser('delete-gm');
    const owner = await registerUser('delete-owner2');
    const viewer = await registerUser('delete-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: true });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Protected',
      campaignId: campaign.id,
    });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'DELETE',
      headers: bearer(viewer.accessToken),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/characters/{id}/warnings/dismiss', () => {
  it('dismissing a code adds it to dismissedWarnings and reflects in a follow-up GET', async () => {
    const { accessToken } = await registerUser('warn-dismiss');
    const character = await createCharacter(accessToken, { name: 'Warned' });
    const dismissRes = await app.request(`/api/v1/characters/${character.id}/warnings/dismiss`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ code: 'test-warning-code', dismissed: true }),
    });
    expect(dismissRes.status).toBe(200);
    const dismissBody = (await dismissRes.json()) as Record<string, unknown>;
    expect(dismissBody.dismissedWarnings).toContain('test-warning-code');

    const getRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(accessToken),
    });
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect(getBody.dismissedWarnings).toContain('test-warning-code');
  });

  it('un-dismissing (dismissed: false) removes the code again', async () => {
    const { accessToken } = await registerUser('warn-undismiss');
    const character = await createCharacter(accessToken, { name: 'Warned2' });
    await app.request(`/api/v1/characters/${character.id}/warnings/dismiss`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ code: 'toggle-code', dismissed: true }),
    });
    const restoreRes = await app.request(`/api/v1/characters/${character.id}/warnings/dismiss`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ code: 'toggle-code', dismissed: false }),
    });
    expect(restoreRes.status).toBe(200);
    const body = (await restoreRes.json()) as Record<string, unknown>;
    expect(body.dismissedWarnings).not.toContain('toggle-code');
  });

  it('non-owner cannot dismiss warnings (403)', async () => {
    const gm = await registerUser('warn-gm');
    const owner = await registerUser('warn-owner');
    const viewer = await registerUser('warn-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: true });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Not Yours',
      campaignId: campaign.id,
    });
    const res = await app.request(`/api/v1/characters/${character.id}/warnings/dismiss`, {
      method: 'POST',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({ code: 'nope', dismissed: true }),
    });
    expect(res.status).toBe(403);
  });
});
