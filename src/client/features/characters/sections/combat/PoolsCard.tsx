/**
 * Combat tab — HP/FP pools, posture, and conditions.
 *
 * Shares ONE `usePoolBumpers` instance with the Combat tab's sticky mobile
 * bottom bar (lifted to CombatTab) so rapid taps across both UIs
 * compound against the same latest-intended ref instead of a second
 * instance racing the first and dropping a tap.
 */

import { COMMON_CONDITIONS, POSTURES } from '../../../../../shared/constants/combat.ts';
import { conditionLabel, conditionsInclude } from '../../../../../shared/domain/conditions.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { Bumper } from '../../../../components/ui/Bumper.tsx';
import { ConditionChip } from '../../../../components/ui/ConditionChip.tsx';
import { InfoTooltip } from '../../../../components/ui/InfoTooltip.tsx';
import { OverflowBadge } from '../../../../components/ui/OverflowBadge.tsx';
import { PoolMeter } from '../../../../components/ui/PoolMeter.tsx';
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
  const { hp, fp, hpMax, fpMax, bumpHp, bumpFp, resetHp, resetFp, flashHp } = bumpers;

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

  return (
    <section className="card space-y-4 p-5">
      <p className="label-eyebrow">Pools</p>

      <div className={`rounded-2xl border border-base-300/60 p-4 ${flashHp ? 'flash' : ''}`}>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="label-eyebrow">Hit Points</span>
            {hp > hpMax && <OverflowBadge amount={hp - hpMax} />}
          </span>
        </div>
        <div className="mb-2 flex items-baseline gap-1.5">
          <span
            className={`num font-bold leading-none ${flashHp ? 'num-tween' : ''}`}
            style={{ fontSize: '3.5rem', color: hpColor, letterSpacing: '-0.03em' }}
          >
            {hp}
          </span>
          <span className="num text-xl text-dim">/ {hpMax}</span>
        </div>
        <PoolMeter current={hp} max={hpMax} tone="hp" height="lg" ariaLabel="Hit points" />
        <p className="num mt-2 text-[11px] text-dim">
          reeling at {reelingThreshold} · death checks from −{hpMax} · certain death at −{5 * hpMax}{' '}
          (B419/B423)
        </p>
        {deathCheckRequired && (
          <div className="mt-2">
            <RollableRow
              label="Death check"
              baseTarget={character.derived.effectiveHt}
              openRoll={openRoll}
              sublabel={
                <span className="block text-[11px] text-base-content/60">HT roll — B419</span>
              }
            />
          </div>
        )}
        {canWrite && (
          <>
            <div className="mt-3 flex gap-1.5">
              <Bumper tone="dmg" onClick={() => bumpHp(-5)} ariaLabel="HP -5">
                −5
              </Bumper>
              <Bumper tone="dmg" onClick={() => bumpHp(-1)} ariaLabel="HP -1">
                −1
              </Bumper>
              <Bumper tone="heal" onClick={() => bumpHp(+1)} ariaLabel="HP +1">
                +1
              </Bumper>
              <Bumper tone="heal" onClick={() => bumpHp(+5)} ariaLabel="HP +5">
                +5
              </Bumper>
            </div>
            <button
              type="button"
              className="mt-2 w-full rounded-field border border-dashed border-border-strong py-1.5 text-xs text-muted transition hover:bg-base-200"
              onClick={resetHp}
            >
              Reset to {hpMax}
            </button>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-base-300/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="label-eyebrow">Fatigue</span>
            {fp > fpMax && <OverflowBadge amount={fp - fpMax} />}
          </span>
          <div className="flex items-baseline gap-1">
            <span
              className="num font-bold leading-none"
              style={{ fontSize: '1.75rem', color: fpColor }}
            >
              {fp}
            </span>
            <span className="num text-sm text-dim">/ {fpMax}</span>
          </div>
        </div>
        <PoolMeter current={fp} max={fpMax} tone="fp" height="md" ariaLabel="Fatigue points" />
        <p className="num mt-2 text-[11px] text-dim">
          at −{fpMax} further FP costs come off HP instead (B426)
        </p>
        {fp === -fpMax && (
          <p className="mt-1 text-[11px] text-warning">
            FP floor reached — further fatigue costs 1 HP per FP (B426)
          </p>
        )}
        {canWrite && (
          <>
            <div className="mt-2.5 flex gap-1.5">
              <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(-5)}>
                −5
              </button>
              <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(-1)}>
                −1
              </button>
              <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(+1)}>
                +1
              </button>
              <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(+5)}>
                +5
              </button>
            </div>
            {fp !== fpMax && (
              <button
                type="button"
                className="mt-2 w-full rounded-field border border-dashed border-border-strong py-1.5 text-xs text-muted transition hover:bg-base-200"
                onClick={resetFp}
              >
                Reset to {fpMax}
              </button>
            )}
          </>
        )}
      </div>

      <div>
        <p className="label-eyebrow mb-1.5">Posture</p>
        <div className="flex flex-wrap gap-1">
          {POSTURES.map((p) => (
            <ConditionChip
              key={p}
              label={p}
              active={posture === p}
              onClick={() => setPosture(p)}
              disabled={!canWrite}
              className="capitalize"
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label-eyebrow">Conditions</span>
          <span className="num text-[10px] text-dim">{conditions.length} active</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_CONDITIONS.map((id) => {
            const active = conditionsInclude(conditions, id);
            const suggest = id === 'reeling' && reelingSuggested && !active;
            return (
              <ConditionChip
                key={id}
                label={conditionLabel(id)}
                active={active}
                onClick={() => toggle(id)}
                disabled={!canWrite}
                className={suggest ? 'animate-pulse ring-2 ring-warning/70' : ''}
              />
            );
          })}
        </div>
        {reelingSuggested && (
          <p className="mt-1.5 text-[11px] text-warning">
            <InfoTooltip
              content={`HP (${hp}) has dropped below ⅓ of max (${reelingThreshold + 1}) — GURPS applies Reeling until HP rises back above that line (B419). While Reeling, Move and Dodge are both halved (round up).`}
            >
              Reeling suggested
            </InfoTooltip>{' '}
            — B419
          </p>
        )}
      </div>
    </section>
  );
}
