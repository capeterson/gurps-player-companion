/**
 * Combat tab — HP/FP pools, posture, and conditions.
 *
 * Shares ONE `usePoolBumpers` instance with the Combat tab's floating top
 * bar (lifted to CombatTab) so rapid changes across both UIs
 * share soft-cap override state instead of a second
 * instance tracking its own override window. Pool writes compose in Dexie.
 */

import { useState } from 'react';
import { COMMON_CONDITIONS, POSTURES } from '../../../../../shared/constants/combat.ts';
import { conditionLabel, conditionsInclude } from '../../../../../shared/domain/conditions.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { ConditionChip } from '../../../../components/ui/ConditionChip.tsx';
import { FoldSection } from '../../../../components/ui/FoldSection.tsx';
import { InfoTooltip } from '../../../../components/ui/InfoTooltip.tsx';
import { OverflowBadge } from '../../../../components/ui/OverflowBadge.tsx';
import { PoolMeter } from '../../../../components/ui/PoolMeter.tsx';
import { useFlashState } from '../../../../hooks/useFlashState.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { RollableRow } from '../RollableRow.tsx';
import { hpVarFor } from '../hpColor.ts';
import type { RollRequest } from '../rollTypes.ts';
import { useConditionsToggle } from '../useConditionsToggle.ts';
import type { PoolBumpers } from '../usePoolBumpers.ts';

export interface PoolsCardProps {
  character: CharacterDetail;
  canWrite: boolean;
  patchCombat: (field: string, value: unknown) => Promise<void>;
  bumpers: PoolBumpers;
  openRoll: (req: RollRequest) => void;
}

