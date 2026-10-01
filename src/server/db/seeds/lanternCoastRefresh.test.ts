import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { stringify } from 'yaml';
import { z } from 'zod';
import { adventureLogOut } from '../../../shared/schemas/adventureLog.ts';
import {
  librarySkillCreate,
  librarySkillOut,
  libraryTraitCreate,
  libraryTraitOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { parseLibraryYaml } from '../../../shared/yaml/library.ts';
import { createApp } from '../../app.ts';
import { signAccessToken } from '../../auth/jwt.ts';
import { loadCharacterDetail } from '../../services/characterSummary.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../../testConfig.ts';
import { withAudit } from '../auditContext.ts';
import { closeDb, getDb, runInDbTransaction } from '../client.ts';
import { characterTraits, demoSeedUpdates, entityHistory } from '../schema.ts';
import { ensureDemoUser } from './accounts.ts';
import { LANTERN_CAMPAIGN_NAME } from './lanternCoast.ts';
import { lanternCharacters } from './lanternCoastData.ts';
import { refreshLanternCoast } from './lanternCoastRefresh.ts';
import legacy from './lanternCoastV1.json';

configureIntegrationTestEnvironment();
afterAll(closeDb);
const app = createApp(integrationTestConfig);
const identified = z.object({ id: z.string().uuid() });
const catalogSchema = z.object({
  traits: libraryTraitOut.array(),
  skills: librarySkillOut.array(),
});

async function request(actorId: string, path: string, method = 'GET', body?: unknown) {
  const { token } = await signAccessToken(actorId);
  const response = await app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function isolated(fn: (ownerId: string) => Promise<void>) {
  const rollback = new Error('rollback refresh fixture');
  try {
    await runInDbTransaction(async () => {
      const owner = await ensureDemoUser(`refresh-${randomUUID()}@example.invalid`, 'Test GM');
      await fn(owner.id);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

/** Minimal old demo created through public routes, with genuine v1 defaults. */
async function oldDemo(ownerId: string) {
  const text = await readFile(
    new URL('../../../../bootstrap/lantern_coast.yaml', import.meta.url),
    'utf8',
  );
  const document = parseLibraryYaml(text);
  document.library.traits = libraryTraitCreate.array().parse(legacy.traits);
  document.library.skills = librarySkillCreate.array().parse(legacy.skills);
  const campaign = identified.parse(
    await request(ownerId, '/campaigns', 'POST', {
      ...document.campaign,
      name: LANTERN_CAMPAIGN_NAME,
      shareCharacterSheets: true,
      allowGmCharacterEditing: false,
    }),
  );
  const path = `/campaigns/${campaign.id}`;
  await request(ownerId, `${path}/library/import`, 'POST', {
    yaml: stringify(document),
    mode: 'merge',
  });
  const catalog = catalogSchema.parse(await request(ownerId, `${path}/library`));
  const fixture = lanternCharacters[0];
  if (!fixture) throw new Error('Missing Kestrel fixture');
  const player = await ensureDemoUser(fixture.email, fixture.displayName);
  await request(ownerId, `${path}/members`, 'POST', { email: player.email });
  const character = identified.parse(
    await request(player.id, '/characters', 'POST', {
      ...fixture.character,
      campaignId: campaign.id,
    }),
  );
  const characterPath = `/characters/${character.id}`;
  const trait = catalog.traits.find((entry) => entry.name === 'Breakwater Poise');
  const skill = catalog.skills.find((entry) => entry.name === 'Shingle Ghosting');
  const barter = catalog.skills.find((entry) => entry.name === 'Quayside Barter');
  const foraging = catalog.skills.find((entry) => entry.name === 'Coastal Foraging');
  if (!trait || !skill || !barter || !foraging) throw new Error('Missing v1 catalog entries');
  const { trait: ownedTrait } = z.object({ trait: identified }).parse(
    await request(player.id, `${characterPath}/traits`, 'POST', {
      kind: trait.kind,
      name: trait.name,
      points: trait.basePoints,
      libraryTraitId: trait.id,
    }),
  );
  // A user's paid purchase remains their historical cost after a catalog update.
  await withAudit(player.id, undefined, async (tx) => {
    await tx
      .update(characterTraits)
      .set({ points: 17 })
      .where(eq(characterTraits.id, ownedTrait.id));
  });
  const { skill: ownedSkill } = z.object({ skill: identified }).parse(
    await request(player.id, `${characterPath}/skills`, 'POST', {
      name: skill.name,
      attribute: skill.attribute,
      difficulty: skill.difficulty,
      librarySkillId: skill.id,
      points: 5,
    }),
  );
  const { skill: ownedBarter } = z.object({ skill: identified }).parse(
    await request(player.id, `${characterPath}/skills`, 'POST', {
      name: barter.name,
      attribute: barter.attribute,
      difficulty: barter.difficulty,
      librarySkillId: barter.id,
      points: 0,
      notes: 'My negotiated harbor rates; keep these.',
    }),
  );
  await request(ownerId, `${path}/library/skills/${barter.id}`, 'PATCH', {
    description: 'GM house rule: rates follow the local guild ledger.',
  });
  const { skill: ownedForaging } = z.object({ skill: identified }).parse(
    await request(player.id, `${characterPath}/skills`, 'POST', {
      name: foraging.name,
      attribute: foraging.attribute,
      difficulty: foraging.difficulty,
      librarySkillId: foraging.id,
      specialization: 'Cliff Gardens',
      points: 4,
    }),
  );
  await request(player.id, `${characterPath}/combat`, 'PATCH', { currentHp: 1 });
  const log = identified.parse(
    await request(player.id, `${path}/log`, 'POST', {
      characterId: character.id,
      visibility: 'private',
      sessionDate: '2026-09-18',
      sessionNumber: 4,
      title: `${fixture.character.name}: a promise unspoken`,
      body: `A private note by **${fixture.displayName}**.\n\nI have not told the others what the beacon showed me.`,
    }),
  );
  return {
    campaignId: campaign.id,
    path,
    playerId: player.id,
    characterId: character.id,
    ownedTraitId: ownedTrait.id,
    ownedSkillId: ownedSkill.id,
    ownedBarterId: ownedBarter.id,
    ownedForagingId: ownedForaging.id,
    barterId: barter.id,
    logId: log.id,
    text,
  };
}

describe('Lantern Coast explicit content refresh', () => {
  it('enriches untouched defaults while preserving edits, costs, play state and private access', async () => {
    await isolated(async (ownerId) => {
      const old = await oldDemo(ownerId);
      const restricted = parseLibraryYaml(old.text).library.traits.find(
        (entry) => entry.name === "Beacon Courier's Seal",
      );
      if (!restricted) throw new Error('Missing new courier privilege');
      await request(ownerId, `${old.path}/library/traits`, 'POST', {
        ...restricted,
        restricted: true,
      });
      const oldCatalog = catalogSchema.parse(await request(ownerId, `${old.path}/library`));
      const deletedDefinition = oldCatalog.traits.find((entry) => entry.name === 'Longwatch Lungs');
      if (!deletedDefinition) throw new Error('Missing original definition');
      await request(ownerId, `${old.path}/library/traits/${deletedDefinition.id}`, 'DELETE');
      await refreshLanternCoast(ownerId);
      const catalog = catalogSchema.parse(await request(ownerId, `${old.path}/library`));
      expect(catalog.traits).toHaveLength(29);
      expect(catalog.traits.some((entry) => entry.name === 'Longwatch Lungs')).toBe(false);
      expect(catalog.skills).toHaveLength(48);
      expect(catalog.skills.find((entry) => entry.id === old.barterId)?.description).toBe(
        'GM house rule: rates follow the local guild ledger.',
      );
      const detail = await loadCharacterDetail(old.characterId);
      expect(detail.combat?.currentHp).toBe(1);
      expect(detail.earnedPoints).toBe(0);
      expect(detail.traits.find((entry) => entry.id === old.ownedTraitId)?.points).toBe(17);
      expect(detail.traits.some((entry) => entry.name === "Beacon Courier's Seal")).toBe(false);
      expect(detail.traits.find((entry) => entry.id === old.ownedTraitId)?.notes).toBe(
        catalog.traits.find((entry) => entry.name === 'Breakwater Poise')?.description,
      );
      const skill = detail.skills.find((entry) => entry.id === old.ownedSkillId);
      expect(skill?.points).toBe(5);
      expect(skill?.notes).toContain(
        catalog.skills.find((entry) => entry.name === 'Shingle Ghosting')?.description ??
          'missing description',
      );
      expect(detail.skills.find((entry) => entry.id === old.ownedBarterId)?.notes).toBe(
        'My negotiated harbor rates; keep these.',
      );
      expect(
        detail.skills.find((entry) => entry.id === old.ownedBarterId)?.libraryMechanics?.skillRules
          ?.procedures?.actions.length,
      ).toBeGreaterThan(0);
      expect(detail.skills.some((entry) => entry.name === 'Marsh Tracking')).toBe(true);
      expect(
        detail.skills.some(
          (entry) => entry.name === 'Coastal Foraging' && entry.specialization === 'Tide Flats',
        ),
      ).toBe(false);
      const refreshedForaging = detail.skills.find((entry) => entry.id === old.ownedForagingId);
      expect(refreshedForaging?.points).toBe(4);
      expect(refreshedForaging?.notes).toContain('during an hour of careful searching');
      const logs = adventureLogOut.array().parse(await request(old.playerId, `${old.path}/log`));
      expect(logs.filter((entry) => entry.visibility === 'private')).toHaveLength(3);
      expect(logs.find((entry) => entry.id === old.logId)?.body).toBe(
        lanternCharacters[0]?.privateLogs[2]?.body,
      );
      expect(
        logs
          .filter((entry) => entry.visibility === 'campaign')
          .map((entry) => entry.sessionNumber)
          .sort(),
      ).toEqual([1, 2]);
      expect(logs.every((entry) => entry.xpAwards.length === 0)).toBe(true);
      const gmLogs = adventureLogOut.array().parse(await request(ownerId, `${old.path}/log`));
      expect(gmLogs.every((entry) => entry.visibility === 'campaign')).toBe(true);
      expect(
        await getDb()
          .select()
          .from(demoSeedUpdates)
          .where(eq(demoSeedUpdates.campaignId, old.campaignId)),
      ).toHaveLength(1);

      const newPurchase = detail.skills.find((entry) => entry.name === 'Marsh Tracking');
      const newLog = logs.find(
        (entry) => entry.sessionNumber === 0 && entry.visibility === 'private',
      );
      if (!newPurchase || !newLog) throw new Error('Missing new content');
      await request(
        old.playerId,
        `/characters/${old.characterId}/skills/${newPurchase.id}`,
        'DELETE',
      );
      await request(old.playerId, `${old.path}/log/${newLog.id}`, 'DELETE');
      const before = await getDb()
        .select()
        .from(entityHistory)
        .where(eq(entityHistory.campaignId, old.campaignId));
      await refreshLanternCoast(ownerId);
      expect(
        await getDb()
          .select()
          .from(entityHistory)
          .where(eq(entityHistory.campaignId, old.campaignId)),
      ).toHaveLength(before.length);
      expect(
        (await loadCharacterDetail(old.characterId)).skills.some(
          (entry) => entry.name === 'Marsh Tracking',
        ),
      ).toBe(false);
      expect(
        adventureLogOut
          .array()
          .parse(await request(old.playerId, `${old.path}/log`))
          .some((entry) => entry.id === newLog.id),
      ).toBe(false);
    });
  }, 30000);

  it('preserves an edited private journal and a renamed original character', async () => {
    await isolated(async (ownerId) => {
      const old = await oldDemo(ownerId);
      await request(old.playerId, `/characters/${old.characterId}`, 'PATCH', {
        name: 'Kestrel, changed by player',
      });
      await request(old.playerId, `${old.path}/log/${old.logId}`, 'PATCH', {
        body: 'My private theory: Fen followed the moon, not the compass.',
      });
      await refreshLanternCoast(ownerId);
      const detail = await loadCharacterDetail(old.characterId);
      expect(detail.name).toBe('Kestrel, changed by player');
      expect(detail.skills.some((entry) => entry.name === 'Marsh Tracking')).toBe(true);
      const logs = adventureLogOut.array().parse(await request(old.playerId, `${old.path}/log`));
      expect(logs.find((entry) => entry.id === old.logId)?.body).toBe(
        'My private theory: Fen followed the moon, not the compass.',
      );
      expect(logs.filter((entry) => entry.visibility === 'private')).toHaveLength(4);
    });
  }, 30000);

  it('rolls back a late invalid recipe so a repaired refresh can succeed', async () => {
    await isolated(async (ownerId) => {
      const old = await oldDemo(ownerId);
      const invalid = parseLibraryYaml(old.text);
      invalid.library.skills = invalid.library.skills.filter(
        (entry) => entry.name !== 'Smuggler Routes',
      );
      const before = await getDb()
        .select()
        .from(entityHistory)
        .where(eq(entityHistory.campaignId, old.campaignId));
      await expect(refreshLanternCoast(ownerId, stringify(invalid))).rejects.toThrow();
      expect(
        catalogSchema.parse(await request(ownerId, `${old.path}/library`)).skills,
      ).toHaveLength(23);
      expect(
        await getDb()
          .select()
          .from(entityHistory)
          .where(eq(entityHistory.campaignId, old.campaignId)),
      ).toHaveLength(before.length);
      expect(
        await getDb()
          .select()
          .from(demoSeedUpdates)
          .where(eq(demoSeedUpdates.campaignId, old.campaignId)),
      ).toHaveLength(0);
      await refreshLanternCoast(ownerId);
    });
  }, 30000);
});
