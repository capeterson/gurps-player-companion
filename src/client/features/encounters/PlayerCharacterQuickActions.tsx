import { COMMON_CONDITIONS } from '../../../shared/constants/combat.ts';
import { conditionLabel, conditionsInclude } from '../../../shared/domain/conditions.ts';
import { useCombatPatch } from '../characters/sections/useCombatPatch.ts';
import { useConditionsToggle } from '../characters/sections/useConditionsToggle.ts';
import { usePoolBumpers } from '../characters/sections/usePoolBumpers.ts';
import { useCharacterAccessLocal } from '../characters/useCharacterAccess.ts';
import { useCharacterDetail } from '../characters/useCharacterDetail.ts';

/**
 * An encounter is a read-only projection for players. Their own sheet state
 * remains the source of truth, so these controls deliberately use the normal
 * character-combat outbox path instead of mutating the encounter projection.
 */
export function PlayerCharacterQuickActions({
  characterId,
  meId,
}: {
  characterId: string | null;
  meId: string | undefined;
}) {
  const character = useCharacterDetail(characterId ?? undefined);
  const access = useCharacterAccessLocal(character, meId);
  if (!character || !access.isOwner || !access.canWrite || access.isMinimal) return null;
  return <OwnCharacterQuickActions character={character} />;
}

function OwnCharacterQuickActions({
  character,
}: {
  character: NonNullable<ReturnType<typeof useCharacterDetail>>;
}) {
  const patchCombat = useCombatPatch(character);
  const bumpers = usePoolBumpers(character, true, patchCombat);
  const { conditions, toggle } = useConditionsToggle(character, true, patchCombat);
  return (
    <div className="mt-2 space-y-2 border-t border-base-300 pt-2">
      <p className="label-eyebrow">Your sheet</p>
      <div className="flex flex-wrap gap-1">
        <button type="button" className="btn btn-xs" onClick={() => bumpers.bumpHp(-1)}>
          HP -1
        </button>
        <button type="button" className="btn btn-xs" onClick={() => bumpers.bumpHp(1)}>
          HP +1
        </button>
        <button type="button" className="btn btn-xs" onClick={() => bumpers.bumpFp(-1)}>
          FP -1
        </button>
        <button type="button" className="btn btn-xs" onClick={() => bumpers.bumpFp(1)}>
          FP +1
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {COMMON_CONDITIONS.map((condition) => (
          <button
            key={condition}
            type="button"
            className={`btn btn-xs ${conditionsInclude(conditions, condition) ? 'btn-primary' : ''}`}
            onClick={() => toggle(condition)}
          >
            {conditionLabel(condition)}
          </button>
        ))}
      </div>
    </div>
  );
}
