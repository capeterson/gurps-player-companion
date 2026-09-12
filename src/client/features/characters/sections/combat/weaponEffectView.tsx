import { normalizeMechanicalName } from '../../../../../shared/domain/traitEffects.ts';
import { type ResolvedEffect, skillBonusFor } from '../../../../../shared/domain/traitEffects.ts';
import type { ResolvedEffectOut } from '../../../../../shared/schemas/character.ts';
import type { WeaponEffectTarget } from '../../../../../shared/schemas/effects.ts';

export function weaponEffectsForRow(
  effects: readonly ResolvedEffectOut[],
  itemId: string,
  target: WeaponEffectTarget,
  modeName?: string | null,
): ResolvedEffectOut[] {
  const normalizedMode = normalizeMechanicalName(modeName ?? '');
  return effects.filter((effect) => {
    if (
      effect.target !== target ||
      !effect.active ||
      !effect.matchedInventoryItemIds?.includes(itemId)
    ) {
      return false;
    }
    const wantedMode = normalizeMechanicalName(effect.weaponSelector?.modeName ?? '');
    return !wantedMode || wantedMode === normalizedMode;
  });
}

export function effectTotal(effects: readonly ResolvedEffectOut[]): number {
  return effects.reduce((total, effect) => total + effect.value, 0);
}

export function skillEffectsForRow(
  effects: readonly ResolvedEffectOut[],
  name: string,
  specialty?: string | null,
): ResolvedEffectOut[] {
  return [
    ...skillBonusFor(name, effects as unknown as readonly ResolvedEffect[], specialty).sources,
  ] as ResolvedEffectOut[];
}

export function ModifierBreakdown({
  baseLabel,
  baseValue,
  inputEffects = [],
  globalEffects = [],
  weaponEffects = [],
  finalValue,
}: {
  baseLabel: string;
  baseValue: number | string;
  /** Effects already folded into the base input (for example weapon skill). */
  inputEffects?: readonly ResolvedEffectOut[];
  globalEffects?: readonly ResolvedEffectOut[];
  weaponEffects?: readonly ResolvedEffectOut[];
  finalValue: number | string;
}) {
  if (inputEffects.length === 0 && globalEffects.length === 0 && weaponEffects.length === 0) {
    return null;
  }
  const source = (effect: ResolvedEffectOut, index: number) => (
    <li key={`${effect.sourceId}-${effect.target}-${effect.value}-${index}`}>
      {effect.value >= 0 ? '+' : ''}
      {effect.value} {effect.sourceName}
      {effect.conditionLabel ? ` (${effect.conditionLabel})` : ''}
    </li>
  );
  return (
    <details className="not-num text-[11px] text-base-content/60">
      <summary className="cursor-pointer">Modifiers</summary>
      <div className="mt-1 rounded bg-base-200/60 p-2">
        <div>
          {baseLabel}: {baseValue}
        </div>
        {inputEffects.length > 0 && (
          <>
            <div className="mt-1 font-medium">Skill effects before defense formula</div>
            <ul>{inputEffects.map(source)}</ul>
          </>
        )}
        {globalEffects.length > 0 && (
          <>
            <div className="mt-1 font-medium">Global effects</div>
            <ul>{globalEffects.map(source)}</ul>
          </>
        )}
        {weaponEffects.length > 0 && (
          <>
            <div className="mt-1 font-medium">Weapon effects</div>
            <ul>{weaponEffects.map(source)}</ul>
          </>
        )}
        <div className="mt-1 font-medium">Final: {finalValue}</div>
      </div>
    </details>
  );
}

export function WeaponEffectDiagnostics({
  effects,
  inventory,
}: {
  effects: readonly ResolvedEffectOut[];
  inventory?: readonly { id: string; name: string }[];
}) {
  const diagnosed = effects.filter(
    (effect) => effect.weaponMatchStatus === 'zero' || effect.weaponMatchStatus === 'multiple',
  );
  if (diagnosed.length === 0) return null;
  return (
    <details className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">
        Weapon effect matches ({diagnosed.length})
      </summary>
      <ul className="mt-1 space-y-1 text-base-content/70">
        {diagnosed.map((effect) => {
          const count = effect.matchedInventoryItemIds?.length ?? 0;
          const names = (effect.matchedInventoryItemIds ?? [])
            .map((id) => inventory?.find((item) => item.id === id)?.name)
            .filter((name): name is string => Boolean(name));
          return (
            <li key={`${effect.sourceId}-${effect.target}-${effect.value}`}>
              {effect.sourceName}: {effect.target.replace('weapon_', '')} selector matches{' '}
              {count === 0
                ? 'no equipped weapons'
                : `${count} equipped weapons${names.length ? ` (${names.join(', ')})` : ''}`}
              .
            </li>
          );
        })}
      </ul>
    </details>
  );
}
