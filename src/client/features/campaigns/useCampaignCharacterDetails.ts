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

    const ids = new Set(characters.map((character) => character.id));
    const [traits, skills, spells, languages, techniques, inventory, combat] = await Promise.all([
      db.characterTraits.filter((row) => ids.has(row.characterId)).toArray(),
      db.characterSkills.filter((row) => ids.has(row.characterId)).toArray(),
      db.characterSpells.filter((row) => ids.has(row.characterId)).toArray(),
      db.characterLanguages.filter((row) => ids.has(row.characterId)).toArray(),
      db.characterTechniques.filter((row) => ids.has(row.characterId)).toArray(),
      db.characterInventory.filter((row) => ids.has(row.characterId)).toArray(),
      db.characterCombat.filter((row) => ids.has(row.characterId)).toArray(),
    ]);

    return characters
      .map((character) => {
        const joined = joinCharacterMechanics(
          campaignId,
          traits.filter((row) => row.characterId === character.id),
          skills.filter((row) => row.characterId === character.id),
        );
        const detail = buildCharacterDetail({
          character,
          traits: joined.traits,
          skills: joined.skills,
          spells: spells.filter((row) => row.characterId === character.id),
          languages: languages.filter((row) => row.characterId === character.id),
          techniques: techniques.filter((row) => row.characterId === character.id),
          inventory: inventory.filter((row) => row.characterId === character.id),
          combat: combat.find((row) => row.characterId === character.id) ?? null,
          campaign: campaign
            ? {
                pointTarget: campaign.pointTarget,
                disadvantageCap: campaign.disadvantageCap,
                quirkCap: campaign.quirkCap,
                manaLevel: campaign.manaLevel ?? 'normal',
                techLevel: campaign.techLevel ?? null,
              }
            : null,
        });
        return { ...detail, libraryEffectsKnown: joined.libraryEffectsKnown };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [campaignId]);
}
