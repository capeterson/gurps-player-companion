import {
  type ActiveEffectInstance,
  activeEffectsField,
} from '../../../../shared/schemas/activeEffects.ts';
import { getLocalDb } from '../../../db/dexie.ts';
import { campaignTransferStores } from '../../../sync/localCampaignTransfer.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';
export async function mutateActiveEffects(
  characterId: string,
  label: string,
  update: (entries: ActiveEffectInstance[]) => ActiveEffectInstance[],
) {
  const db = getLocalDb();
  await db.transaction('rw', [db.characters, db.outbox, ...campaignTransferStores()], async () => {
    const row = await db.characters.get(characterId);
    if (!row) throw new Error('Character no longer exists');
    const next = activeEffectsField.parse(update(row.activeEffects ?? []));
    if (JSON.stringify(next) === JSON.stringify(row.activeEffects ?? [])) return;
    await enqueueFieldPatch({
      entityClass: 'character',
      entityId: characterId,
      fieldPath: 'activeEffects',
      attemptedValue: next,
      humanName: label,
    });
  });
}
