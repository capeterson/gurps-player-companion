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
import { librarySourceOut } from '../../../shared/schemas/libraryMetadata.ts';
import { parseLibraryYaml } from '../../../shared/yaml/library.ts';
import { portableLibraryEntry } from '../../../shared/yaml/sourceReferences.ts';
import { createApp } from '../../app.ts';
import { signAccessToken } from '../../auth/jwt.ts';
import { loadCharacterDetail } from '../../services/characterSummary.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../../testConfig.ts';
import { withAudit } from '../auditContext.ts';
import { closeDb, getDb, runInDbTransaction } from '../client.ts';
import {
  campaignLibraryItems,
  campaigns,
  characterTraits,
  characters,
  combatStates,
  demoSeedUpdates,
  entityHistory,
} from '../schema.ts';
import { ensureDemoUser } from './accounts.ts';
import { LANTERN_CAMPAIGN_NAME, seedLanternCoast } from './lanternCoast.ts';
import { lanternCharacters } from './lanternCoastData.ts';
import equipmentV2 from './lanternCoastEquipmentV2.json';
import { refreshLanternCoast } from './lanternCoastRefresh.ts';
import legacy from './lanternCoastV1.json';
import contentV3 from './lanternCoastV3Text.json';

configureIntegrationTestEnvironment();
afterAll(closeDb);
const app = createApp(integrationTestConfig);
const identified = z.object({ id: z.string().uuid() });
const catalogSchema = z.object({
  traits: libraryTraitOut.array(),
  skills: librarySkillOut.array(),
  sources: librarySourceOut.array(),
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
  document.library.traits = z.array(portableLibraryEntry(libraryTraitCreate)).parse(legacy.traits);
  document.library.skills = z.array(portableLibraryEntry(librarySkillCreate)).parse(legacy.skills);
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
  it('upgrades V2 equipment once without restoring deleted content or overwriting customized armor', async () => {
    await isolated(async (ownerId) => {
      const { campaignId } = await seedLanternCoast(ownerId);
      const roster = await getDb()
        .select()
        .from(characters)
        .where(eq(characters.campaignId, campaignId));
      const kestrel = roster.find((row) => row.name === 'Kestrel Vale');
      if (!kestrel) throw new Error('Missing Kestrel');
      const before = await loadCharacterDetail(kestrel.id);
      const sword = before.inventory.find((item) => item.name === "Wayfarer's sword");
      const bow = before.inventory.find((item) => item.name === 'Reedglass bow');
      const oldSword = equipmentV2.items.find((item) => item.name === "Wayfarer's sword");
      if (!sword || !bow || !oldSword?.weaponData) throw new Error('Missing weapon baseline');
      await request(kestrel.ownerId, `/characters/${kestrel.id}/inventory/${sword.id}`, 'PATCH', {
        weaponData: oldSword.weaponData,
        enchantments: sword.enchantments.map((ref) => ({ ...ref, spellLevel: null })),
      });
      await request(kestrel.ownerId, `/characters/${kestrel.id}/inventory/${bow.id}`, 'PATCH', {
        enchantments: bow.enchantments.map((ref) => ({
          ...ref,
          spellLevel: 14,
          notes: 'GM recorded weaker Power',
        })),
      });
      const coat = before.inventory.find((item) => item.name === 'Tidewire coat');
      const pack = before.inventory.find((item) => item.name === 'Trail pack');
      if (!pack?.libraryItemId) throw new Error('Missing old pack');
      await request(kestrel.ownerId, `/characters/${kestrel.id}/inventory/${pack.id}`, 'DELETE');
      await request(
        ownerId,
        `/campaigns/${campaignId}/library/items/${pack.libraryItemId}`,
        'DELETE',
      );
      const boots = before.inventory.find((item) => item.name === 'Cliffgrip boots');
      const oldCoat = equipmentV2.items.find((item) => item.name === 'Tidewire coat');
      if (!coat?.libraryItemId || !boots || !oldCoat?.armor)
        throw new Error('Missing armor baseline');
      await request(
        ownerId,
        `/campaigns/${campaignId}/library/items/${coat.libraryItemId}`,
        'PATCH',
        { armor: oldCoat.armor, description: oldCoat.description },
      );
      await request(kestrel.ownerId, `/characters/${kestrel.id}/inventory/${coat.id}`, 'PATCH', {
        armor: { ...oldCoat.armor, dr: 7 },
        notes: 'Player fitted custom rings',
      });
      const removed = before.inventory.filter((item) =>
        ['Shoalwatch brigandine', 'Tidewire coif', 'Beacon visor', 'Dock leather gloves'].includes(
          item.name,
        ),
      );
      for (const item of [...removed, boots])
        await request(kestrel.ownerId, `/characters/${kestrel.id}/inventory/${item.id}`, 'DELETE');
      const brigandine = removed.find((item) => item.name === 'Shoalwatch brigandine');
      if (!brigandine?.libraryItemId) throw new Error('Missing new armor definition');
      await request(
        ownerId,
        `/campaigns/${campaignId}/library/items/${brigandine.libraryItemId}`,
        'DELETE',
      );
      const greaves = before.inventory.find((item) => item.name === 'Reedweave greaves');
      const oldGreaves = equipmentV2.items.find((item) => item.name === 'Reedweave greaves');
      if (!greaves || !oldGreaves?.armor) throw new Error('Missing old greaves');
      await request(kestrel.ownerId, `/characters/${kestrel.id}/inventory/${greaves.id}`, 'PATCH', {
        armor: oldGreaves.armor,
      });
      const addedSkill = before.skills.find((skill) => skill.name === 'Ropework');
      if (!addedSkill) throw new Error('Missing V2 skill');
      await request(kestrel.ownerId, `/characters/${kestrel.id}/skills/${addedSkill.id}`, 'DELETE');
      // A recognized V2 marker must run only the new equipment revision.
      await withAudit(ownerId, undefined, async (tx) => {
        await tx.delete(demoSeedUpdates).where(eq(demoSeedUpdates.campaignId, campaignId));
        await tx.insert(demoSeedUpdates).values({ campaignId, seed: 'lantern-coast', version: 2 });
        await tx
          .update(combatStates)
          .set({ currentHp: 1 })
          .where(eq(combatStates.characterId, kestrel.id));
      });
      const first = await refreshLanternCoast(ownerId);
      expect(first.refreshed).toBe(true);
      const after = await loadCharacterDetail(kestrel.id);
      expect(
        after.inventory.find((item) => item.id === sword.id)?.baseWeaponData?.modes,
      ).toHaveLength(3);
      expect(
        after.inventory.find((item) => item.id === sword.id)?.enchantments[0]?.spellLevel,
      ).toBe(15);
      expect(after.inventory.find((item) => item.id === bow.id)?.enchantments[0]).toMatchObject({
        spellLevel: 14,
        notes: 'GM recorded weaker Power',
      });
      expect(after.inventory.find((item) => item.id === coat.id)?.baseArmor?.dr).toBe(7);
      expect(after.inventory.find((item) => item.id === coat.id)?.notes).toBe(
        'Player fitted custom rings',
      );
      expect(after.inventory.some((item) => item.name === 'Cliffgrip boots')).toBe(false);
      expect(after.inventory.some((item) => item.name === 'Trail pack')).toBe(false);
      expect(
        (
          (await request(ownerId, `/campaigns/${campaignId}/library`)) as {
            items: { name: string }[];
          }
        ).items.some((item) => item.name === 'Trail pack'),
      ).toBe(false);
      expect(after.inventory.find((item) => item.id === greaves.id)?.baseArmor?.dr).toBe(2);
      expect(after.skills.some((skill) => skill.name === 'Ropework')).toBe(false);
      expect(after.combat?.currentHp).toBe(1);
      expect(after.earnedPoints).toBe(6);
      for (const name of [
        'Shoalwatch brigandine',
        'Tidewire coif',
        'Beacon visor',
        'Dock leather gloves',
      ])
        expect(
          after.inventory.filter((item) => item.name === name),
          name,
        ).toHaveLength(1);
      const [libraryCoat] = await getDb()
        .select()
        .from(campaignLibraryItems)
        .where(eq(campaignLibraryItems.id, coat.libraryItemId));
      expect(libraryCoat?.armor?.concealable).toBe(true);
      const added = after.inventory.find((item) => item.name === 'Shoalwatch brigandine');
      if (!added) throw new Error('Missing added armor');
      await request(kestrel.ownerId, `/characters/${kestrel.id}/inventory/${added.id}`, 'DELETE');
      const count = await getDb()
        .select()
        .from(entityHistory)
        .where(eq(entityHistory.campaignId, campaignId));
      expect((await refreshLanternCoast(ownerId)).refreshed).toBe(false);
      expect(
        (await loadCharacterDetail(kestrel.id)).inventory.some((item) => item.name === added.name),
      ).toBe(false);
      expect(
        await getDb().select().from(entityHistory).where(eq(entityHistory.campaignId, campaignId)),
      ).toHaveLength(count.length);
    });
  }, 30000);
  it('upgrades V3 copy, races and builds once while preserving customized values', async () => {
    await isolated(async (ownerId) => {
      const { campaignId } = await seedLanternCoast(ownerId);
      const path = `/campaigns/${campaignId}`;
      const library = (await request(ownerId, `${path}/library`)) as Record<
        string,
        { id: string; name: string; key: string }[]
      >;
      const entry = (section: string, name: string) => {
        const found = library[section]?.find((row) => row.name === name);
        if (!found) throw new Error(`Missing ${section} ${name}`);
        return found;
      };
      const v3 = contentV3.library as Record<string, Record<string, Record<string, unknown>>>;
      const quayblade = entry('skills', 'Quayblade');
      const poise = entry('traits', 'Breakwater Poise');
      const lives = library.sources?.find((book) => book.name === 'Greyhaven Lives and Vows');
      if (!lives) throw new Error('Missing source');
      // Untouched V3 text upgrades; a GM's own wording is preserved.
      await request(ownerId, `${path}/library/skills/${quayblade.id}`, 'PATCH', {
        description: v3.skills?.[quayblade.key]?.description,
      });
      await request(ownerId, `${path}/library/traits/${poise.id}`, 'PATCH', {
        description: v3.traits?.[poise.key]?.description,
      });
      await request(ownerId, `${path}/library/skills/${entry('skills', 'Reedbow').id}`, 'PATCH', {
        description: 'Our table’s own reedbow notes.',
      });
      await request(ownerId, `${path}/library/sources/${lives.id}`, 'PATCH', {
        notes: v3.sources?.lantern_lives?.notes,
        edition: v3.sources?.lantern_lives?.edition,
      });
      await request(ownerId, path, 'PATCH', { description: contentV3.campaign.description });
      await request(
        ownerId,
        `${path}/library/spells/${entry('spells', 'Hush the Bell').id}`,
        'DELETE',
      );

      const roster = await getDb()
        .select()
        .from(characters)
        .where(eq(characters.campaignId, campaignId));
      const byName = (name: string) => {
        const row = roster.find((character) => character.name === name);
        if (!row) throw new Error(`Missing ${name}`);
        return row;
      };
      const kestrel = byName('Kestrel Vale');
      const iona = byName('Iona Reedwake');
      const orin = byName('Orin Bellstrand');
      const bram = byName('Bram Stonebridge');
      const before = await loadCharacterDetail(kestrel.id);
      const skill = (name: string) => before.skills.find((row) => row.name === name);
      const kestrelPath = `/characters/${kestrel.id}`;
      await request(kestrel.ownerId, kestrelPath, 'PATCH', { dx: 13 });
      await request(bram.ownerId, `/characters/${bram.id}`, 'PATCH', { st: 18 });
      await request(kestrel.ownerId, `${kestrelPath}/skills/${skill('Quayblade')?.id}`, 'PATCH', {
        points: 8,
      });
      await request(kestrel.ownerId, `${kestrelPath}/skills/${skill('Reedbow')?.id}`, 'PATCH', {
        points: 9,
      });
      const runningShot = before.techniques.find((row) => row.name === 'Running Shot');
      await request(kestrel.ownerId, `${kestrelPath}/techniques/${runningShot?.id}`, 'DELETE');
      const ownedPoise = before.traits.find((row) => row.name === 'Breakwater Poise');
      await request(kestrel.ownerId, `${kestrelPath}/traits/${ownedPoise?.id}`, 'PATCH', {
        notes: v3.traits?.[poise.key]?.description,
      });
      const human = {
        race: {
          selection: { raceId: null, variantKey: null, lensIds: [], formKey: null },
          snapshot: null,
        },
      };
      await request(iona.ownerId, `/characters/${iona.id}`, 'PATCH', human);
      await request(orin.ownerId, `/characters/${orin.id}`, 'PATCH', {
        race: {
          selection: {
            raceId: entry('races', 'Selkie-blooded').id,
            variantKey: null,
            lensIds: [],
            formKey: null,
          },
          snapshot: null,
        },
      });
      await withAudit(ownerId, undefined, async (tx) => {
        await tx.delete(demoSeedUpdates).where(eq(demoSeedUpdates.campaignId, campaignId));
        await tx.insert(demoSeedUpdates).values({ campaignId, seed: 'lantern-coast', version: 3 });
      });

      expect((await refreshLanternCoast(ownerId)).refreshed).toBe(true);
      const after = (await request(ownerId, `${path}/library`)) as typeof library & {
        sources: { name: string; notes: string; edition: string }[];
      };
      const upgraded = (section: string, name: string) =>
        (after[section]?.find((row) => row.name === name) as { description?: string } | undefined)
          ?.description;
      expect(upgraded('skills', 'Quayblade')).toContain('**Penalty:**');
      expect(upgraded('traits', 'Breakwater Poise')).toContain('**On the sheet:**');
      expect(upgraded('skills', 'Reedbow')).toBe('Our table’s own reedbow notes.');
      expect(after.spells?.some((row) => row.name === 'Hush the Bell')).toBe(true);
      expect(after.sources.find((book) => book.name === 'Greyhaven Lives and Vows')).toMatchObject({
        edition: 'First edition',
      });
      expect(after.sources.filter((book) => book.name === 'Greyhaven Lives and Vows')).toHaveLength(
        1,
      );
      const [campaign] = await getDb().select().from(campaigns).where(eq(campaigns.id, campaignId));
      expect(campaign?.description).not.toBe(contentV3.campaign.description);

      const sheet = await loadCharacterDetail(kestrel.id);
      expect(sheet.dx).toBe(14);
      expect(sheet.skills.find((row) => row.name === 'Quayblade')?.points).toBe(12);
      expect(sheet.skills.find((row) => row.name === 'Reedbow')?.points).toBe(9);
      expect(sheet.techniques.some((row) => row.name === 'Running Shot')).toBe(true);
      expect(sheet.traits.find((row) => row.name === 'Breakwater Poise')?.notes).toContain(
        '**On the sheet:**',
      );
      expect((await loadCharacterDetail(bram.id)).st).toBe(18);
      expect((await loadCharacterDetail(iona.id)).race?.snapshot?.name).toBe('Selkie-blooded');
      expect((await loadCharacterDetail(orin.id)).race?.snapshot?.name).toBe('Selkie-blooded');

      const count = await getDb()
        .select()
        .from(entityHistory)
        .where(eq(entityHistory.campaignId, campaignId));
      expect((await refreshLanternCoast(ownerId)).refreshed).toBe(false);
      expect(
        await getDb().select().from(entityHistory).where(eq(entityHistory.campaignId, campaignId)),
      ).toHaveLength(count.length);
    });
  }, 60000);
  it('keeps renamed source UUID links and tolerates a deleted source with no definitions', async () => {
    await isolated(async (ownerId) => {
      const old = await oldDemo(ownerId);
      const before = catalogSchema.parse(await request(ownerId, `${old.path}/library`));
      const linkedTrait = before.traits.find((entry) => entry.name === 'Breakwater Poise');
      if (!linkedTrait?.sourceId) throw new Error('Missing linked sourcebook UUID');
      const linkedBook = before.sources.find((entry) => entry.id === linkedTrait.sourceId);
      if (!linkedBook) throw new Error('Missing linked sourcebook');
      const renamed = await request(
        ownerId,
        `${old.path}/library/sources/${linkedBook.id}`,
        'PATCH',
        {
          name: 'Greyhaven Lives and Vows: revised',
          abbreviation: 'LCGV-R',
          edition: 'Synthetic playtest 2',
        },
      );
      expect(librarySourceOut.parse(renamed)).toMatchObject({
        id: linkedBook.id,
        name: 'Greyhaven Lives and Vows: revised',
        abbreviation: 'LCGV-R',
        edition: 'Synthetic playtest 2',
      });

      const unusedBook = {
        name: 'Refresh-only unused source',
        key: 'refresh_unused_source',
        abbreviation: 'RUS',
        edition: 'Synthetic fixture',
        priority: 99,
      };
      const created = await request(ownerId, `${old.path}/library/sources`, 'POST', {
        name: unusedBook.name,
        abbreviation: unusedBook.abbreviation,
        edition: unusedBook.edition,
        priority: unusedBook.priority,
      });
      const unusedId = identified.parse(created).id;
      const document = parseLibraryYaml(old.text);
      document.library.sources ??= [];
      document.library.sources.push(unusedBook);
      await request(ownerId, `${old.path}/library/sources/${unusedId}`, 'DELETE');

      await refreshLanternCoast(ownerId, stringify(document));
      const after = catalogSchema.parse(await request(ownerId, `${old.path}/library`));
      expect(after.sources.find((entry) => entry.id === linkedBook.id)).toMatchObject({
        name: 'Greyhaven Lives and Vows: revised',
        abbreviation: 'LCGV-R',
        edition: 'Synthetic playtest 2',
      });
      expect(after.traits.find((entry) => entry.id === linkedTrait.id)?.sourceId).toBe(
        linkedBook.id,
      );
      expect(after.sources.some((entry) => entry.name === unusedBook.name)).toBe(false);
      expect(after.sources.some((entry) => entry.id === unusedId)).toBe(false);
      expect(after.sources).toHaveLength(before.sources.length);
      const detail = await loadCharacterDetail(old.characterId);
      expect(detail.traits.find((entry) => entry.id === old.ownedTraitId)?.points).toBe(17);
      expect(detail.skills.find((entry) => entry.id === old.ownedForagingId)?.points).toBe(4);
      expect(detail.skills.find((entry) => entry.id === old.ownedBarterId)?.notes).toBe(
        'My negotiated harbor rates; keep these.',
      );
    });
  }, 30000);

  it('enriches untouched defaults while preserving edits, costs, play state and private access', async () => {
    await isolated(async (ownerId) => {
      const old = await oldDemo(ownerId);
      const oldDocument = parseLibraryYaml(old.text);
      const restricted = oldDocument.library.traits.find(
        (entry) => entry.name === "Beacon Courier's Seal",
      );
      if (!restricted) throw new Error('Missing new courier privilege');
      const sourcebook = oldDocument.library.sources?.find(
        (entry) => entry.key === restricted.sourceKey,
      );
      const currentCatalog = catalogSchema.parse(await request(ownerId, `${old.path}/library`));
      const source = currentCatalog.sources.find(
        (entry) =>
          entry.name === sourcebook?.name && entry.abbreviation === sourcebook.abbreviation,
      );
      if (!source) throw new Error('Missing courier sourcebook');
      const { sourceKey: _portableSourceKey, ...liveRestricted } = restricted;
      await request(ownerId, `${old.path}/library/traits`, 'POST', {
        ...liveRestricted,
        sourceId: source.id,
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
      expect(refreshedForaging?.notes).toContain('Ledge gardens of samphire');
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
