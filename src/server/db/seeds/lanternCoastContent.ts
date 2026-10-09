/** Shared synthetic campaign recipe. Domain writes belong to the supplied API transport. */
import { z } from 'zod';
import { instantiateEffect } from '../../../shared/domain/activeEffects.ts';
import {
  definitionReference,
  resolveLibraryPricing,
} from '../../../shared/domain/libraryPricing.ts';
import { activeEffectDefinitionOut } from '../../../shared/schemas/activeEffects.ts';
import { libraryItemOut, libraryTraitOut } from '../../../shared/schemas/campaignLibrary.ts';
import { encounterOut } from '../../../shared/schemas/encounter.ts';
import { inventoryItemCreate } from '../../../shared/schemas/inventory.ts';
import { languageCreate } from '../../../shared/schemas/language.ts';
import { libraryModifierOut } from '../../../shared/schemas/libraryMetadata.ts';
import { skillCreate } from '../../../shared/schemas/skill.ts';
import { spellCreate } from '../../../shared/schemas/spell.ts';
import { techniqueCreate } from '../../../shared/schemas/technique.ts';
import { traitCreate } from '../../../shared/schemas/trait.ts';
import { parseLibraryYaml } from '../../../shared/yaml/library.ts';
import {
  LANTERN_ITEM_POWER,
  type SeedCharacter,
  type SeedItem,
  lanternCharacters,
  lanternSharedLogs,
} from './lanternCoastData.ts';

export const LANTERN_CAMPAIGN_NAME = 'The Lantern Coast';
const childSchemas = {
  traits: traitCreate,
  skills: skillCreate,
  spells: spellCreate,
  languages: languageCreate,
  techniques: techniqueCreate,
};
const identified = z.object({ id: z.string().uuid() });
const libraryResponse = z.record(z.array(identified.extend({ name: z.string() }).passthrough()));
export type LanternRequest = (
  actor: string,
  path: string,
  method?: string,
  body?: unknown,
) => Promise<unknown>;

/** The REST script supplies six players; MCP acceptance supplies one existing owner.
 * All campaign content, including owned pricing/mechanics, comes from this recipe.
 * nextEffectId identifies JSON effect instances only; row IDs come from API creates.
 */
