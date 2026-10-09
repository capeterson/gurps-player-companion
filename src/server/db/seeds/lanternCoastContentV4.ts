/** Once-only V4 copy, race and character-build enrichment through the seed's API transport.
 * Every field changes only while it still equals the V3 release; GM edits, player
 * purchases, deletions and play state are preserved. Callers own the transaction
 * and the completion revision marker.
 */
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import {
  canPlayerSelectLibraryEntry,
  canonicalLibraryKey,
} from '../../../shared/domain/libraryIdentity.ts';
import {
  definitionReference,
  resolveLibraryPricing,
} from '../../../shared/domain/libraryPricing.ts';
import {
  librarySkillCopyNotes,
  resolveLibrarySkillSpecialization,
} from '../../../shared/domain/librarySkillSpecializations.ts';
import { campaignOut } from '../../../shared/schemas/campaign.ts';
import {
  libraryItemOut,
  librarySkillOut,
  libraryTraitOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { characterDetail } from '../../../shared/schemas/character.ts';
import { inventoryItemUpdate } from '../../../shared/schemas/inventory.ts';
import { languageCreate } from '../../../shared/schemas/language.ts';
import { libraryModifierOut, librarySourceOut } from '../../../shared/schemas/libraryMetadata.ts';
import { libraryRaceOut } from '../../../shared/schemas/race.ts';
import { skillProcedures } from '../../../shared/schemas/skillProcedures.ts';
import { spellCreate } from '../../../shared/schemas/spell.ts';
import { techniqueCreate } from '../../../shared/schemas/technique.ts';
import { traitCreate } from '../../../shared/schemas/trait.ts';
import { emitLibraryYaml, parseLibraryYaml } from '../../../shared/yaml/library.ts';
import {
  exportSourceReferences,
  importSourceReferences,
  sourceExportKeys,
  sourceImportIdentity,
} from '../../../shared/yaml/sourceReferences.ts';
import type { LanternRequest } from './lanternCoastContent.ts';
import type { SeedCharacter } from './lanternCoastData.ts';

type Player = { fixture: SeedCharacter; actor: string; characterId: string };
type Entry = Record<string, unknown> & { id: string; name: string; key?: string | null };
type Purchase = { name: string; points: number; level?: number; specialization?: string };
interface Baseline {
  campaign: { description: string };
  library: Record<string, Record<string, Record<string, unknown>>>;
  characters: {
    name: string;
    character: Record<string, unknown>;
    traits: Purchase[];
    skills: Purchase[];
    spells: Purchase[];
    languages: Purchase[];
    techniques: Purchase[];
  }[];
  inventoryNotes: Record<string, string>;
}

/** Sections whose new V4 definitions are imported when the campaign lacks them. */
const ADDED_SECTIONS = [
  'languages',
  'spells',
  'techniques',
  'styles',
  'modifiers',
  'races',
] as const;
/** YAML section name → library REST path segment for text upgrades. */
const PATCH_PATHS: Record<string, string> = {
  traits: 'traits',
  skills: 'skills',
  spells: 'spells',
  languages: 'languages',
  techniques: 'techniques',
  styles: 'styles',
  enchantments: 'enchantments',
  activeEffects: 'active-effects',
  items: 'items',
  modifiers: 'modifiers',
  sources: 'sources',
};
const ATTRIBUTE_FIELDS = ['st', 'dx', 'iq', 'ht', 'hpMod', 'fpMod', 'willMod', 'perMod'] as const;
const clean = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));
const same = (a: unknown, b: unknown) => isDeepStrictEqual(clean(a), clean(b));
const identity = (row: { name: string; specialization?: unknown }) =>
  JSON.stringify([row.name, row.specialization ?? null]);

