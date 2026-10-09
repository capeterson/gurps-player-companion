/** Once-only equipment enrichment through the same API transport as the seed.
 * V2 is a public synthetic baseline: customized facets and deleted old purchases
 * are preserved. Callers own the transaction and completion revision marker.
 */
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  canPlayerSelectLibraryEntry,
  canonicalLibraryKey,
  libraryEntryKey,
} from '../../../shared/domain/libraryIdentity.ts';
import {
  definitionReference,
  resolveLibraryPricing,
} from '../../../shared/domain/libraryPricing.ts';
import { normalizeWeaponData } from '../../../shared/domain/weaponModes.ts';
import {
  libraryEnchantmentOut,
  libraryItemCreate,
  libraryItemOut,
  libraryItemUpdate,
} from '../../../shared/schemas/campaignLibrary.ts';
import { characterDetail } from '../../../shared/schemas/character.ts';
import {
  armorData,
  inventoryItemCreate,
  inventoryItemUpdate,
} from '../../../shared/schemas/inventory.ts';
import { libraryModifierOut, librarySourceOut } from '../../../shared/schemas/libraryMetadata.ts';
import { emitLibraryYaml, parseLibraryYaml } from '../../../shared/yaml/library.ts';
import {
  exportSourceReferences,
  importSourceReferences,
  portableLibraryEntry,
  sourceExportKeys,
  sourceImportIdentity,
} from '../../../shared/yaml/sourceReferences.ts';
import type { LanternRequest } from './lanternCoastContent.ts';
import { LANTERN_ITEM_POWER, type SeedCharacter } from './lanternCoastData.ts';

type Player = { fixture: SeedCharacter; actor: string; characterId: string };
const clean = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));
const same = (a: unknown, b: unknown) => isDeepStrictEqual(clean(a), clean(b));
const normalizedArmor = (value: unknown) => (value == null ? null : armorData.parse(value));

