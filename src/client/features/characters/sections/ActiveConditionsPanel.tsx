import { distinctConditionGroups } from '../../../../shared/domain/traitEffects.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { StatCard } from '../../../components/ui/StatCard.tsx';
import { getLocalDb } from '../../../db/dexie.ts';
import { useFlashState } from '../../../hooks/useFlashState.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { campaignTransferStores } from '../../../sync/localCampaignTransfer.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';

export function ActiveConditionsPanel({
  character,
  canWrite,
}: { character: CharacterDetail; canWrite: boolean }) {
  const groups = distinctConditionGroups([
    ...character.effects,
    ...(character.activeEffects ?? []).flatMap((e) =>
      [...e.effects, ...e.capabilities].map((c) => ({
        ...c,
        active: !!c.conditionGroup && character.activeConditionGroups.includes(c.conditionGroup),
      })),
    ),
  ]);
  const flash = useFlashState(`character:${character.id}:activeConditionGroups`);
  const { push } = useToasts();
  async function toggle(group: string, on: boolean) {
    try {
      const db = getLocalDb();
      await db.transaction(
        'rw',
        [db.characters, db.outbox, ...campaignTransferStores()],
        async () => {
          const row = await db.characters.get(character.id);
          if (!row) throw new Error('Character no longer exists');
          const values = new Set(row.activeConditionGroups);
          if (on) values.add(group);
          else values.delete(group);
          await enqueueFieldPatch({
            entityClass: 'character',
            entityId: character.id,
            fieldPath: 'activeConditionGroups',
            attemptedValue: [...values],
            humanName: `Condition ${group}`,
          });
        },
      );
    } catch (e) {
      push(`Couldn't save condition ${group} — ${(e as Error).message}`, { kind: 'error' });
      flash.trigger();
    }
  }
  if (!groups.length) return null;
  return (
    <StatCard title="Active Conditions">
      <div className="field-rollback-flash space-y-2" {...flash.flashProps}>
        {groups.map((g) => (
          <label key={g.group} className="flex justify-between gap-3">
            <span>{g.label}</span>
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={character.activeConditionGroups.includes(g.group)}
              disabled={!canWrite}
              onChange={(e) => void toggle(g.group, e.target.checked)}
            />
          </label>
        ))}
      </div>
    </StatCard>
  );
}
