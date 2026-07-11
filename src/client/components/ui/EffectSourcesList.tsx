/**
 * Renders the trait/skill source attribution for a single derived stat.
 *
 * Pass the character's `effects` array (from CharacterDetail) filtered to
 * the targets you want — typically a single target like 'dodge' or 'per',
 * or multiple related targets like ['dr'].  The component groups by
 * sourceName, sums by source, and shows inactive (conditional) sources
 * in a muted style.
 *
 * Used inside InfoTooltip for derived stats, so it can stay compact.
 */

import type { ResolvedEffectOut } from '../../../shared/schemas/character.ts';
import type { EffectTarget } from '../../../shared/schemas/effects.ts';

interface Props {
  /** Full effects list from CharacterDetail; the component filters internally. */
  effects: ReadonlyArray<ResolvedEffectOut>;
  /** Which target(s) contribute to this stat. */
  targets: EffectTarget | ReadonlyArray<EffectTarget>;
  /** Optional intro line shown above the source list when at least one source exists. */
  introLabel?: string;
}

export function EffectSourcesList({ effects, targets, introLabel }: Props) {
  const targetSet = new Set(typeof targets === 'string' ? [targets] : targets);
  const matching = effects.filter((e) => targetSet.has(e.target));
  if (matching.length === 0) return null;

  return (
    <div className="mt-2 space-y-0.5 text-[12px]">
      {introLabel && <div className="text-muted">{introLabel}</div>}
      {matching.map((eff, idx) => {
        const sign = eff.value >= 0 ? '+' : '';
        const tone = eff.active ? 'text-warning' : 'text-dim';
        return (
          <div key={`${eff.sourceId}-${idx}`} className={tone}>
            <span className="font-num">
              {sign}
              {eff.value}
            </span>{' '}
            <span>{eff.sourceName}</span>
            {eff.conditionLabel && (
              <span className="text-dim"> ({eff.conditionLabel}{eff.active ? '' : ', inactive'})</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