export async function populateLanternCoast({
  yaml,
  request,
  ownerActor,
  playerFor,
  nextEffectId,
}: {
  yaml: string;
  request: LanternRequest;
  ownerActor: string;
  playerFor: (fixture: SeedCharacter, campaignPath: string) => Promise<string>;
  nextEffectId: () => Promise<string>;
}) {
  const document = parseLibraryYaml(yaml);
  const campaign = identified.parse(
    await request(ownerActor, '/campaigns', 'POST', {
      ...document.campaign,
      name: LANTERN_CAMPAIGN_NAME,
      shareCharacterSheets: true,
      experimentalTurnTracker: true,
      // Author the retained demonstrations through the normal guarded API.
      experimentalActiveEffects: true,
      allowGmCharacterEditing: false,
    }),
  );
  const campaignPath = `/campaigns/${campaign.id}`;
  await request(ownerActor, `${campaignPath}/library/import`, 'POST', { yaml, mode: 'merge' });
  const library = libraryResponse.parse(
    await request(ownerActor, `${campaignPath}/library`, 'GET'),
  );
  const catalog = {
    traits: libraryTraitOut.array().parse(library.traits),
    items: libraryItemOut.array().parse(library.items),
    modifiers: libraryModifierOut.array().parse(library.modifiers),
  };
  const pricing = (section: 'traits' | 'items', name: string, level?: unknown) => {
    const source = catalog[section].find((entry) => entry.name === name);
    if (!source) throw new Error(`Missing Lantern pricing ${section}: ${name}`);
    return resolveLibraryPricing(
      catalog,
      definitionReference(section, source),
      section === 'traits' && 'pointsPerLevel' in source && source.pointsPerLevel != null
        ? { level: Number(level ?? 1) }
        : {},
    );
  };
  const definition = (section: string, name: string) => {
    const found = library[section]?.find((entry) => entry.name === name);
    if (!found) throw new Error(`Missing Lantern fixture ${section}: ${name}`);
    return found;
  };
  const characterIds: string[] = [];
  for (const fixture of lanternCharacters) {
    const token = await playerFor(fixture, campaignPath);
    const character = identified.parse(
      await request(token, '/characters', 'POST', {
        ...fixture.character,
        campaignId: campaign.id,
      }),
    );
    characterIds.push(character.id);
    const path = `/characters/${character.id}`;
    for (const [section, link] of [
      ['traits', 'libraryTraitId'],
      ['skills', 'librarySkillId'],
      ['spells', 'librarySpellId'],
      ['languages', 'libraryLanguageId'],
      ['techniques', 'libraryTechniqueId'],
    ] as const) {
      for (const entry of fixture[section]) {
        const source = definition(section, entry.name);
        await request(
          token,
          `${path}/${section}`,
          'POST',
          childSchemas[section].parse({
            ...source,
            ...entry,
            [link]: source.id,
            ...(section === 'traits'
              ? {
                  notes: entry.notes ?? source.description,
                  pricingResolution: pricing('traits', entry.name, entry.level),
                }
              : {}),
          }),
        );
      }
    }
    const itemIds = new Map<string, string>();
    const addItem = async (item: SeedItem, parentId?: string): Promise<void> => {
      const source = item.library ? definition('items', item.library) : undefined;
      const payload = {
        ...source,
        ...item.data,
        name: item.name,
        ...(source
          ? { libraryItemId: source.id, pricingResolution: pricing('items', source.name) }
          : {}),
        ...(parentId ? { parentId } : {}),
        enchantments:
          item.enchantments?.map((name) => ({
            spellLevel: LANTERN_ITEM_POWER,
            spellName: name,
            definitionId: definition('enchantments', name).id,
          })) ?? [],
      };
      const saved = z
        .object({ item: identified })
        .parse(
          await request(token, `${path}/inventory`, 'POST', inventoryItemCreate.parse(payload)),
        );
      itemIds.set(item.name, saved.item.id);
      for (const child of item.contents ?? []) await addItem(child, saved.item.id);
    };
    for (const item of fixture.inventory) await addItem(item);
    const effects = [];
    for (const entry of fixture.effects) {
      const source = activeEffectDefinitionOut.parse(definition('activeEffects', entry.name));
      const id = await nextEffectId();
      const sourceInventoryId = entry.sourceItem ? itemIds.get(entry.sourceItem) : null;
      if (sourceInventoryId === undefined)
        throw new Error(`Missing effect source item: ${entry.sourceItem}`);
      effects.push({
        ...instantiateEffect(source, id, '2026-09-18T18:00:00.000Z'),
        definitionId: source.id,
        sourceRevision: source.revision,
        sourceCampaignId: campaign.id,
        state: entry.state,
        ...(entry.state === 'expired' ? { remainingRounds: 0 } : {}),
        sourceInventoryId,
        notes:
          'Seeded play-state example; advance rounds or toggle state to exercise the effect lifecycle.',
      });
    }
    await request(token, path, 'PATCH', { activeEffects: effects });
    await request(token, `${path}/combat`, 'PATCH', fixture.combat);
    // Real multi-actor, private content for permission and history testing.
    for (const { key: _key, ...entry } of fixture.privateLogs) {
      await request(token, `${campaignPath}/log`, 'POST', {
        ...entry,
        visibility: 'private',
        characterId: character.id,
      });
    }
  }
  for (const { key: _key, awardPerCharacter, ...entry } of lanternSharedLogs) {
    await request(ownerActor, `${campaignPath}/log`, 'POST', {
      ...entry,
      visibility: 'campaign',
      ...(awardPerCharacter !== undefined
        ? {
            xpAwards: characterIds.map((characterId) => ({
              characterId,
              amount: awardPerCharacter,
            })),
          }
        : {}),
    });
  }
  const encounter = encounterOut.parse(
    await request(ownerActor, `${campaignPath}/encounters`, 'POST', {
      name: 'The tide-gate ambush',
      combatants: [
        ...characterIds.map((characterId) => ({ kind: 'pc', characterId })),
        {
          kind: 'npc',
          name: 'Tide-cave raider',
          basicSpeed: 5.5,
          dx: 11,
          maxHp: 12,
          currentHp: 8,
          move: 5,
          dodge: 8,
          dr: 2,
          maneuver: 'Attack',
        },
        {
          kind: 'npc',
          name: 'Hidden lantern keeper',
          basicSpeed: 5,
          dx: 10,
          maxHp: 10,
          hiddenFromPlayers: true,
          notes: 'Fen is a captive, not an enemy. Reveal after the gate opens.',
        },
      ],
    }),
  );
  const target = encounter.combatants.find((entry) => entry.characterId === characterIds[0]);
  const caster = encounter.combatants.find((entry) => entry.characterId === characterIds[1]);
  if (!target || !caster) throw new Error('Seed encounter is missing PCs');
  await request(ownerActor, `${campaignPath}/encounters/${encounter.id}/effects`, 'POST', {
    name: 'Guiding lantern',
    targetCombatantId: target.id,
    casterCombatantId: caster.id,
    duration: { unit: 'rounds', amount: 3 },
    maintenanceCost: 1,
    notes: 'Tracker-only reminder; intentionally not linked to an automatic sheet bonus.',
  });
  // Finished demo campaigns follow the same off-by-default active-effects policy.
  await request(ownerActor, campaignPath, 'PATCH', { experimentalActiveEffects: false });
  return { campaignId: campaign.id, characterIds };
}
