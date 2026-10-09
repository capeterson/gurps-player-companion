/** Conservative, once-only enrichment of the original synthetic campaign. */
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  canPlayerSelectLibraryEntry,
  canonicalLibraryKey,
  libraryEntryKey,
} from '../../../shared/domain/libraryIdentity.ts';
import {
  definitionReference,
  resolveLibraryPricing,
} from '../../../shared/domain/libraryPricing.ts';
import {
  librarySkillCopyNotes,
  resolveLibrarySkillSpecialization,
} from '../../../shared/domain/librarySkillSpecializations.ts';
import {
  libraryItemOut,
  librarySkillCreate,
  librarySkillOut,
  libraryTraitCreate,
  libraryTraitOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import {
  type LibraryMetadata,
  libraryModifierOut,
  librarySourceOut,
} from '../../../shared/schemas/libraryMetadata.ts';
import { skillCreate } from '../../../shared/schemas/skill.ts';
import { skillProcedures } from '../../../shared/schemas/skillProcedures.ts';
import { traitCreate } from '../../../shared/schemas/trait.ts';
import { emitLibraryYaml, parseLibraryYaml } from '../../../shared/yaml/library.ts';
import {
  exportSourceReferences,
  importSourceReferences,
  portableLibraryEntry,
  sourceExportKeys,
  sourceImportIdentity,
} from '../../../shared/yaml/sourceReferences.ts';
import { createApp } from '../../app.ts';
import { signAccessToken } from '../../auth/jwt.ts';
import { loadConfig } from '../../config.ts';
import { closeDb, getDb, runInDbSavepoint, runInDbTransaction } from '../client.ts';
import {
  adventureLogEntries,
  campaignMemberships,
  campaigns,
  characterSkills,
  characterTraits,
  characters,
  users,
} from '../schema.ts';
import { ensureDemoUser } from './accounts.ts';
import { seedLanternCoast } from './lanternCoast.ts';
import { LANTERN_CAMPAIGN_NAME, type LanternRequest } from './lanternCoastContent.ts';
import { refreshLanternCoastV4 } from './lanternCoastContentV4.ts';
import { lanternCharacters, lanternSharedLogs } from './lanternCoastData.ts';
import { refreshLanternCoastEquipment } from './lanternCoastEquipment.ts';
import { lanternSeedIsCurrent, recordLanternSeedVersion } from './lanternCoastRevision.ts';

const purchaseIdentity = (row: { name: string; specialization?: unknown }) =>
  JSON.stringify([row.name, row.specialization ?? null]);
const baselineSchema = z.object({
  traits: portableLibraryEntry(libraryTraitCreate).array(),
  skills: portableLibraryEntry(librarySkillCreate).array(),
  characters: z.array(
    z.object({
      name: z.string(),
      traits: z.array(z.object({ name: z.string() }).passthrough()),
      skills: z.array(
        z.object({ name: z.string(), specialization: z.string().optional() }).passthrough(),
      ),
    }),
  ),
});
const catalogSchema = z.object({
  traits: libraryTraitOut.array(),
  skills: librarySkillOut.array(),
  items: libraryItemOut.array(),
  modifiers: libraryModifierOut.array(),
  sources: librarySourceOut.array(),
});

/** Missing and ambiguous characters are preserved rather than recreated or reassigned. */
export interface LanternRefreshResult {
  campaignId: string;
  created: boolean;
  refreshed: boolean;
  skippedCharacters: string[];
}

export async function refreshLanternCoast(
  ownerId: string,
  libraryText?: string,
): Promise<LanternRefreshResult> {
  return runInDbSavepoint(async () => {
    const db = getDb();
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`seed:lantern:${ownerId}`}, 0))`,
    );
    const matching = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.ownerId, ownerId), eq(campaigns.name, LANTERN_CAMPAIGN_NAME)));
    if (matching.length > 1) throw new Error('Ambiguous Lantern Coast campaigns for seed owner');
    const campaign = matching[0];
    if (!campaign) {
      const result = await seedLanternCoast(ownerId, libraryText);
      return { ...result, refreshed: false, skippedCharacters: [] };
    }
    if (await lanternSeedIsCurrent(campaign.id))
      return { campaignId: campaign.id, created: false, refreshed: false, skippedCharacters: [] };

    const baseline = baselineSchema.parse(
      JSON.parse(await readFile(new URL('./lanternCoastV1.json', import.meta.url), 'utf8')),
    );
    const document = parseLibraryYaml(
      libraryText ??
        (await readFile(
          new URL('../../../../bootstrap/lantern_coast.yaml', import.meta.url),
          'utf8',
        )),
    );
    const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
    if (!owner) throw new Error('Seed owner does not exist');
    const app = createApp(loadConfig());
    const ownerToken = (await signAccessToken(owner.id, owner.authVersion)).token;
    const request: LanternRequest = async (token, path, method = 'POST', body?: unknown) => {
      const response = await app.request(`/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(
          `Lantern refresh ${method} ${path}: ${response.status} ${await response.text()}`,
        );
      return response.status === 204 ? null : response.json();
    };
    const campaignPath = `/campaigns/${campaign.id}`;
    const matchedPlayers = async () => {
      const roster = await db
        .select()
        .from(characters)
        .where(eq(characters.campaignId, campaign.id));
      const players: Parameters<typeof refreshLanternCoastEquipment>[0]['players'] = [];
      for (const fixture of lanternCharacters) {
        const [actor] = await db.select().from(users).where(eq(users.email, fixture.email));
        const matches = roster.filter(
          (row) => row.name === fixture.character.name && row.ownerId === actor?.id,
        );
        if (!actor || matches.length !== 1 || !matches[0]) continue;
        players.push({
          fixture,
          characterId: matches[0].id,
          actor: (await signAccessToken(actor.id, actor.authVersion)).token,
        });
      }
      const skipped = lanternCharacters
        .filter((fixture) => !players.some((player) => player.fixture === fixture))
        .map((fixture) => fixture.character.name);
      return { players, skipped };
    };
    const yamlOverride = libraryText === undefined ? {} : { yaml: libraryText };
    const refreshEquipment = async () => {
      const { players, skipped } = await matchedPlayers();
      await refreshLanternCoastEquipment({
        campaignId: campaign.id,
        ownerActor: ownerToken,
        request,
        players,
        ...yamlOverride,
      });
      return skipped;
    };
    const refreshContentV4 = async () => {
      const { players, skipped } = await matchedPlayers();
      await refreshLanternCoastV4({
        campaignId: campaign.id,
        ownerActor: ownerToken,
        request,
        players,
        ...yamlOverride,
      });
      return skipped;
    };
    // Each later revision runs alone on a campaign that already received the
    // earlier ones, so deleted V2 skills/notes and V3 equipment are not restored.
    if (await lanternSeedIsCurrent(campaign.id, 3)) {
      const skippedCharacters = await refreshContentV4();
      await recordLanternSeedVersion(campaign.id, ownerId);
      return { campaignId: campaign.id, created: false, refreshed: true, skippedCharacters };
    }
    if (await lanternSeedIsCurrent(campaign.id, 2)) {
      const skippedCharacters = await refreshEquipment();
      await refreshContentV4();
      await recordLanternSeedVersion(campaign.id, ownerId);
      return { campaignId: campaign.id, created: false, refreshed: true, skippedCharacters };
    }
    let catalog = catalogSchema.parse(await request(ownerToken, `${campaignPath}/library`, 'GET'));

    // Import only new definitions. Merge of the complete document would silently
    // restore deleted originals and overwrite GM edits, including purchase prices.
    // The authored YAML may retain its original labels after the GM renames a
    // book. Surviving definitions identify that book by UUID. Missing books and
    // their definitions are deliberately excluded from this conservative refresh.
    const sourceAliases = new Map<string, string>();
    for (const source of document.library.sources ?? []) {
      const metadataMatches = catalog.sources.filter(
        (book) => sourceImportIdentity(book) === sourceImportIdentity(source),
      );
      const linkedIds = new Set<string>();
      for (const section of ['traits', 'skills'] as const) {
        for (const authored of document.library[section]) {
          if (canonicalLibraryKey(authored.sourceKey ?? '') !== canonicalLibraryKey(source.key))
            continue;
          for (const existing of catalog[section]) {
            if (
              canonicalLibraryKey(existing.key ?? existing.name) ===
                canonicalLibraryKey(authored.key ?? authored.name) &&
              existing.name === authored.name &&
              ('kind' in existing ? existing.kind : null) ===
                ('kind' in authored ? authored.kind : null) &&
              existing.sourceId
            )
              linkedIds.add(existing.sourceId);
          }
        }
      }
      const id =
        metadataMatches.length === 1
          ? metadataMatches[0]?.id
          : linkedIds.size === 1
            ? [...linkedIds][0]
            : undefined;
      if (id && catalog.sources.some((book) => book.id === id))
        sourceAliases.set(canonicalLibraryKey(source.key), id);
    }
    const hasUnavailableSource = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(hasUnavailableSource);
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value).some(([key, entry]) =>
        key === 'sourceKey'
          ? entry != null && !sourceAliases.has(canonicalLibraryKey(String(entry)))
          : hasUnavailableSource(entry),
      );
    };
    const resolveRefreshContent = (content: {
      traits: typeof document.library.traits;
      skills: typeof document.library.skills;
    }) => {
      const resolved = importSourceReferences(
        {
          traits: content.traits.filter((entry) => !hasUnavailableSource(entry)),
          skills: content.skills.filter((entry) => !hasUnavailableSource(entry)),
          sources: document.library.sources?.filter((source) =>
            sourceAliases.has(canonicalLibraryKey(source.key)),
          ),
        },
        catalog.sources,
        sourceAliases,
      ) as { traits: unknown; skills: unknown };
      return {
        traits: libraryTraitCreate.array().parse(resolved.traits),
        skills: librarySkillCreate.array().parse(resolved.skills),
      };
    };
    const authoredLive = resolveRefreshContent(document.library);
    const baselineLive = resolveRefreshContent(baseline);
    const availableSourceIds = new Set(catalog.sources.map((source) => source.id));
    const additions = <T extends LibraryMetadata & { name: string; kind?: string | undefined }>(
      authored: readonly T[],
      original: readonly T[],
      existing: readonly T[],
    ) => {
      const oldKeys = new Set(original.map(libraryEntryKey));
      const currentKeys = new Set(existing.map(libraryEntryKey));
      const currentNames = new Set(existing.map((entry) => entry.name));
      return authored.filter(
        (entry) =>
          !oldKeys.has(libraryEntryKey(entry)) &&
          !currentKeys.has(libraryEntryKey(entry)) &&
          !currentNames.has(entry.name) &&
          (!entry.sourceId || availableSourceIds.has(entry.sourceId)),
      );
    };
    const newTraits = additions(
      authoredLive.traits ?? [],
      baselineLive.traits ?? [],
      catalog.traits,
    );
    const newSkills = additions(
      authoredLive.skills ?? [],
      baselineLive.skills ?? [],
      catalog.skills,
    );
    if (newTraits.length || newSkills.length) {
      await request(ownerToken, `${campaignPath}/library/import`, 'POST', {
        yaml: emitLibraryYaml({
          sources: catalog.sources.map(
            ({
              id,
              campaignId: _campaign,
              revision: _rev,
              createdAt: _created,
              updatedAt: _updated,
              ...book
            }) => ({ ...book, key: sourceExportKeys(catalog.sources).get(id) as string }),
          ),
          traits: exportSourceReferences(newTraits, catalog.sources) as Parameters<
            typeof emitLibraryYaml
          >[0]['traits'],
          skills: exportSourceReferences(newSkills, catalog.sources) as Parameters<
            typeof emitLibraryYaml
          >[0]['skills'],
          spells: [],
          items: [],
          languages: [],
          techniques: [],
          styles: [],
        }),
        mode: 'merge',
        applyCampaignSettings: false,
      });
    }

    // Each annotation/rule field is compared independently. Pricing, effects,
    // identity, restriction flags and campaign settings are never refreshed.
    for (const section of ['traits', 'skills'] as const) {
      for (const original of baselineLive[section] ?? []) {
        const key = libraryEntryKey(original);
        const current = catalog[section].filter((entry) => libraryEntryKey(entry) === key);
        const authored = (authoredLive[section] ?? []).find(
          (entry) => libraryEntryKey(entry) === key,
        );
        if (current.length !== 1 || !authored) continue;
        const existing = current[0];
        if (!existing) continue;
        const fields =
          section === 'traits'
            ? ['description']
            : [
                'description',
                'specializationPolicy',
                'procedures',
                'defaults',
                'prerequisites',
                'prerequisiteRules',
                'situationalModifiers',
              ];
        const patch: Record<string, unknown> = {};
        for (const field of fields) {
          const originalField = (original as unknown as Record<string, unknown>)[field];
          const currentField = (existing as Record<string, unknown>)[field];
          const oldValue =
            field === 'procedures'
              ? skillProcedures.parse(originalField ?? {})
              : (originalField ?? null);
          const currentValue =
            field === 'procedures'
              ? skillProcedures.parse(currentField ?? {})
              : (currentField ?? null);
          const nextValue = (authored as unknown as Record<string, unknown>)[field];
          if (
            nextValue !== undefined &&
            isDeepStrictEqual(currentValue, oldValue) &&
            !isDeepStrictEqual(currentValue, nextValue)
          )
            patch[field] = nextValue;
        }
        if (Object.keys(patch).length)
          await request(
            ownerToken,
            `${campaignPath}/library/${section}/${existing.id}`,
            'PATCH',
            patch,
          );
      }
    }
    catalog = catalogSchema.parse(await request(ownerToken, `${campaignPath}/library`, 'GET'));
    const campaignCharacters = await db
      .select()
      .from(characters)
      .where(eq(characters.campaignId, campaign.id));
    const logs = await db
      .select()
      .from(adventureLogEntries)
      .where(eq(adventureLogEntries.campaignId, campaign.id));
    const memberships = await db
      .select()
      .from(campaignMemberships)
      .where(eq(campaignMemberships.campaignId, campaign.id));
    const memberIds = new Set(memberships.map((member) => member.userId));
    const skippedCharacters: string[] = [];

    for (const fixture of lanternCharacters) {
      const [player] = await db.select().from(users).where(eq(users.email, fixture.email));
      const genericTitle = `${fixture.character.name}: a promise unspoken`;
      const genericBody = `A private note by **${fixture.displayName}**.\n\nI have not told the others what the beacon showed me.`;
      const owned = campaignCharacters.filter(
        (row) => row.name === fixture.character.name && row.ownerId === player?.id,
      );
      const legacyIds = new Set(
        logs
          .filter(
            (entry) =>
              entry.visibility === 'private' &&
              entry.authorId === player?.id &&
              (entry.title === genericTitle || entry.body === genericBody) &&
              entry.characterId,
          )
          .map((entry) => entry.characterId),
      );
      const legacy = campaignCharacters.filter(
        (row) => row.ownerId === player?.id && legacyIds.has(row.id),
      );
      const candidates = owned.length ? owned : legacy;
      const character = candidates.length === 1 ? candidates[0] : undefined;
      if (!character || (character.ownerId !== ownerId && !memberIds.has(character.ownerId))) {
        skippedCharacters.push(fixture.character.name);
        continue;
      }
      const [actor] = await db.select().from(users).where(eq(users.id, character.ownerId));
      if (!actor) {
        skippedCharacters.push(fixture.character.name);
        continue;
      }
      const token = (await signAccessToken(actor.id, actor.authVersion)).token;
      const path = `/characters/${character.id}`;
      const oldFixture = baseline.characters.find((row) => row.name === fixture.character.name);
      if (!oldFixture)
        throw new Error(`Missing original Lantern fixture: ${fixture.character.name}`);
      const traits = await db
        .select()
        .from(characterTraits)
        .where(eq(characterTraits.characterId, character.id));
      const skills = await db
        .select()
        .from(characterSkills)
        .where(eq(characterSkills.characterId, character.id));

      for (const row of traits) {
        const original = baselineLive.traits?.find((entry) => entry.name === row.name);
        const source = catalog.traits.find((entry) => entry.id === row.libraryTraitId);
        if (
          original &&
          source &&
          libraryEntryKey(source) === libraryEntryKey(original) &&
          row.notes === null &&
          oldFixture.traits.some((entry) => entry.name === row.name)
        )
          await request(token, `${path}/traits/${row.id}`, 'PATCH', { notes: source.description });
      }
      for (const row of skills) {
        const original = baselineLive.skills?.find((entry) => entry.name === row.name);
        const source = catalog.skills.find((entry) => entry.id === row.librarySkillId);
        if (
          !original ||
          !source ||
          libraryEntryKey(source) !== libraryEntryKey(original) ||
          !oldFixture.skills.some((entry) => purchaseIdentity(entry) === purchaseIdentity(row))
        )
          continue;
        const oldSource = librarySkillOut.parse({
          ...source,
          ...original,
          description: original.description ?? null,
          prerequisites: original.prerequisites ?? null,
          defaultSpecialization: original.defaultSpecialization ?? null,
        });
        const oldNotes = librarySkillCopyNotes(
          oldSource.source,
          resolveLibrarySkillSpecialization(oldSource, row.specialization),
        );
        if (row.notes === oldNotes) {
          const notes = librarySkillCopyNotes(
            source.source,
            resolveLibrarySkillSpecialization(source, row.specialization),
          );
          if (notes !== row.notes)
            await request(token, `${path}/skills/${row.id}`, 'PATCH', { notes });
        }
      }

      for (const entry of fixture.traits) {
        if (
          oldFixture.traits.some((old) => old.name === entry.name) ||
          traits.some((row) => row.name === entry.name)
        )
          continue;
        if (!document.library.traits.some((row) => row.name === entry.name))
          throw new Error(`Missing Lantern refresh traits: ${entry.name}`);
        const authored = authoredLive.traits?.find((row) => row.name === entry.name);
        if (!authored) continue;
        const matches = catalog.traits.filter(
          (row) => libraryEntryKey(row) === libraryEntryKey(authored),
        );
        if (matches.length !== 1) continue;
        const source = matches[0];
        if (!source || source.name !== entry.name || !canPlayerSelectLibraryEntry(source)) continue;
        const pricingResolution = resolveLibraryPricing(
          catalog,
          definitionReference('traits', source),
          source.pointsPerLevel != null ? { level: Number(entry.level ?? 1) } : {},
        );
        await request(
          token,
          `${path}/traits`,
          'POST',
          traitCreate.parse({
            ...source,
            ...entry,
            notes: entry.notes ?? source.description,
            libraryTraitId: source.id,
            pricingResolution,
          }),
        );
      }
      for (const entry of fixture.skills) {
        if (
          oldFixture.skills.some((old) => purchaseIdentity(old) === purchaseIdentity(entry)) ||
          skills.some((row) => purchaseIdentity(row) === purchaseIdentity(entry))
        )
          continue;
        if (!document.library.skills.some((row) => row.name === entry.name))
          throw new Error(`Missing Lantern refresh skills: ${entry.name}`);
        const authored = authoredLive.skills?.find((row) => row.name === entry.name);
        if (!authored) continue;
        const matches = catalog.skills.filter(
          (row) => libraryEntryKey(row) === libraryEntryKey(authored),
        );
        if (matches.length !== 1) continue;
        const source = matches[0];
        if (!source || source.name !== entry.name || !canPlayerSelectLibraryEntry(source)) continue;
        await request(
          token,
          `${path}/skills`,
          'POST',
          skillCreate.parse({
            ...source,
            ...entry,
            librarySkillId: source.id,
          }),
        );
      }

      for (const { key: _key, ...entry } of fixture.privateLogs) {
        const privateLogs = logs.filter(
          (log) =>
            log.characterId === character.id &&
            log.authorId === actor.id &&
            log.visibility === 'private',
        );
        const originals = privateLogs.filter(
          (log) =>
            log.title === genericTitle &&
            log.body === genericBody &&
            log.sessionDate === '2026-09-18' &&
            log.sessionNumber === 4 &&
            log.location === null &&
            log.pointsGained === null &&
            log.xpAwards.length === 0,
        );
        if (entry.sessionNumber === 4 && originals.length === 1 && originals[0]) {
          await request(token, `${campaignPath}/log/${originals[0].id}`, 'PATCH', entry);
          continue;
        }
        // A player's edited legacy journal remains alongside the new authored
        // session-four note. Other authored titles are preserved if customized.
        const present = privateLogs.some(
          (log) =>
            log.title === entry.title &&
            (entry.sessionNumber !== 4 ||
              (log.body === entry.body &&
                log.sessionDate === entry.sessionDate &&
                log.sessionNumber === entry.sessionNumber)),
        );
        if (present) continue;
        await request(token, `${campaignPath}/log`, 'POST', {
          ...entry,
          visibility: 'private',
          characterId: character.id,
        });
      }
    }
    for (const { key: _key, awardPerCharacter, ...entry } of lanternSharedLogs) {
      if (
        awardPerCharacter !== undefined ||
        logs.some(
          (log) =>
            log.visibility === 'campaign' &&
            log.characterId === null &&
            log.sessionNumber === entry.sessionNumber,
        )
      )
        continue;
      await request(ownerToken, `${campaignPath}/log`, 'POST', {
        ...entry,
        visibility: 'campaign',
      });
    }
    for (const name of [...(await refreshEquipment()), ...(await refreshContentV4())]) {
      if (!skippedCharacters.includes(name)) skippedCharacters.push(name);
    }
    // Last write: a rerun must not recreate deliberate deletions after enrichment.
    await recordLanternSeedVersion(campaign.id, ownerId);
    return { campaignId: campaign.id, created: false, refreshed: true, skippedCharacters };
  });
}

if (import.meta.main) {
  try {
    const result = await runInDbTransaction(async () => {
      const owner = await ensureDemoUser('seed@example.invalid', 'Seed');
      return refreshLanternCoast(owner.id);
    });
    console.log(
      `Lantern Coast ${result.created ? 'created' : result.refreshed ? 'refreshed' : 'preserved'}: ${result.campaignId}`,
    );
    if (result.skippedCharacters.length)
      console.log(`Preserved missing/ambiguous characters: ${result.skippedCharacters.join(', ')}`);
  } catch (error) {
    console.error('Lantern refresh failed', error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