export function PoolsCard({ character, canWrite, patchCombat, bumpers, openRoll }: PoolsCardProps) {
  const combat = character.combat;
  const posture = combat?.posture ?? 'standing';
  const { conditions, toggle } = useConditionsToggle(character, canWrite, patchCombat);
  const { hp, fp, hpMax, fpMax, bumpHp, bumpFp, resetHp, resetFp } = bumpers;
  const hpFlash = useFlashState(makeFlashKey('character_combat', character.id, 'currentHp'));
  const fpFlash = useFlashState(makeFlashKey('character_combat', character.id, 'currentFp'));

  const hpColor = hpVarFor(hpMax > 0 ? hp / hpMax : 0);
  const fpColor = hpVarFor(fpMax > 0 ? fp / fpMax : 0);
  // Reeling starts when HP drops BELOW 1/3 of max (B419), so the
  // highest reeling value is ceil(max/3) - 1.
  const reelingThreshold = Math.ceil(hpMax / 3) - 1;
  const reelingSuggested =
    canWrite && hpMax > 0 && hp < Math.ceil(hpMax / 3) && !conditionsInclude(conditions, 'reeling');
  // Death checks start the moment HP drops to 0 or below (B419).
  const deathCheckRequired = hpMax > 0 && hp <= 0;

  function setPosture(p: string) {
    if (!canWrite) return;
    void patchCombat('posture', p);
  }

  const [chooseConditions, setChooseConditions] = useState(false);
  const [choosePosture, setChoosePosture] = useState(false);
  return (
    <>
      <FoldSection
        preferenceKey={`${character.id}:pools`}
        title="HP & FP"
        summary={`HP ${hp}/${hpMax} · FP ${fp}/${fpMax}`}
      >
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              {
                label: 'Hit points',
                short: 'HP',
                value: hp,
                max: hpMax,
                bump: bumpHp,
                reset: resetHp,
                color: hpColor,
                flash: hpFlash,
                tone: 'hp',
              },
              {
                label: 'Fatigue points',
                short: 'FP',
                value: fp,
                max: fpMax,
                bump: bumpFp,
                reset: resetFp,
                color: fpColor,
                flash: fpFlash,
                tone: 'fp',
              },
            ] as const
          ).map((pool) => (
            <fieldset
              key={pool.short}
              aria-label={pool.label}
              {...pool.flash.flashProps}
              className="field-rollback-flash min-w-0 space-y-2"
            >
              <div className="flex items-baseline gap-1 flex-wrap">
                <span className="label-eyebrow mr-auto">{pool.short}</span>
                <span className="num text-2xl font-bold" style={{ color: pool.color }}>
                  {pool.value}
                </span>
                <span className="num text-xs text-muted">/ {pool.max}</span>
                {pool.value > pool.max && <OverflowBadge amount={pool.value - pool.max} />}
              </div>
              <PoolMeter
                current={pool.value}
                max={pool.max}
                tone={pool.tone}
                height="md"
                ariaLabel={pool.label}
              />
              {canWrite && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-sm flex-1 min-h-11"
                    aria-label={`${pool.short} -1`}
                    onClick={() => pool.bump(-1)}
                  >
                    −1
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm flex-1 min-h-11"
                    aria-label={`${pool.short} +1`}
                    onClick={() => pool.bump(1)}
                  >
                    +1
                  </button>
                </div>
              )}
            </fieldset>
          ))}
        </div>
        {deathCheckRequired && (
          <div className="mt-2">
            <RollableRow
              label="Death check"
              baseTarget={character.derived.effectiveHt}
              openRoll={openRoll}
            />
          </div>
        )}
        {fp === -fpMax && (
          <p className="mt-2 text-xs text-warning">
            FP floor reached — further fatigue costs 1 HP per FP (B426)
          </p>
        )}
        <div className="mt-3">
          <FoldSection
            preferenceKey={`${character.id}:pool-details`}
            title="Recovery & thresholds"
            defaultOpen={false}
          >
            <p className="text-xs text-muted mb-3">
              HP: reeling at {reelingThreshold} · death checks from −{hpMax} · certain death at −
              {5 * hpMax} (B419/B423). Below 0 FP, each FP lost also costs 1 HP; at −{fpMax}, loss
              is HP-only (B426).
            </p>
            {canWrite && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { short: 'HP', max: hpMax, bump: bumpHp, reset: resetHp },
                  { short: 'FP', max: fpMax, bump: bumpFp, reset: resetFp },
                ].map((pool) => (
                  <div key={pool.short} className="space-y-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-sm flex-1"
                        aria-label={`${pool.short} -5`}
                        onClick={() => pool.bump(-5)}
                      >
                        −5 {pool.short}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm flex-1"
                        aria-label={`${pool.short} +5`}
                        onClick={() => pool.bump(5)}
                      >
                        +5 {pool.short}
                      </button>
                    </div>
                    <button type="button" className="btn btn-sm w-full" onClick={pool.reset}>
                      Reset {pool.short} to {pool.max}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </FoldSection>
        </div>
      </FoldSection>
      <FoldSection
        preferenceKey={`${character.id}:conditions`}
        title="Posture & conditions"
        summary={`${posture} · ${conditions.length} active`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-sm capitalize"
            disabled={!canWrite}
            aria-expanded={choosePosture}
            onClick={() => setChoosePosture(!choosePosture)}
          >
            Posture: {posture}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!canWrite}
            aria-expanded={chooseConditions}
            onClick={() => setChooseConditions(!chooseConditions)}
          >
            {chooseConditions ? 'Done' : 'Edit conditions'}
          </button>
        </div>
        <div hidden={!choosePosture} className="flex flex-wrap gap-1 mt-2">
          {POSTURES.map((p) => (
            <ConditionChip
              key={p}
              label={p}
              active={posture === p}
              onClick={() => {
                setPosture(p);
                setChoosePosture(false);
              }}
              disabled={!canWrite}
              className="capitalize"
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {COMMON_CONDITIONS.filter(
            (id) => chooseConditions || conditionsInclude(conditions, id),
          ).map((id) => (
            <ConditionChip
              key={id}
              label={conditionLabel(id)}
              active={conditionsInclude(conditions, id)}
              onClick={() => toggle(id)}
              disabled={!canWrite}
            />
          ))}
          {!chooseConditions && conditions.length === 0 && (
            <span className="text-xs text-muted">No active conditions</span>
          )}
        </div>
        {reelingSuggested && (
          <p className="mt-2 text-xs text-warning">
            <InfoTooltip
              content={`HP (${hp}) is below one-third of maximum (B419). Move and Dodge are already halved numerically; the Reeling chip is a manual reminder and adds no extra penalty. The reduction ends when HP reaches at least one-third of maximum.`}
            >
              Reeling suggested
            </InfoTooltip>
          </p>
        )}
      </FoldSection>
    </>
  );
}
