/**
 * CombatTab — the live-gameplay surface, rendered as the first tab on
 * the character sheet. Pools, maneuver, defenses, attacks, skills, and
 * a session roll log, all inline on `/characters/:id` so the player
 * taps between live combat and the editable sheet without a route hop.
 *
 * `usePoolBumpers` is lifted here so the in-grid PoolsCard and the
 * sticky mobile bottom bar share one instance — a second instance would
 * race the first and silently drop a rapid tap (AGENTS.md S3/S10).
 */

import { useState } from 'react';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { RollHistoryStrip } from '../RollHistoryStrip.tsx';
import { RollSheet } from '../RollSheet.tsx';
import { hpVarFor } from '../hpColor.ts';
import type { RollRequest } from '../rollTypes.ts';
import { useCombatPatch } from '../useCombatPatch.ts';
import { usePoolBumpers } from '../usePoolBumpers.ts';
import { AttacksCard } from './AttacksCard.tsx';
import { DefensesCard } from './DefensesCard.tsx';
import { ManeuverCard } from './ManeuverCard.tsx';
import { PoolsCard } from './PoolsCard.tsx';
import { SkillsCard } from './SkillsCard.tsx';

export interface CombatTabProps {
  character: CharacterDetail;
  canWrite: boolean;
}

export function CombatTab({ character, canWrite }: CombatTabProps) {
  const [rollRequest, setRollRequest] = useState<RollRequest | null>(null);
  const patchCombat = useCombatPatch(character);
  const bumpers = usePoolBumpers(character, canWrite, patchCombat);

  const hpRatio = bumpers.hpMax > 0 ? bumpers.hp / bumpers.hpMax : 0;
  const hpColor = hpVarFor(hpRatio);

  function openRoll(req: RollRequest) {
    setRollRequest(req);
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PoolsCard
          character={character}
          canWrite={canWrite}
          patchCombat={patchCombat}
          bumpers={bumpers}
        />
        <ManeuverCard character={character} canWrite={canWrite} patchCombat={patchCombat} />
        <DefensesCard character={character} openRoll={openRoll} />
        <AttacksCard character={character} openRoll={openRoll} />
        <SkillsCard character={character} canWrite={canWrite} openRoll={openRoll} />
        <div className="md:col-span-2 xl:col-span-3">
          <RollHistoryStrip characterId={character.id} />
        </div>
      </div>

      {/* Sticky bottom bar, mobile only. Shares the SAME usePoolBumpers
          instance as PoolsCard (lifted above) — a second instance here
          would race the first and silently drop a rapid tap. */}
      <div className="combat-bottom-bar md:hidden">
        <span className="num text-2xl font-bold" style={{ color: hpColor }}>
          {bumpers.hp}
        </span>
        <span className="num text-xs text-dim">/ {bumpers.hpMax}</span>
        {canWrite && (
          <div className="ml-auto flex gap-1.5">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => bumpers.bumpHp(-1)}
              aria-label="HP -1"
            >
              HP −1
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => bumpers.bumpHp(+1)}
              aria-label="HP +1"
            >
              HP +1
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => bumpers.bumpFp(-1)}
              aria-label="FP -1"
            >
              FP −1
            </button>
          </div>
        )}
      </div>

      {rollRequest && (
        <RollSheet
          request={rollRequest}
          characterId={character.id}
          onClose={() => setRollRequest(null)}
        />
      )}
    </div>
  );
}
