import type { TraitEffect } from '../../../shared/schemas/effects.ts';
import { useExperimentalActiveEffects } from '../../hooks/useExperimentalActiveEffects.ts';
import { effectPreview } from './EffectsEditor.tsx';

export function MechanicalEffectList({
  effects,
  campaignId,
}: {
  effects: readonly TraitEffect[];
  campaignId: string;
}) {
  const enabled = useExperimentalActiveEffects(campaignId);
  const visible = effects.filter((effect) => enabled || !effect.conditionGroup);
  if (!visible.length) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-base-content/70">
      {visible.map((effect, index) => (
        <li key={`${effect.target}-${index}`}>• {effectPreview(effect)}</li>
      ))}
    </ul>
  );
}