export async function refreshLanternCoastEquipment({
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
    await readFile(new URL('./lanternCoastEquipmentV2.json', import.meta.url), 'utf8'),
  ) as {
    items: unknown[];
    characters: { name: string; inventory: SeedCharacter['inventory'] }[];
  };
  const original = portableLibraryEntry(libraryItemCreate).array().parse(baseline.items);
  const readCatalog = async () => {
    const result = (await request(ownerActor, `${path}/library`, 'GET')) as Record<string, unknown>;
    return {
      items: libraryItemOut.array().parse(result.items),
      modifiers: libraryModifierOut.array().parse(result.modifiers),
      sources: librarySourceOut.array().parse(result.sources),
      enchantments: libraryEnchantmentOut.array().parse(result.enchantments),
      traits: [] as never[],
    };
  };
  let catalog = await readCatalog();
  const aliases = new Map<string, string>();
  for (const source of document.library.sources ?? []) {
    const matches = catalog.sources.filter(
      (book) => sourceImportIdentity(book) === sourceImportIdentity(source),
    );
    const linked = new Set(
      catalog.items
        .filter((row) =>
          original.some(
            (old) =>
              old.sourceKey === source.key &&
              row.name === old.name &&
              canonicalLibraryKey(row.key ?? row.name) === canonicalLibraryKey(old.key ?? old.name),
          ),
        )
        .flatMap((row) => row.sourceId ?? []),
    );
    const id =
      matches.length === 1 ? matches[0]?.id : linked.size === 1 ? [...linked][0] : undefined;
    if (id && catalog.sources.some((book) => book.id === id))
      aliases.set(canonicalLibraryKey(source.key), id);
  }
  const resolve = (items: typeof original) =>
    libraryItemCreate.array().parse(
      (
        importSourceReferences(
          {
            items: items.filter(
              (item) => !item.sourceKey || aliases.has(canonicalLibraryKey(item.sourceKey)),
            ),
            sources: document.library.sources?.filter((book) =>
              aliases.has(canonicalLibraryKey(book.key)),
            ),
          },
          catalog.sources,
          aliases,
        ) as { items: unknown }
      ).items,
    );
  const old = resolve(original);
  const authored = resolve(document.library.items);
  const additions = authored.filter(
    (item) =>
      !old.some((entry) => libraryEntryKey(entry) === libraryEntryKey(item)) &&
      !catalog.items.some(
        (entry) => entry.name === item.name || libraryEntryKey(entry) === libraryEntryKey(item),
      ),
  );
  if (additions.length) {
    const keys = sourceExportKeys(catalog.sources);
    await request(ownerActor, `${path}/library/import`, 'POST', {
      mode: 'merge',
      applyCampaignSettings: false,
      yaml: emitLibraryYaml({
        sources: catalog.sources
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
        items: exportSourceReferences(additions, catalog.sources) as typeof original,
        traits: [],
        skills: [],
        spells: [],
        languages: [],
        techniques: [],
        styles: [],
      }),
    });
  }
  for (const previous of old) {
    const matches = catalog.items.filter(
      (item) => libraryEntryKey(item) === libraryEntryKey(previous),
    );
    const next = authored.find((item) => libraryEntryKey(item) === libraryEntryKey(previous));
    if (matches.length !== 1 || !next) continue;
    const current = matches[0];
    if (!current) continue;
    const patch: Record<string, unknown> = {};
    if (
      same(normalizedArmor(current.armor), normalizedArmor(previous.armor)) &&
      !same(normalizedArmor(current.armor), normalizedArmor(next.armor))
    )
      patch.armor = next.armor;
    if (
      same(normalizeWeaponData(current.weaponData), normalizeWeaponData(previous.weaponData)) &&
      !same(normalizeWeaponData(current.weaponData), normalizeWeaponData(next.weaponData))
    )
      patch.weaponData = next.weaponData;
    if (
      same(current.description, previous.description) &&
      !same(current.description, next.description)
    )
      patch.description = next.description;
    if (Object.keys(patch).length)
      await request(
        ownerActor,
        `${path}/library/items/${current.id}`,
        'PATCH',
        libraryItemUpdate.parse(patch),
      );
  }
  catalog = await readCatalog();
  const enchantments = catalog.enchantments;
  let addedPurchases = 0;
  for (const { fixture, actor, characterId } of players) {
    const character = characterDetail.parse(
      await request(actor, `/characters/${characterId}`, 'GET'),
    );
    const oldFixture = baseline.characters.find((entry) => entry.name === fixture.character.name);
    if (!oldFixture) throw new Error(`Missing equipment baseline: ${fixture.character.name}`);
    for (const item of fixture.inventory.filter((entry) => entry.library)) {
      const definition = authored.find((entry) => entry.name === item.library);
      if (!definition) continue;
      const sources = catalog.items.filter(
        (entry) => libraryEntryKey(entry) === libraryEntryKey(definition),
      );
      if (
        sources.length !== 1 ||
        !sources[0] ||
        sources[0].name !== definition.name ||
        !canPlayerSelectLibraryEntry(sources[0])
      )
        continue;
      const source = sources[0];
      const previous = oldFixture.inventory.find((entry) => entry.name === item.name);
      const held = character.inventory.filter((entry) => entry.name === item.name);
      if (!previous) {
        if (held.length) continue;
        await request(
          actor,
          `/characters/${characterId}/inventory`,
          'POST',
          inventoryItemCreate.parse({
            ...source,
            ...item.data,
            name: item.name,
            libraryItemId: source.id,
            pricingResolution: resolveLibraryPricing(
              catalog,
              definitionReference('items', source),
              {},
            ),
            enchantments:
              item.enchantments?.map((name) => {
                const enchantment = enchantments.find((entry) => entry.name === name);
                if (!enchantment) throw new Error(`Missing equipment enchantment: ${name}`);
                return {
                  spellName: name,
                  spellLevel: LANTERN_ITEM_POWER,
                  definitionId: enchantment.id,
                };
              }) ?? [],
          }),
        );
        addedPurchases++;
        continue;
      }
      if (held.length !== 1 || !held[0] || held[0].libraryItemId !== source.id) continue;
      const row = held[0];
      const legacy = old.find((entry) => entry.name === previous.library);
      if (!legacy) continue;
      const patch: Record<string, unknown> = {};
      const oldEnchantments = previous.enchantments ?? [];
      if (row.enchantments.length === oldEnchantments.length && oldEnchantments.length) {
        const upgraded = row.enchantments.map((ref) => {
          const definition = enchantments.find(
            (entry) => entry.id === ref.definitionId && entry.name === ref.spellName,
          );
          return definition &&
            oldEnchantments.includes(ref.spellName) &&
            ref.spellLevel == null &&
            ref.level == null &&
            !ref.category &&
            !ref.notes
            ? { ...ref, spellLevel: LANTERN_ITEM_POWER }
            : ref;
        });
        if (!same(upgraded, row.enchantments)) patch.enchantments = upgraded;
      }
      const oldArmor = normalizedArmor(previous.data?.armor ?? legacy.armor);
      if (same(row.baseArmor, oldArmor) && !same(row.baseArmor, source.armor))
        patch.armor = source.armor;
      const oldWeapon = normalizeWeaponData(
        (previous.data?.weaponData as Parameters<typeof normalizeWeaponData>[0]) ??
          legacy.weaponData,
      );
      if (
        same(normalizeWeaponData(row.baseWeaponData), oldWeapon) &&
        !same(normalizeWeaponData(row.baseWeaponData), normalizeWeaponData(source.weaponData))
      )
        patch.weaponData = source.weaponData;
      // Readiness changes are compared to the original fixture, never forced.
      for (const field of ['equipped', 'worn', 'notes'] as const) {
        const next = item.data?.[field];
        const prior = previous.data?.[field] ?? (field === 'notes' ? null : false);
        if (next !== undefined && same(row[field], prior) && !same(row[field], next))
          patch[field] = next;
      }
      if (Object.keys(patch).length)
        await request(
          actor,
          `/characters/${characterId}/inventory/${row.id}`,
          'PATCH',
          inventoryItemUpdate.parse(patch),
        );
    }
  }
  return { addedDefinitions: additions.length, addedPurchases };
}
