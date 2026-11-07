import type { ReactNode } from 'react';
import {
  normalizeMechanicalName,
  weaponSelectorMatchesSkill,
} from '../../../../../shared/domain/traitEffects.ts';
import { type ResolvedEffect, skillBonusFor } from '../../../../../shared/domain/traitEffects.ts';
import { formatSigned } from '../../../../../shared/format/number.ts';
import type { ResolvedEffectOut } from '../../../../../shared/schemas/character.ts';
import type { WeaponEffectTarget } from '../../../../../shared/schemas/effects.ts';
import { InfoTooltip } from '../../../../components/ui/InfoTooltip.tsx';

export function weaponEffectsForRow(
  effects: readonly ResolvedEffectOut[],
  itemId: string,
  target: WeaponEffectTarget,
  modeName?: string | null,
  modeKey?: string | null,
  skill?: string | null,
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
    if (!weaponSelectorMatchesSkill(effect.weaponSelector, skill)) return false;
    if (effect.weaponSelector?.modeKey) return effect.weaponSelector.modeKey === modeKey;
    const wantedMode = normalizeMechanicalName(effect.weaponSelector?.modeName ?? '');
    return !wantedMode || wantedMode === normalizedMode;
  });
}

export function effectTotal(effects: readonly ResolvedEffectOut[]): number {
  return effects.reduce((total, effect) => total + effect.value, 0);
}

export function skillEffectsForRow(
  effects: readonly ResolvedEffectOut[] | undefined,
  name: string,
  specialty?: string | null,
): ResolvedEffectOut[] {
  return [
    ...skillBonusFor(name, (effects ?? []) as unknown as readonly ResolvedEffect[], specialty)
      .sources,
  ] as ResolvedEffectOut[];
}

export interface ModifierBreakdownProps {
  baseLabel: string;
  baseValue: number | string;
  /** Effects already folded into the base input (for example weapon skill). */
  inputEffects?: readonly ResolvedEffectOut[];
  globalEffects?: readonly ResolvedEffectOut[];
  weaponEffects?: readonly ResolvedEffectOut[];
  finalValue: number | string;
}

export function hasModifierEffects({
  inputEffects = [],
  globalEffects = [],
  weaponEffects = [],
}: ModifierBreakdownProps): boolean {
  return inputEffects.length > 0 || globalEffects.length > 0 || weaponEffects.length > 0;
}

export function ModifierBreakdownContent({
  baseLabel,
  baseValue,
  inputEffects = [],
  globalEffects = [],
  weaponEffects = [],
  finalValue,
}: ModifierBreakdownProps) {
  const source = (effect: ResolvedEffectOut, index: number) => (
    <li key={`${effect.sourceId}-${effect.target}-${effect.value}-${index}`}>
      {formatSigned(effect.value)} <span>{effect.sourceName}</span>
      {effect.conditionLabel ? ` (${effect.conditionLabel})` : ''}
    </li>
  );
  return (
    <div className="not-num text-left text-[11px] text-base-content/70">
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
  );
}

export interface ModifierSection {
  readonly title: string;
  /** Arithmetic that precedes the effect list, such as an ST shortfall. */
  readonly note?: ReactNode;
  readonly breakdown: ModifierBreakdownProps;
}

/**
 * One ✦ control per attack row: a viewport-bounded, scrollable tooltip that
 * lists the attack, Accuracy and damage breakdowns together.
 */
export function ModifierTooltip({
  label,
  sections,
}: {
  /** Accessible name of the trigger, e.g. "Modifiers: Rapier, Swing". */
  label: string;
  sections: readonly ModifierSection[];
}) {
  if (sections.length === 0) return null;
  return (
    <InfoTooltip
      portal
      scrollable
      side="bottom"
      ariaLabel={label}
      contentClassName="w-72"
      triggerClassName="btn btn-ghost btn-circle btn-xs h-7 min-h-7 w-7 border border-base-300 font-normal text-base-content/70"
      content={
        <div className="space-y-2">
          {sections.map((section) => (
            <section key={section.title} aria-label={section.title}>
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-base-content/70">
                {section.title}
              </h4>
              {section.note && (
                <div className="text-[11px] text-base-content/70">{section.note}</div>
              )}
              <ModifierBreakdownContent {...section.breakdown} />
            </section>
          ))}
        </div>
      }
    >
      <span aria-hidden="true">✦</span>
    </InfoTooltip>
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
