import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { stringify } from 'yaml';
import {
  armorLayering,
  effectiveDrByLocation,
  layeredArmorDrContributions,
  resolveDr,
} from '../../../shared/domain/armorDr.ts';
import { parseDamageSpec } from '../../../shared/domain/damageParse.ts';
import { applyDamage } from '../../../shared/domain/injuryCalc.ts';
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
      // Front-door copy: every player-facing definition is authored in-world, with
      // no test-fixture vocabulary or placeholder text, and sections are populated.
      const metaCopy = /fixture|synthetic|fictional|placeholder|adjudicat/i;
      const visibleText = (value: unknown): string[] =>
        typeof value === 'string'
          ? [value]
          : Array.isArray(value)
            ? value.flatMap(visibleText)
            : value && typeof value === 'object'
              ? Object.entries(value).flatMap(([key, entry]) =>
                  ['description', 'notes', 'prerequisites', 'text', 'features'].includes(key)
                    ? visibleText(entry)
                    : typeof entry === 'object'
                      ? visibleText(entry)
                      : [],
                )
              : [];
      for (const [section, count] of [
        ['traits', 30],
        ['skills', 48],
        ['spells', 16],
        ['languages', 5],
        ['techniques', 7],
        ['styles', 3],
        ['enchantments', 6],
        ['activeEffects', 3],
        ['items', 26],
        ['modifiers', 4],
        ['races', 3],
      ] as const) {
        const entries = library[section] as { name: string; description: string | null }[];
        expect(entries, section).toHaveLength(count);
        expect(new Set(entries.map((entry) => entry.description)).size, section).toBe(count);
        for (const entry of entries) {
          expect(entry.description?.trim().length ?? 0, entry.name).toBeGreaterThan(60);
          for (const text of visibleText(entry)) expect(text, entry.name).not.toMatch(metaCopy);
        }
      }
      for (const source of library.sources as { name: string; notes: string; edition: string }[])
        expect(`${source.notes} ${source.edition}`, source.name).not.toMatch(metaCopy);
      expect(campaign?.description ?? '').not.toMatch(metaCopy);
      for (const spell of library.spells as { name: string; prerequisites: string | null }[])
        expect(spell.prerequisites, spell.name).toContain('Tideglass attunement');
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
      expect(signing?.prerequisites).toBe('Knows Harbor Sign at any fluency.');
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
        // Race-granted skills are read-only projections without a library definition.
        expect(
          detail.skills
            .filter((skill) => !skill.raceGranted)
            .every((skill) => skill.libraryMechanics?.skillRules != null),
        ).toBe(true);
        expect(detail.skills.every((skill) => skill.effectiveLevel != null)).toBe(true);
        expect(detail.skills.length, detail.name).toBeGreaterThanOrEqual(12);
        expect(detail.skills.length, detail.name).toBeLessThanOrEqual(15);
        expect(detail.traits.length, detail.name).toBeGreaterThanOrEqual(6);
        expect(detail.traits.length, detail.name).toBeLessThanOrEqual(8);
        expect(detail.earnedPoints, detail.name).toBe(6);
        expect(detail.points.total, detail.name).toBeLessThanOrEqual(250 + 6);
        expect(detail.points.unspent, detail.name).toBe(250 + 6 - detail.points.total);
        // Nearly complete sheets: only the six recently awarded points remain unspent.
        expect(detail.points.unspent, detail.name).toBe(6);
        expect(detail.appearance ?? '', detail.name).not.toMatch(metaCopy);
        for (const text of visibleText([...detail.traits, ...detail.skills, ...detail.inventory]))
          expect(text, detail.name).not.toMatch(metaCopy);
        expect(-detail.points.disadvantages, detail.name).toBeLessThanOrEqual(50);
        expect(-detail.points.quirks, detail.name).toBeLessThanOrEqual(5);
        expect(detail.languages.length, detail.name).toBeGreaterThanOrEqual(2);
        expect(detail.languages.length, detail.name).toBeLessThanOrEqual(3);
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
      expect(mira.spells).toHaveLength(8);
      expect(mira.race?.snapshot?.name).toBe('Human · Tide-touched');
      expect(kestrel.race?.snapshot ?? null).toBeNull();
      expect(bram.techniques.map((technique) => technique.name).sort()).toEqual([
        'Breakwater Bind',
        'Hook the Haft',
        'Low Haft Sweep',
      ]);
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
      expect(sable?.spells).toHaveLength(6);
      const iona = details.find((row) => row.name === 'Iona Reedwake');
      expect(iona?.race?.snapshot?.name).toBe('Selkie-blooded');
      expect(iona?.race?.snapshot?.forms.map((form) => form.name)).toEqual(['Seal form']);
      expect(iona?.languages.some((language) => language.name === 'Tidesong')).toBe(true);
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
      expect(orin?.race?.snapshot?.name).toBe('Fogward Shoalborn');
      // The Fogward variant's racial Current Riding is a read-only projected skill.
      expect(orin?.race?.snapshot?.skills.map((skill) => skill.name)).toEqual(['Current Riding']);
      // Exercise the same resolved inventory/effects used by Incoming attack,
      // rather than merely asserting that the authored YAML has armor fields.
      for (const detail of details) {
        for (const facing of ['front', 'back', 'left', 'right'] as const) {
          expect(armorLayering(detail.inventory, facing).invalidLocations, detail.name).toEqual([]);
        }
        expect(armorLayering(detail.inventory).dxPenalty, detail.name).toBe(1);
        expect(
          detail.warnings.some((warning) => warning.code === 'inventory.armor_layers'),
          detail.name,
        ).toBe(false);
        for (const item of detail.inventory.filter(
          (item) => item.weaponData?.modes && item.weaponData.db == null,
        )) {
          expect(item.weaponData?.modes?.length, item.name).toBeGreaterThanOrEqual(2);
          for (const mode of item.weaponData?.modes ?? [])
            expect(parseDamageSpec(mode.damage ?? ''), mode.name).toHaveLength(1);
        }
      }
      const scoutFront = effectiveDrByLocation(kestrel.inventory, kestrel.effects, 'front');
      expect(resolveDr('cut', scoutFront.get('torso'))).toBe(8);
      expect(resolveDr('cr', scoutFront.get('torso'))).toBe(4);
      expect(resolveDr('cut', scoutFront.get('skull'))).toBe(9);
      expect(resolveDr('imp', scoutFront.get('eye'))).toBe(2);
      expect(
        resolveDr(
          'imp',
          effectiveDrByLocation(kestrel.inventory, kestrel.effects, 'left').get('eye'),
        ),
      ).toBe(0);
      expect(applyDamage(10, 'cut', 'torso', scoutFront, null, kestrel.derived.hp)).toMatchObject({
        drAtLocation: 8,
        penetrating: 2,
        injury: 3,
      });
      expect(
        applyDamage(12, 'imp', 'hand_left', scoutFront, '2', kestrel.derived.hp),
      ).toMatchObject({
        effectiveDr: 1,
        preCapInjury: 11,
        crippled: true,
        destroyed: true,
        injury: Math.floor(kestrel.derived.hp / 3) + 1,
      });
      const veteranFront = effectiveDrByLocation(bram.inventory, bram.effects, 'front');
      expect(resolveDr('imp', veteranFront.get('torso'))).toBe(10);
      expect(
        resolveDr('imp', effectiveDrByLocation(bram.inventory, bram.effects, 'back').get('torso')),
      ).toBe(8);
      expect(
        resolveDr('imp', effectiveDrByLocation(bram.inventory, bram.effects, 'left').get('torso')),
      ).toBe(5);
      expect(applyDamage(12, 'imp', 'vitals', veteranFront, '2', bram.derived.hp)).toMatchObject({
        effectiveDr: 5,
        multiplier: 3,
        injury: 21,
      });
      expect(
        applyDamage(12, 'imp', 'torso', veteranFront, '3', bram.derived.hp, true).effectiveDr,
      ).toBe(4);
      expect(applyDamage(12, 'imp', 'torso', veteranFront, '3', bram.derived.hp).effectiveDr).toBe(
        3,
      );
      expect(bram.inventory.find((item) => item.name === 'Storm mantle')?.equipped).toBe(false);
      if (!sable || !orin) throw new Error('Missing seeded protection examples');
      expect(
        resolveDr(
          'burn',
          effectiveDrByLocation(mira.inventory, mira.effects, 'front').get('torso'),
        ),
      ).toBe(5);
      const stitches = layeredArmorDrContributions(sable.inventory, 'torso', 'front');
      expect(stitches.map((line) => line.status).sort()).toEqual(['suppressed', 'winning']);
      expect(
        resolveDr(
          'burn',
          effectiveDrByLocation(sable.inventory, sable.effects, 'front').get('torso'),
        ),
      ).toBe(6);
      expect(
        resolveDr(
          'corr',
          effectiveDrByLocation(orin.inventory, orin.effects, 'front').get('torso'),
        ),
      ).toBe(3);
      expect(
        resolveDr('corr', effectiveDrByLocation(orin.inventory, orin.effects, 'back').get('torso')),
      ).toBe(0);
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
      // Deleted purchases stay deleted; only a read-only racial projection may remain.
      expect(detail.skills.filter((skill) => !skill.raceGranted)).toHaveLength(0);
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
