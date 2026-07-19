import type { EffectDuration } from '../domain/effectDuration.ts';
export interface EffectTemplate {
  id: string;
  name: string;
  duration: EffectDuration;
  linkedCondition?: string;
  note?: string;
}
export const EFFECT_TEMPLATES: readonly EffectTemplate[] = [
  { id: 'shock', name: 'Shock', duration: { unit: 'rounds', amount: 1 }, linkedCondition: 'shock' },
  {
    id: 'stunned',
    name: 'Stunned',
    duration: { unit: 'indefinite' },
    linkedCondition: 'stunned',
    note: 'Roll HT or Will to recover',
  },
  { id: 'reeling', name: 'Reeling', duration: { unit: 'indefinite' }, linkedCondition: 'reeling' },
  { id: 'on_fire', name: 'On Fire', duration: { unit: 'indefinite' }, linkedCondition: 'on_fire' },
  {
    id: 'grappled',
    name: 'Grappled',
    duration: { unit: 'indefinite' },
    linkedCondition: 'grappled',
  },
  { id: 'one_minute_spell', name: '1-Minute Spell', duration: { unit: 'minutes', amount: 1 } },
];
