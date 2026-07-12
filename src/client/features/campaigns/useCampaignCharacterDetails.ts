import { useLiveQuery } from 'dexie-react-hooks';
import { buildCharacterDetail } from '../../../shared/domain/characterDetail.ts';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { useLibraryEffectMaps } from '../characters/useLibraryEffectMaps.ts';

export function useCampaignCharacterDetails(campaignId: string): CharacterDetail[] | undefined {
  // Join trait/skill effect declarations the same way the character
  // sheet does (useCharacterDetail) so the dashboard's derived stats —
  // effective attributes, HP/FP maxima, Dodge — agree with what the
  // player sees on their own sheet.
  const { libraryTraitEffects, librarySkillEffects } = useLibraryEffectMaps(campaignId);

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
          traits: traits
            .filter((row) => row.characterId === character.id)
            .map((row) => ({
              ...row,
              libraryEffects:
                row.libraryTraitId && libraryTraitEffects.has(row.libraryTraitId)
                  ? [...(libraryTraitEffects.get(row.libraryTraitId) ?? [])]
                  : [],
            })),
          skills: skills
            .filter((row) => row.characterId === character.id)
            .map((row) => ({
              ...row,
              libraryEffects:
                row.librarySkillId && librarySkillEffects.has(row.librarySkillId)
                  ? [...(librarySkillEffects.get(row.librarySkillId) ?? [])]
                  : [],
            })),
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
    // Maps are memoized on the library query's data (useLibraryEffectMaps),
    // so these deps re-run the live query exactly when the payload changes.
  }, [campaignId, libraryTraitEffects, librarySkillEffects]);
}
