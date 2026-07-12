import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { resolveSkillLookup } from './skillLookup.ts';

interface Props {
  character: CharacterDetail;
  dense: boolean;
  /** Name of the skill or stat currently selected via the GM skill lookup, if any. */
  lookup?: string | null;
}

export function GmCharacterCard({ character, dense, lookup }: Props) {
  const { derived, combat, encumbrance } = character;
  const currentHp = combat?.currentHp ?? derived.hp;
  const currentFp = combat?.currentFp ?? derived.fp;
  const hpPercent = Math.max(0, Math.min(100, (currentHp / Math.max(1, derived.hp)) * 100));
  const fpPercent = Math.max(0, Math.min(100, (currentFp / Math.max(1, derived.fp)) * 100));
  const lookupResult = lookup ? resolveSkillLookup(character, lookup) : null;

  return (
    <article className={`card border border-base-300 bg-base-100 ${dense ? 'p-3' : 'p-4'} gap-3`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold truncate">{character.name}</h2>
          <p className="text-xs text-base-content/60 truncate">
            {character.playerName || 'Unassigned player'}
            {character.techLevel != null ? ` · TL${character.techLevel}` : ''}
          </p>
        </div>
        <a
          href={`/characters/${character.id}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-xs shrink-0"
          aria-label={`Open ${character.name} in a new tab`}
        >
          Open ↗
        </a>
      </header>

      {lookup && (
        <div className="flex items-center justify-between rounded-md bg-primary/10 px-2 py-1.5 text-xs">
          <span className="truncate font-medium">{lookupResult?.label ?? lookup}</span>
          {lookupResult ? (
            <strong className="num text-sm">{lookupResult.level ?? '—'}</strong>
          ) : (
            <span className="text-base-content/50">not known</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-4 gap-1 text-center">
        {[
          ['ST', derived.effectiveSt],
          ['DX', derived.effectiveDx],
          ['IQ', derived.effectiveIq],
          ['HT', derived.effectiveHt],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md bg-base-200 px-1 py-1.5">
            <span className="block text-[10px] uppercase tracking-wider text-base-content/50">
              {label}
            </span>
            <strong className="num text-base">{value}</strong>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Pool
          label="HP"
          current={currentHp}
          maximum={derived.hp}
          percent={hpPercent}
          danger={currentHp <= derived.hp / 3}
        />
        <Pool
          label="FP"
          current={currentFp}
          maximum={derived.fp}
          percent={fpPercent}
          danger={currentFp <= derived.fp / 3}
        />
      </div>

      <dl className="grid grid-cols-4 gap-2 text-center text-xs">
        <Stat label="Move" value={derived.basicMove} />
        <Stat label="Dodge" value={derived.dodge - encumbrance.dodgePenalty} />
        <Stat label="Will" value={derived.will} />
        <Stat label="Per" value={derived.per} />
      </dl>

      <div className="flex flex-wrap gap-1">
        {combat?.posture && combat.posture !== 'standing' && (
          <span className="chip text-xs">{combat.posture}</span>
        )}
        {combat?.maneuver && <span className="chip text-xs on">{combat.maneuver}</span>}
        {combat?.conditions.map((condition) => (
          <span key={condition} className="chip text-xs">
            {condition.replaceAll('_', ' ')}
          </span>
        ))}
        {!combat?.maneuver && !combat?.conditions.length && (
          <span className="text-xs text-base-content/40">No active conditions</span>
        )}
      </div>
    </article>
  );
}

function Pool({
  label,
  current,
  maximum,
  percent,
  danger,
}: { label: string; current: number; maximum: number; percent: number; danger: boolean }) {
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span>{label}</span>
        <strong className={danger ? 'text-error' : ''}>
          {current} / {maximum}
        </strong>
      </div>
      <progress
        className={`progress w-full ${danger ? 'progress-error' : 'progress-primary'}`}
        value={percent}
        max="100"
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-base-content/50">{label}</dt>
      <dd className="num font-semibold">{value}</dd>
    </div>
  );
}
