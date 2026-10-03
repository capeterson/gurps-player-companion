import { locationLabel } from '../../../shared/constants/hitLocations.ts';
import { raceName } from '../../../shared/domain/race.ts';
import { formatSigned } from '../../../shared/format/number.ts';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import type { TraitEffect } from '../../../shared/schemas/effects.ts';
import type { CharacterRace, RACE_ATTRIBUTE_AXES } from '../../../shared/schemas/race.ts';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { effectPreview } from './EffectsEditor.tsx';

export const RACE_AXIS_LABELS: Record<(typeof RACE_ATTRIBUTE_AXES)[number], string> = {
  st: 'ST',
  dx: 'DX',
  iq: 'IQ',
  ht: 'HT',
  hp: 'HP',
  will: 'Will',
  per: 'Per',
  fp: 'FP',
  speedQuarter: 'Basic Speed (¼ steps)',
  move: 'Basic Move',
  sizeModifier: 'Size modifier',
};

export function RaceSummary({
  race,
  levels,
}: { race: CharacterRace; levels?: CharacterDetail['racialSkills'] }) {
  const profile = race.snapshot;
  const describeEffect = (effect: TraitEffect, level: number | null) => {
    let text = effectPreview(effect);
    if (effect.target === 'dr' && effect.hitLocation)
      text += ` at ${locationLabel(effect.hitLocation)}`;
    if (effect.scaling === 'per_level') {
      const appliedLevel = level ?? 1;
      text += ` (level ${appliedLevel}: ${formatSigned(effect.value * appliedLevel)} total)`;
    }
    return text;
  };
  const effectSummaries = profile
    ? [
        ...profile.effects.map((effect) => `Race: ${describeEffect(effect, null)}`),
        ...profile.traits.flatMap((trait) =>
          trait.effects.map((effect) => `${trait.name}: ${describeEffect(effect, trait.level)}`),
        ),
      ]
    : [];
  const groupedEffects = new Map<string, number>();
  for (const summary of effectSummaries) {
    groupedEffects.set(summary, (groupedEffects.get(summary) ?? 0) + 1);
  }

  return (
    <div className="space-y-3 min-w-0 [overflow-wrap:anywhere]">
      <p className="font-medium">
        {raceName(race)} · {profile?.points ?? 0} points
      </p>
      {profile?.description && <Markdown source={profile.description} />}
      {profile && (
        <>
          {Object.entries(profile.attributeModifiers).some(([, v]) => (v ?? 0) !== 0) && (
            <p>
              {Object.entries(profile.attributeModifiers)
                .filter(([, v]) => (v ?? 0) !== 0)
                .map(
                  ([axis, v]) =>
                    `${RACE_AXIS_LABELS[axis as keyof typeof RACE_AXIS_LABELS]} ${(v ?? 0) > 0 ? '+' : ''}${v ?? 0}`,
                )
                .join(' · ')}
            </p>
          )}
          {profile.traits.length > 0 && (
            <div>
              <h4 className="font-medium">Traits included</h4>
              <ul className="list-disc pl-5">
                {profile.traits.map((t) => (
                  <li key={t.key}>
                    {t.name}
                    {t.level != null ? ` ${t.level}` : ''} [{t.points}]
                  </li>
                ))}
              </ul>
            </div>
          )}
          {effectSummaries.length > 0 && (
            <div>
              <h4 className="font-medium">Effects</h4>
              <ul className="list-disc pl-5">
                {[...groupedEffects].map(([summary, count]) => (
                  <li key={summary}>{count > 1 ? `${count} × ${summary}` : summary}</li>
                ))}
              </ul>
            </div>
          )}
          {profile.skills.length > 0 && (
            <div>
              <h4 className="font-medium">Racial skill purchases</h4>
              <ul className="list-disc pl-5">
                {profile.skills.map((s) => (
                  <li key={s.key}>
                    {s.name}
                    {s.specialization ? ` (${s.specialization})` : ''} · {s.points} points
                    {levels?.find((skill) => skill.key === s.key)?.effectiveLevel != null && (
                      <span>
                        {' '}
                        · Level {levels?.find((skill) => skill.key === s.key)?.effectiveLevel}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {profile.features.length > 0 && (
            <div>
              <h4 className="font-medium">Features</h4>
              <ul className="list-disc pl-5">
                {[...new Set(profile.features)].map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
