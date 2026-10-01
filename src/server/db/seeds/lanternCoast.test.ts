import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { stringify } from 'yaml';
import { benefitUnlocked } from '../../../shared/domain/skillProcedures.ts';
import { adventureLogOut } from '../../../shared/schemas/adventureLog.ts';
import { librarySkillOut, libraryTraitOut } from '../../../shared/schemas/campaignLibrary.ts';
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
import { lanternCharacters, lanternSharedLogs } from './lanternCoastData.ts';
import { refreshLanternCoast } from './lanternCoastRefresh.ts';

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
      const [campaign] = await getDb().select().from(campaigns).where(eq(campaigns.id, campaignId));
      expect(campaign?.experimentalActiveEffects).toBe(false);
      const roster = await rows(campaignId);
      expect(roster).toHaveLength(6);
      expect(new Set(roster.map((row) => row.ownerId)).size).toBe(6);
      const library = await get(ownerId, `/campaigns/${campaignId}/library`);
      const librarySkills = librarySkillOut.array().parse(library.skills);
      const libraryTraits = libraryTraitOut.array().parse(library.traits);
      expect(librarySkills).toHaveLength(48);
      expect(libraryTraits).toHaveLength(30);
      expect(new Set(librarySkills.map((skill) => skill.description)).size).toBe(48);
      expect(new Set(libraryTraits.map((trait) => trait.description)).size).toBe(30);
      for (const skill of librarySkills) {
        expect(skill.description?.trim(), skill.name).toBeTruthy();
        expect(skill.description, skill.name).not.toContain('adjudicate task scope at the table');
        expect(skill.procedures?.modifiers.length, skill.name).toBeGreaterThan(0);
        expect(skill.procedures?.actions.length, skill.name).toBeGreaterThan(0);
        for (const action of skill.procedures?.actions ?? []) {
          expect(action.label.trim(), skill.name).toBeTruthy();
          expect(action.roll?.basis, skill.name).toBe('skill');
          expect(action.outcomes.length, skill.name).toBeGreaterThan(0);
          for (const outcome of action.outcomes)
            expect(outcome.text.trim(), skill.name).toBeTruthy();
        }
      }
      for (const trait of libraryTraits) expect(trait.description?.trim(), trait.name).toBeTruthy();
      const ropework = librarySkills.find((skill) => skill.name === 'Ropework');
      expect(ropework?.procedures?.actions[0]).toMatchObject({
        id: 'ropework_task',
        time: { amount: { kind: 'constant', value: 5 }, unit: 'minutes' },
        outcomes: [
          { kind: 'note', on: 'success' },
          { kind: 'note', on: 'failure' },
        ],
      });
      expect(ropework?.procedures?.modifiers[0]).toMatchObject({
        when: [{ input: { domain: 'equipment', key: 'ropework_obstacle' }, value: true }],
        value: { kind: 'fixed', value: -2 },
        appliesTo: 'task_roll',
      });
      const ropeworkBenefit = ropework?.procedures?.benefits?.[0];
      if (!ropeworkBenefit) throw new Error('Missing Ropework training benefit');
      expect(ropeworkBenefit).toMatchObject({
        when: { minimumRelativeLevel: 2 },
        effects: [{ target: 'skill', skillName: 'Net Mending', value: 1 }],
      });
      expect(benefitUnlocked(ropeworkBenefit, 11, 10, 2, null)).toBe(false);
      expect(benefitUnlocked(ropeworkBenefit, 12, 10, 4, null)).toBe(true);
      for (const [name, prerequisite] of [
        ['Beacon Lenscraft', 'Salvage Fitting'],
        ['Tideglass Inscription', 'Beacon Resonance'],
        ['Patient Triage', 'Saltwound Care'],
      ] as const) {
        expect(librarySkills.find((skill) => skill.name === name)?.prerequisiteRules).toEqual({
          kind: 'skill',
          name: prerequisite,
          specialization: { kind: 'any' },
          minimumPoints: 1,
        });
      }
      const signing = librarySkills.find((skill) => skill.name === 'Silent Signing');
      expect(signing?.prerequisiteRules).toBeNull();
      expect(signing?.prerequisites).toContain('manually confirms Harbor Sign comprehension');
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
        expect(detail.skills.length, detail.name).toBeGreaterThanOrEqual(12);
        expect(detail.skills.length, detail.name).toBeLessThanOrEqual(15);
        expect(detail.traits.length, detail.name).toBeGreaterThanOrEqual(6);
        expect(detail.traits.length, detail.name).toBeLessThanOrEqual(8);
        expect(detail.earnedPoints, detail.name).toBe(6);
        expect(detail.points.total, detail.name).toBeLessThanOrEqual(250 + 6);
        expect(detail.points.unspent, detail.name).toBe(250 + 6 - detail.points.total);
        expect(-detail.points.disadvantages, detail.name).toBeLessThanOrEqual(50);
        expect(-detail.points.quirks, detail.name).toBeLessThanOrEqual(5);
        expect(detail.languages).toHaveLength(2);
      }
      expect(kestrel.skills.filter((skill) => skill.name === 'Coastal Foraging')).toHaveLength(2);
      expect(kestrel.skills.find((skill) => skill.name === 'Quayside Barter')?.points).toBe(0);
      const stealth = kestrel.skills.find((skill) => skill.name === 'Shingle Ghosting');
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
      expect(
        mira.skills.find((skill) => skill.name === 'Beacon Lenscraft')?.prerequisiteStatus,
      ).toBe('met');
      expect(
        mira.skills.find((skill) => skill.name === 'Tideglass Inscription')?.prerequisiteStatus,
      ).toBe('met');
      expect(details.map((row) => row.name).sort()).toEqual([
        'Bram Stonebridge',
        'Iona Reedwake',
        'Kestrel Vale',
        'Mira Ashfall',
        'Orin Bellstrand',
        'Sable Fenwick',
      ]);
      for (const detail of details) {
        expect(
          detail.traits.every((trait) => trait.pricingResolution?.outputs.points != null),
        ).toBe(true);
        expect(
          detail.inventory
            .filter((item) => item.libraryItemId)
            .every((item) => item.pricingResolution?.outputs.weightLbs != null),
        ).toBe(true);
      }
      const bow = kestrel.inventory.find((item) => item.name === 'Reedglass bow');
      expect(bow?.baseWeaponData?.modes?.[0]?.ranged?.range?.kind).toBe('st_multiplier');
      expect(bow?.enchantments[0]?.mechanics?.effects[0]?.target).toBe('weapon_accuracy');
      const sable = details.find((row) => row.name === 'Sable Fenwick');
      expect(sable?.spells).toHaveLength(4);
      expect(
        sable?.skills.find((skill) => skill.name === 'Patient Triage')?.prerequisiteStatus,
      ).toBe('met');
      const orin = details.find((row) => row.name === 'Orin Bellstrand');
      expect(orin?.inventory.find((item) => item.name === 'Salvage apron')?.armor?.frontOnly).toBe(
        true,
      );
      expect(
        orin?.skills.find((skill) => skill.name === 'Signal Weaving')?.effectiveLevel,
      ).toBeGreaterThan(orin?.iq ?? 0);
      expect(mira.spells.find((spell) => spell.name === 'Glimmer Shoal')?.effectiveCost).toBe(1);
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
      expect(new Set(events.map((event) => event.actorUserId)).size).toBe(7);
      const allLogIds = new Set<string>();
      const privateBodies = new Set<string>();
      const gmLogs = adventureLogOut
        .array()
        .parse(await get(ownerId, `/campaigns/${campaignId}/log`));
      expect(gmLogs).toHaveLength(5);
      expect(gmLogs.every((log) => log.visibility === 'campaign')).toBe(true);
      for (const expected of lanternSharedLogs) {
        const saved = gmLogs.find((log) => log.title === expected.title);
        expect(saved, expected.title).toBeDefined();
        expect(saved).toMatchObject({
          body: expected.body,
          sessionDate: expected.sessionDate,
          sessionNumber: expected.sessionNumber,
          location: expected.location,
          visibility: 'campaign',
        });
      }
      for (const detail of details) {
        const fixture = lanternCharacters.find((entry) => entry.character.name === detail.name);
        if (!fixture) throw new Error(`Missing authored logs for ${detail.name}`);
        const logs = adventureLogOut
          .array()
          .parse(await get(detail.ownerId, `/campaigns/${campaignId}/log`));
        expect(logs, detail.name).toHaveLength(8);
        for (const log of logs) allLogIds.add(log.id);
        const privateLogs = logs.filter((log) => log.visibility === 'private');
        expect(privateLogs, detail.name).toHaveLength(3);
        expect(privateLogs.map((log) => log.sessionNumber).sort()).toEqual([0, 3, 4]);
        expect(privateLogs.every((log) => log.authorId === detail.ownerId)).toBe(true);
        expect(privateLogs.every((log) => log.characterId === detail.id)).toBe(true);
        for (const expected of fixture.privateLogs) {
          const saved = privateLogs.find((log) => log.title === expected.title);
          expect(saved, expected.title).toBeDefined();
          expect(saved).toMatchObject({
            body: expected.body,
            sessionDate: expected.sessionDate,
            sessionNumber: expected.sessionNumber,
            location: expected.location,
          });
          expect(saved?.body.trim(), expected.title).toBeTruthy();
          expect(saved?.body, expected.title).not.toContain(
            'I have not told the others what the beacon showed me.',
          );
          if (saved) privateBodies.add(saved.body);
        }
      }
      expect(allLogIds.size).toBe(23);
      expect(privateBodies.size).toBe(18);
      const [encounter] = await getDb()
        .select()
        .from(encounters)
        .where(eq(encounters.campaignId, campaignId));
      if (!encounter) throw new Error('Missing seeded encounter');
      const path = `/campaigns/${campaignId}/encounters/${encounter.id}`;
      const gmView = encounterOut.parse(await get(ownerId, path));
      const playerView = encounterOut.parse(await get(kestrel.ownerId, path));
      expect(gmView.combatants).toHaveLength(8);
      expect(playerView.combatants).toHaveLength(7);
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
      expect(await refreshLanternCoast(ownerId)).toMatchObject({
        campaignId: first.campaignId,
        created: false,
        refreshed: false,
      });
      expect(await history(first.campaignId)).toHaveLength(before.length);
      const detail = await loadCharacterDetail(character.id);
      expect(detail.name).toBe('Player renamed this character');
      expect(detail.combat?.currentHp).toBe(1);
      expect(detail.skills).toHaveLength(0);
      expect(await rows(first.campaignId)).toHaveLength(6);
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
      document.library.items = document.library.items.filter(
        (item) => item.name !== 'Reedglass bow',
      );
      await expect(seedLanternCoast(ownerId, stringify(document))).rejects.toThrow(
        'Missing Lantern fixture items: Reedglass bow',
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
      expect(await rows(repaired.campaignId)).toHaveLength(6);
    });
  }, 30000);
});
