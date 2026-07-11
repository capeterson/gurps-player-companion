import { useLiveQuery } from 'dexie-react-hooks';
import { buildCharacterDetail } from '../../../shared/domain/characterDetail.ts';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { getLocalDb } from '../../db/dexie.ts';

export function useCampaignCharacterDetails(campaignId: string): CharacterDetail[] | undefined {
  return useLiveQuery(async () => {
    const db = getLocalDb();
    const [campaign, characters] = await Promise.all([
      db.campaigns.get(campaignId),
      db.characters.where('campaignId').equals(campaignId).toArray(),
    ]);
    if (characters.length === 0) return [];

    const ids = new Set(characters.map((character) => character.id));
    const [traits, skills, spells, inventory, combat] = await Promise.all([
      db.characterTraits.filter((row) => ids.has(row.characterId)).toArray(),
      db.characterSkills.filter((row) => ids.has(row.characterId)).toArray(),
      db.characterSpells.filter((row) => ids.has(row.characterId)).toArray(),
      db.characterInventory.filter((row) => ids.has(row.characterId)).toArray(),
      db.characterCombat.filter((row) => ids.has(row.characterId)).toArray(),
    ]);

    return characters
      .map((character) =>
        buildCharacterDetail({
          character,
          traits: traits.filter((row) => row.characterId === character.id),
          skills: skills.filter((row) => row.characterId === character.id),
          spells: spells.filter((row) => row.characterId === character.id),
          inventory: inventory.filter((row) => row.characterId === character.id),
          combat: combat.find((row) => row.characterId === character.id) ?? null,
          campaign: campaign
            ? {
                pointTarget: campaign.pointTarget,
                disadvantageCap: campaign.disadvantageCap,
                quirkCap: campaign.quirkCap,
                manaLevel: campaign.manaLevel ?? 'normal',
              }
            : null,
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [campaignId]);
}
