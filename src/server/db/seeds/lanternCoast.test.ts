import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { stringify } from 'yaml';
import { adventureLogOut } from '../../../shared/schemas/adventureLog.ts';
import { encounterOut } from '../../../shared/schemas/encounter.ts';
import { parseLibraryYaml } from '../../../shared/yaml/library.ts';
import { createApp } from '../../app.ts';
import { signAccessToken } from '../../auth/jwt.ts';
import { loadCharacterDetail } from '../../services/characterSummary.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../../testConfig.ts';
import { withAudit } from '../auditContext.ts';
import { closeDb, getDb, runInDbTransaction } from '../client.ts';
import {
  campaigns,
  characterSkills,
  characters,
  combatStates,
  encounters,
  entityHistory,
} from '../schema.ts';
import { ensureDemoUser } from './accounts.ts';
import { LANTERN_CAMPAIGN_NAME, seedLanternCoast } from './lanternCoast.ts';

configureIntegrationTestEnvironment();
afterAll(closeDb);
const app = createApp(integrationTestConfig);

/** Roll back test campaigns and history, including when an assertion fails. */
async function isolated(fn: (ownerId: string) => Promise<void>) {
  const rollback = new Error('rollback fixture');
  try {
    await runInDbTransaction(async () => {
      const owner = await ensureDemoUser(`lantern-test-${randomUUID()}@example.invalid`, 'Test GM');
      await fn(owner.id);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
async function get(userId: string, path: string) {
  const { token } = await signAccessToken(userId);
  const response = await app.request(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return response.json();
}
async function rows(campaignId: string) {
  return getDb().select().from(characters).where(eq(characters.campaignId, campaignId));
}
async function history(campaignId: string) {
  return getDb().select().from(entityHistory).where(eq(entityHistory.campaignId, campaignId));
}

describe('Lantern Coast standard seed', () => {
  it('creates usable linked mechanics, deep inventory, magic and private multi-player content', async () => {
    await isolated(async (ownerId) => {
      const { campaignId, created } = await seedLanternCoast(ownerId);
      expect(created).toBe(true);
      const roster = await rows(campaignId);
      expect(roster).toHaveLength(3);
      expect(new Set(roster.map((row) => row.ownerId)).size).toBe(3);
      const details = [];
      for (const row of roster) details.push(await loadCharacterDetail(row.id));
      const kestrel = details.find((row) => row.name === 'Kestrel Vale');
      const mira = details.find((row) => row.name === 'Mira Ashfall');
      const bram = details.find((row) => row.name === 'Bram Stonebridge');
      if (!kestrel || !mira || !bram) throw new Error('Missing seeded character');
      for (const detail of details) {
        expect(detail.libraryEffectsKnown).toBe(true);
        expect(detail.revision).toBeGreaterThan(0);
        expect(detail.traits.every((trait) => trait.libraryMechanics?.effects != null)).toBe(true);
        expect(detail.skills.every((skill) => skill.libraryMechanics?.skillRules != null)).toBe(
          true,
        );
        expect(detail.skills.every((skill) => skill.effectiveLevel != null)).toBe(true);
        expect(detail.languages).toHaveLength(2);
      }
      expect(kestrel.skills.filter((skill) => skill.name === 'Survival')).toHaveLength(2);
      expect(kestrel.skills.find((skill) => skill.name === 'Merchant')?.points).toBe(0);
      const stealth = kestrel.skills.find((skill) => skill.name === 'Stealth');
      expect(stealth?.libraryMechanics?.skillRules?.procedures?.actions[0]?.id).toBe('slip_past');
      expect(stealth?.benefitStatus?.[0]?.unlocked).toBe(true);
      const compass = kestrel.inventory.find((item) => item.name === 'Brass compass');
      const pouch = kestrel.inventory.find((item) => item.id === compass?.parentId);
      const pack = kestrel.inventory.find((item) => item.id === pouch?.parentId);
      expect(pouch?.name).toBe('Oilskin pouch');
      expect(pack?.name).toBe('Trail pack');
      expect(
        kestrel.inventory.find((item) => item.name === "Wayfarer's sword")?.enchantments[0]
          ?.mechanics?.effects[0]?.target,
      ).toBe('weapon_damage');
      expect(kestrel.techniques[0]?.level).toBeGreaterThan(10);
      expect(mira.spells).toHaveLength(6);
      expect(mira.spells.find((spell) => spell.name === 'Light')?.effectiveCost).toBe(0);
      expect(
        mira.inventory.find((item) => item.name === 'Focus crystal')?.powerstoneData?.currentEnergy,
      ).toBe(5);
      expect(
        mira.inventory.find((item) => item.name === 'Spent focus')?.powerstoneData?.currentEnergy,
      ).toBe(0);
      expect(mira.combat?.currentFp).toBeLessThan(mira.derived.fp / 3);
      expect(bram.combat?.currentHp).toBeLessThan(bram.derived.hp / 3);
      expect(kestrel.activeEffects[0]?.state).toBe('active');
      expect(mira.activeEffects[0]?.state).toBe('inactive');
      expect(bram.activeEffects[0]?.state).toBe('expired');
      expect(bram.activeEffects[0]?.remainingRounds).toBe(0);
      const events = await history(campaignId);
      expect(events.length).toBeGreaterThan(100);
      expect(events.every((event) => event.actorUserId != null)).toBe(true);
      expect(new Set(events.map((event) => event.actorUserId)).size).toBe(4);
      const logs = adventureLogOut
        .array()
        .parse(await get(kestrel.ownerId, `/campaigns/${campaignId}/log`));
      expect(logs).toHaveLength(4);
      expect(logs.filter((log) => log.visibility === 'private').map((log) => log.authorId)).toEqual(
        [kestrel.ownerId],
      );
      const [encounter] = await getDb()
        .select()
        .from(encounters)
        .where(eq(encounters.campaignId, campaignId));
      if (!encounter) throw new Error('Missing seeded encounter');
      const path = `/campaigns/${campaignId}/encounters/${encounter.id}`;
      const gmView = encounterOut.parse(await get(ownerId, path));
      const playerView = encounterOut.parse(await get(kestrel.ownerId, path));
      expect(gmView.combatants).toHaveLength(5);
      expect(playerView.combatants).toHaveLength(4);
      expect(playerView.combatants.some((entry) => entry.name === 'Hidden lantern keeper')).toBe(
        false,
      );
      expect(gmView.effects[0]?.maintenanceCost).toBe(1);
    });
  }, 30000);

  it('preserves edited and deleted play data, adds no history on rerun, and scopes identity to the owner', async () => {
    await isolated(async (ownerId) => {
      const otherOwner = await ensureDemoUser(
        `lantern-other-${randomUUID()}@example.invalid`,
        'Other GM',
      );
      await withAudit(otherOwner.id, undefined, async (tx) => {
        await tx.insert(campaigns).values({ name: LANTERN_CAMPAIGN_NAME, ownerId: otherOwner.id });
      });
      const first = await seedLanternCoast(ownerId);
      const [character] = await rows(first.campaignId);
      if (!character) throw new Error('Missing seeded character');
      await withAudit(character.ownerId, undefined, async (tx) => {
        await tx
          .update(characters)
          .set({ name: 'Player renamed this character' })
          .where(eq(characters.id, character.id));
        await tx
          .update(combatStates)
          .set({ currentHp: 1 })
          .where(eq(combatStates.characterId, character.id));
        await tx.delete(characterSkills).where(eq(characterSkills.characterId, character.id));
        await tx
          .update(campaigns)
          .set({ description: 'Edited campaign notes' })
          .where(eq(campaigns.id, first.campaignId));
      });
      const before = await history(first.campaignId);
      expect(await seedLanternCoast(ownerId)).toEqual({
        campaignId: first.campaignId,
        created: false,
      });
      expect(await history(first.campaignId)).toHaveLength(before.length);
      const detail = await loadCharacterDetail(character.id);
      expect(detail.name).toBe('Player renamed this character');
      expect(detail.combat?.currentHp).toBe(1);
      expect(detail.skills).toHaveLength(0);
      expect(await rows(first.campaignId)).toHaveLength(3);
      const [campaign] = await getDb()
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, first.campaignId));
      expect(campaign?.ownerId).toBe(ownerId);
      expect(campaign?.description).toBe('Edited campaign notes');
    });
  }, 30000);

  it('rolls back a late invalid fixture completely so a repaired rerun can succeed', async () => {
    await isolated(async (ownerId) => {
      const text = await readFile(
        new URL('../../../../bootstrap/lantern_coast.yaml', import.meta.url),
        'utf8',
      );
      const document = parseLibraryYaml(text);
      // Valid YAML, but the missing weapon is discovered after characters and
      // child rows have already been inserted: this exercises the atomic boundary.
      document.library.items = document.library.items.filter((item) => item.name !== 'Coastal bow');
      await expect(seedLanternCoast(ownerId, stringify(document))).rejects.toThrow(
        'Missing Lantern fixture items: Coastal bow',
      );
      const db = getDb();
      expect(
        await db
          .select()
          .from(campaigns)
          .where(and(eq(campaigns.ownerId, ownerId), eq(campaigns.name, LANTERN_CAMPAIGN_NAME))),
      ).toHaveLength(0);
      expect(
        await db.select().from(entityHistory).where(eq(entityHistory.actorUserId, ownerId)),
      ).toHaveLength(0);
      const repaired = await seedLanternCoast(ownerId);
      expect(repaired.created).toBe(true);
      expect(await rows(repaired.campaignId)).toHaveLength(3);
    });
  }, 30000);
});
