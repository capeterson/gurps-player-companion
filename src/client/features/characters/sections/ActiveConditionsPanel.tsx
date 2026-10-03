import { distinctConditionGroups } from '../../../../shared/domain/traitEffects.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { FoldSection } from '../../../components/ui/FoldSection.tsx';
import { StatCard } from '../../../components/ui/StatCard.tsx';
import { getLocalDb } from '../../../db/dexie.ts';
import { useExperimentalActiveEffects } from '../../../hooks/useExperimentalActiveEffects.ts';
import { useFlashState } from '../../../hooks/useFlashState.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { campaignTransferStores } from '../../../sync/localCampaignTransfer.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';

export function ActiveConditionsPanel({
  character,
  canWrite,
  foldable = false,
}: { character: CharacterDetail; canWrite: boolean; foldable?: boolean }) {
  const enabled = useExperimentalActiveEffects(character.campaignId);
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
        [db.campaigns, db.characters, db.outbox, ...campaignTransferStores()],
        async () => {
          const row = await db.characters.get(character.id);
          if (!row) throw new Error('Character no longer exists');
          if (
            !row.campaignId ||
            (await db.campaigns.get(row.campaignId))?.experimentalActiveEffects !== true
          )
            throw new Error('Active effects are disabled for this campaign');
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
  if (!enabled || !groups.length) return null;
  const content = (
    <>
      <div className="space-y-2">
        {groups.map((g) => (
          <label key={g.group} className="flex min-h-11 items-center justify-between gap-3">
            <span className="min-w-0 break-words">{g.label}</span>
            <input
              type="checkbox"
              className="checkbox checkbox-sm shrink-0"
              checked={character.activeConditionGroups.includes(g.group)}
              disabled={!canWrite}
              onChange={(e) => void toggle(g.group, e.target.checked)}
            />
          </label>
        ))}
      </div>
    </>
  );
  return (
    <div className="field-rollback-flash" {...flash.flashProps}>
      {foldable ? (
        <FoldSection
          preferenceKey={`${character.id}:ActiveConditionsPanel`}
          title="Conditional effects"
        >
          {content}
        </FoldSection>
      ) : (
        <StatCard title="Active Conditions">{content}</StatCard>
      )}
    </div>
  );
}
