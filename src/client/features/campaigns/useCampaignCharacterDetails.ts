import { useLiveQuery } from 'dexie-react-hooks';
import { buildCharacterDetail } from '../../../shared/domain/characterDetail.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { joinCharacterMechanics } from '../characters/joinCharacterMechanics.ts';
import type { EffectAwareCharacterDetail } from '../characters/useCharacterDetail.ts';

export function useCampaignCharacterDetails(
  campaignId: string,
): EffectAwareCharacterDetail[] | undefined {
  // Join trait/skill effect declarations the same way the character
  // sheet does (useCharacterDetail) so the dashboard's derived stats —
  // effective attributes, HP/FP maxima, Dodge — agree with what the
  // player sees on their own sheet.

  return useLiveQuery(async () => {
    const db = getLocalDb();
    const [campaign, characters] = await Promise.all([
      db.campaigns.get(campaignId),
      db.characters.where('campaignId').equals(campaignId).toArray(),
    ]);
    if (characters.length === 0) return [];

    const ids = characters.map((character) => character.id);
    const [traits, skills, spells, languages, techniques, inventory, combat] = await Promise.all([
      db.characterTraits.where('characterId').anyOf(ids).toArray(),
      db.characterSkills.where('characterId').anyOf(ids).toArray(),
      db.characterSpells.where('characterId').anyOf(ids).toArray(),
      db.characterLanguages.where('characterId').anyOf(ids).toArray(),
      db.characterTechniques.where('characterId').anyOf(ids).toArray(),
      db.characterInventory.where('characterId').anyOf(ids).toArray(),
      db.characterCombat.bulkGet(ids),
    ]);
    const traitsBy = groupByCharacter(traits);
    const skillsBy = groupByCharacter(skills);
    const spellsBy = groupByCharacter(spells);
    const languagesBy = groupByCharacter(languages);
    const techniquesBy = groupByCharacter(techniques);
    const inventoryBy = groupByCharacter(inventory);

    return characters
      .map((character, index) => {
        const joined = joinCharacterMechanics(
          campaignId,
          traitsBy.get(character.id) ?? [],
          skillsBy.get(character.id) ?? [],
        );
        const detail = buildCharacterDetail({
          character,
          traits: joined.traits,
          skills: joined.skills,
          spells: spellsBy.get(character.id) ?? [],
          languages: languagesBy.get(character.id) ?? [],
          techniques: techniquesBy.get(character.id) ?? [],
          inventory: inventoryBy.get(character.id) ?? [],
          combat: combat[index] ?? null,
          campaign: campaign
            ? {
                pointTarget: campaign.pointTarget,
                disadvantageCap: campaign.disadvantageCap,
                quirkCap: campaign.quirkCap,
                manaLevel: campaign.manaLevel ?? 'normal',
                ...(campaign.houseRules ? { houseRules: campaign.houseRules } : {}),
                techLevel: campaign.techLevel ?? null,
              }
            : null,
        });
        return { ...detail, libraryEffectsKnown: joined.libraryEffectsKnown };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [campaignId]);
}

function groupByCharacter<T extends { characterId: string }>(rows: readonly T[]): Map<string, T[]> {
  const byCharacter = new Map<string, T[]>();
  for (const row of rows) {
    const group = byCharacter.get(row.characterId);
    if (group) group.push(row);
    else byCharacter.set(row.characterId, [row]);
  }
  return byCharacter;
}