export async function refreshLanternCoastV4({
  campaignId,
  ownerActor,
  request,
  players,
  yaml,
}: {
  campaignId: string;
  ownerActor: string;
  request: LanternRequest;
  players: Player[];
  yaml?: string;
}) {
  const path = `/campaigns/${campaignId}`;
  const document = parseLibraryYaml(
    yaml ??
      (await readFile(
        new URL('../../../../bootstrap/lantern_coast.yaml', import.meta.url),
        'utf8',
      )),
  );
  const baseline = JSON.parse(
    await readFile(new URL('./lanternCoastV3Text.json', import.meta.url), 'utf8'),
  ) as Baseline;

  const campaign = campaignOut.parse(await request(ownerActor, path, 'GET'));
  if (
    campaign.description === baseline.campaign.description &&
    document.campaign?.description &&
    campaign.description !== document.campaign.description
  )
    await request(ownerActor, path, 'PATCH', { description: document.campaign.description });

  const readCatalog = async () =>
    (await request(ownerActor, `${path}/library`, 'GET')) as Record<string, Entry[]>;
  let catalog = await readCatalog();
  const sources = librarySourceOut.array().parse(catalog.sources);
  const authored = document.library as unknown as Record<string, Entry[] | undefined>;

  // A book is aliased only by an exact, unique name/abbreviation/edition match,
  // so a deleted or re-edited book never receives new definitions by guesswork.
  const aliases = new Map<string, string>();
  for (const book of document.library.sources ?? []) {
    // V3 books carry the earlier edition label until the text upgrade below.
    const v3Edition = baseline.library.sources?.[book.key]?.edition;
    const identities = new Set([
      sourceImportIdentity(book),
      ...(typeof v3Edition === 'string'
        ? [sourceImportIdentity({ ...book, edition: v3Edition })]
        : []),
    ]);
    const matches = sources.filter((row) => identities.has(sourceImportIdentity(row)));
    if (matches.length === 1 && matches[0])
      aliases.set(canonicalLibraryKey(book.key), matches[0].id);
  }
  const keyOf = (entry: { key?: string | null; name: string }) =>
    canonicalLibraryKey(entry.key ?? entry.name);
  const present = (section: string, entry: Entry) =>
    (catalog[section] ?? []).some((row) => row.name === entry.name || keyOf(row) === keyOf(entry));
  const additions: Record<string, Entry[]> = {};
  for (const section of ADDED_SECTIONS) {
    const previous = baseline.library[section] ?? {};
    additions[section] = (authored[section] ?? []).filter(
      (entry) =>
        !(String(entry.key) in previous) &&
        !present(section, entry) &&
        (!entry.sourceKey || aliases.has(canonicalLibraryKey(String(entry.sourceKey)))),
    );
  }
  if (Object.values(additions).some((rows) => rows.length)) {
    const live = importSourceReferences(
      {
        ...additions,
        sources: document.library.sources?.filter((book) =>
          aliases.has(canonicalLibraryKey(book.key)),
        ),
      },
      sources,
      aliases,
    ) as Record<string, unknown[]>;
    const keys = sourceExportKeys(sources);
    const portable = (section: string) =>
      exportSourceReferences(live[section] ?? [], sources) as never[];
    await request(ownerActor, `${path}/library/import`, 'POST', {
      mode: 'merge',
      applyCampaignSettings: false,
      yaml: emitLibraryYaml({
        sources: sources
          .filter((book) => [...aliases.values()].includes(book.id))
          .map(
            ({
              id,
              campaignId: _campaign,
              revision: _revision,
              createdAt: _created,
              updatedAt: _updated,
              ...book
            }) => ({ ...book, key: keys.get(id) as string }),
          ),
        traits: [],
        skills: [],
        items: [],
        enchantments: [],
        activeEffects: [],
        languages: portable('languages'),
        spells: portable('spells'),
        techniques: portable('techniques'),
        styles: portable('styles'),
        modifiers: portable('modifiers'),
        races: portable('races'),
      }),
    });
    catalog = await readCatalog();
  }

  // Text upgrades: each field is compared to the exact V3 release independently.
  for (const [section, entries] of Object.entries(baseline.library)) {
    const next = section === 'sources' ? document.library.sources : authored[section];
    for (const [key, fields] of Object.entries(entries)) {
      const target = (next ?? []).find((entry) => entry.key === key) as
        | Record<string, unknown>
        | undefined;
      // Sourcebooks have no library key; use the identity alias resolved above.
      const matches =
        section === 'sources'
          ? (catalog.sources ?? []).filter(
              (row) => row.id === aliases.get(canonicalLibraryKey(key)),
            )
          : (catalog[section] ?? []).filter(
              (row) =>
                canonicalLibraryKey(String(row.key ?? row.name)) === canonicalLibraryKey(key),
            );
      if (!target || matches.length !== 1 || !matches[0]) continue;
      const current = matches[0];
      const patch: Record<string, unknown> = {};
      for (const [field, previous] of Object.entries(fields)) {
        const normal = (value: unknown) =>
          field === 'procedures' ? skillProcedures.parse(value ?? {}) : value;
        if (
          same(normal(current[field]), normal(previous)) &&
          !same(normal(current[field]), normal(target[field]))
        )
          patch[field] = target[field];
      }
      if (Object.keys(patch).length)
        await request(
          ownerActor,
          `${path}/library/${PATCH_PATHS[section]}/${current.id}`,
          'PATCH',
          patch,
        );
    }
  }
  catalog = await readCatalog();
  const pricingCatalog = {
    traits: libraryTraitOut.array().parse(catalog.traits),
    items: libraryItemOut.array().parse(catalog.items),
    modifiers: libraryModifierOut.array().parse(catalog.modifiers),
  };
  const skillsCatalog = librarySkillOut.array().parse(catalog.skills);
  const racesCatalog = libraryRaceOut.array().parse(catalog.races ?? []);
  const selectable = (section: string, name: string) => {
    const rows = (catalog[section] ?? []).filter((row) => row.name === name);
    const row = rows.length === 1 ? rows[0] : undefined;
    return row && canPlayerSelectLibraryEntry(row as never) ? row : undefined;
  };
  const oldDescription = (section: string, row: Entry) =>
    baseline.library[section]?.[String(row.key)]?.description;

  for (const { fixture, actor, characterId } of players) {
    const old = baseline.characters.find((entry) => entry.name === fixture.character.name);
    if (!old) throw new Error(`Missing V3 Lantern baseline: ${fixture.character.name}`);
    const character = characterDetail.parse(
      await request(actor, `/characters/${characterId}`, 'GET'),
    );
    const sheet = character as unknown as Record<string, unknown>;
    const characterPath = `/characters/${characterId}`;

    const patch: Record<string, unknown> = {};
    for (const field of ATTRIBUTE_FIELDS) {
      const previous = old.character[field] ?? 0;
      const next = fixture.character[field] ?? 0;
      if (sheet[field] === previous && previous !== next) patch[field] = next;
    }
    if (
      character.appearance === old.character.appearance &&
      fixture.character.appearance !== old.character.appearance
    )
      patch.appearance = fixture.character.appearance;
    if (Object.keys(patch).length) await request(actor, characterPath, 'PATCH', patch);

    // Only a character still on the Human default receives the authored race.
    const race = fixture.race;
    const selection = character.race?.selection;
    if (race && !selection?.raceId && !selection?.lensIds.length) {
      const base = race.name ? racesCatalog.find((row) => row.name === race.name) : null;
      const lenses = (race.lenses ?? []).map((name) =>
        racesCatalog.find((row) => row.name === name),
      );
      const variant = race.variant
        ? base?.variants.find((option) => option.name === race.variant)
        : undefined;
      if (
        (!race.name || base) &&
        (!race.variant || variant) &&
        lenses.every((lens) => lens) &&
        [base, ...lenses].every((row) => !row || canPlayerSelectLibraryEntry(row))
      )
        await request(actor, characterPath, 'PATCH', {
          race: {
            selection: {
              raceId: base?.id ?? null,
              variantKey: variant?.key ?? null,
              lensIds: lenses.map((lens) => lens?.id),
              formKey: null,
            },
            snapshot: null,
          },
        });
    }

    for (const row of character.traits) {
      const source = (catalog.traits ?? []).find((entry) => entry.id === row.libraryTraitId);
      if (!source) continue;
      const previous = oldDescription('traits', source);
      const traitPatch: Record<string, unknown> = {};
      if (previous && row.notes === previous && source.description !== previous)
        traitPatch.notes = source.description;
      const was = old.traits.find((entry) => entry.name === row.name);
      const now = fixture.traits.find((entry) => entry.name === row.name);
      if (
        was &&
        now &&
        row.points === was.points &&
        (row.level ?? undefined) === was.level &&
        (now.points !== was.points || now.level !== was.level)
      ) {
        traitPatch.points = now.points;
        if (now.level !== undefined) traitPatch.level = now.level;
        traitPatch.pricingResolution = resolveLibraryPricing(
          pricingCatalog,
          definitionReference('traits', source as never),
          now.level !== undefined ? { level: Number(now.level) } : {},
        );
      }
      if (Object.keys(traitPatch).length)
        await request(actor, `${characterPath}/traits/${row.id}`, 'PATCH', traitPatch);
    }
    for (const entry of fixture.traits) {
      if (
        old.traits.some((row) => row.name === entry.name) ||
        character.traits.some((row) => row.name === entry.name)
      )
        continue;
      const source = selectable('traits', entry.name);
      if (!source) continue;
      await request(
        actor,
        `${characterPath}/traits`,
        'POST',
        traitCreate.parse({
          ...source,
          ...entry,
          notes: entry.notes ?? source.description,
          libraryTraitId: source.id,
          pricingResolution: resolveLibraryPricing(
            pricingCatalog,
            definitionReference('traits', source as never),
            entry.level !== undefined ? { level: Number(entry.level) } : {},
          ),
        }),
      );
    }

    for (const row of character.skills) {
      const source = skillsCatalog.find((entry) => entry.id === row.librarySkillId);
      const skillPatch: Record<string, unknown> = {};
      if (source) {
        const previous = baseline.library.skills?.[String(source.key)];
        if (previous) {
          const oldSource = librarySkillOut.parse({
            ...source,
            description: previous.description ?? source.description,
            specializationPolicy: previous.specializationPolicy ?? source.specializationPolicy,
          });
          const oldNotes = librarySkillCopyNotes(
            oldSource.source,
            resolveLibrarySkillSpecialization(oldSource, row.specialization),
          );
          const notes = librarySkillCopyNotes(
            source.source,
            resolveLibrarySkillSpecialization(source, row.specialization),
          );
          if (row.notes === oldNotes && notes !== oldNotes) skillPatch.notes = notes;
        }
      }
      const was = old.skills.find((entry) => identity(entry) === identity(row));
      const now = fixture.skills.find((entry) => identity(entry) === identity(row));
      if (was && now && row.points === was.points && now.points !== was.points)
        skillPatch.points = now.points;
      if (Object.keys(skillPatch).length)
        await request(actor, `${characterPath}/skills/${row.id}`, 'PATCH', skillPatch);
    }

    const purchases = [
      ['spells', 'librarySpellId', spellCreate, character.spells],
      ['techniques', 'libraryTechniqueId', techniqueCreate, character.techniques],
      ['languages', 'libraryLanguageId', languageCreate, character.languages],
    ] as const;
    for (const [section, link, schema, owned] of purchases) {
      const rows = owned as readonly { id: string; name: string; points: number }[];
      for (const row of rows) {
        const was = old[section].find((entry) => entry.name === row.name);
        const now = (fixture[section] as Purchase[]).find((entry) => entry.name === row.name);
        if (was && now && row.points === was.points && now.points !== was.points)
          await request(actor, `${characterPath}/${section}/${row.id}`, 'PATCH', {
            points: now.points,
          });
      }
      for (const entry of fixture[section] as (Purchase & Record<string, unknown>)[]) {
        if (
          old[section].some((row) => row.name === entry.name) ||
          rows.some((row) => row.name === entry.name)
        )
          continue;
        const source = selectable(section, entry.name);
        if (!source) continue;
        await request(
          actor,
          `${characterPath}/${section}`,
          'POST',
          (schema as z.ZodTypeAny).parse({ ...source, ...entry, [link]: source.id }),
        );
      }
    }

    for (const item of character.inventory) {
      const previous = baseline.inventoryNotes[item.name];
      const next = findSeedNotes(fixture.inventory, item.name);
      if (previous && item.notes === previous && next && next !== previous)
        await request(
          actor,
          `${characterPath}/inventory/${item.id}`,
          'PATCH',
          inventoryItemUpdate.parse({ notes: next }),
        );
    }
  }
}

function findSeedNotes(items: SeedCharacter['inventory'], name: string): string | undefined {
  for (const item of items) {
    if (item.name === name && typeof item.data?.notes === 'string') return item.data.notes;
    const nested = findSeedNotes(item.contents ?? [], name);
    if (nested) return nested;
  }
  return undefined;
}
