import { useLiveQuery } from 'dexie-react-hooks';
import { sortLoadouts } from '../../../../../shared/domain/loadouts.ts';
import { type EquipmentSwitch, equipmentSwitch } from '../../../../../shared/schemas/loadout.ts';
import { type LocalCharacterLoadout, getLocalDb } from '../../../../db/dexie.ts';

export interface CharacterLoadouts {
  readonly loadouts: LocalCharacterLoadout[];
  readonly lastSwitch: EquipmentSwitch | null;
}

const EMPTY: CharacterLoadouts = { loadouts: [], lastSwitch: null };

/** A character's loadouts in menu order and its Last Equipped record (Dexie). */
export function useCharacterLoadouts(characterId: string): CharacterLoadouts {
  return (
    useLiveQuery(async () => {
      const db = getLocalDb();
      const [loadouts, character] = await Promise.all([
        db.characterLoadouts.where('characterId').equals(characterId).toArray(),
        db.characters.get(characterId),
      ]);
      return {
        loadouts: sortLoadouts(loadouts),
        lastSwitch: equipmentSwitch
          .nullable()
          .catch(null)
          .parse(character?.lastEquipmentSwitch ?? null),
      };
    }, [characterId]) ?? EMPTY
  );
}
