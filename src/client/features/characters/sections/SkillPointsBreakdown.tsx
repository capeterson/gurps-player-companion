import { skillDisplayName } from '../../../../shared/domain/defenseCalc.ts';
import { raceName, racialProfile } from '../../../../shared/domain/race.ts';
import { formatSigned } from '../../../../shared/format/number.ts';
import type { ResolvedEffectOut } from '../../../../shared/schemas/character.ts';
import { SheetAnchorLink } from '../SheetAnchorLink.tsx';
import { mechanicsUnavailableReason } from '../mechanicsUnavailableReason.ts';
import { useCharacterDetail } from '../useCharacterDetail.ts';
import { skillEffectsForRow } from './combat/weaponEffectView.tsx';

function EffectSource({ effect, characterId }: { effect: ResolvedEffectOut; characterId: string }) {
  return (
    <SheetAnchorLink
      className="link link-primary"
      kind={effect.sourceKind === 'item' ? 'inventory' : effect.sourceKind}
      id={effect.sourceKind === 'race' ? characterId : effect.sourceId}
    >
      {effect.sourceName}
    </SheetAnchorLink>
  );
}

/** Mounted only while the points input's tooltip is open. The draft is a
 * read-only override of the same local detail builder used by the sheet. */
export function SkillPointsBreakdown({
  characterId,
  skillId,
  draftPoints,
}: {
  characterId: string;
  skillId: string;
  draftPoints: string;
}) {
  const points = Number(draftPoints);
  const valid =
    draftPoints.trim() !== '' && Number.isInteger(points) && points >= 0 && points <= 1000;
  const detail = useCharacterDetail(valid ? characterId : undefined, {
    skillPointPreview: { skillId, points },
  });
  if (!valid) return <p>Enter whole points from 0 to 1000 to preview the skill level.</p>;
  const skill = detail?.skills.find((entry) => entry.id === skillId);
  const breakdown = detail?.skillLevelBreakdowns?.get(skillId);
  if (!detail || !skill || !breakdown || skill.points !== points)
    return <p>Calculating skill level…</p>;
  if (detail.libraryEffectsKnown === false)
    return (
      <p>
        The skill breakdown is unavailable. {mechanicsUnavailableReason(detail)} Reconnect to load
        the missing rules.
      </p>
    );
  const attribute = skill.attribute;
  const axis = attribute.toLowerCase();
  const axes = attribute === 'Will' || attribute === 'Per' ? ['iq', axis] : [axis];
  const attributeEffects = detail.effects.filter(
    (effect) => effect.active && axes.includes(effect.target),
  );
  const racial = racialProfile(detail.race);
  const raceAdjustment = axes.reduce(
    (total, key) =>
      total + (racial.attributeModifiers[key as keyof typeof racial.attributeModifiers] ?? 0),
    0,
  );
  const temporary = detail.tempEffects.flatMap((effect) => {
    const value = axes.reduce(
      (total, key) => total + (effect.mods[key as keyof typeof effect.mods] ?? 0),
      0,
    );
    return value ? [{ ...effect, value }] : [];
  });
  const baseAttribute =
    attribute === 'Other'
      ? 10
      : attribute === 'Will'
        ? detail.iq + detail.willMod
        : attribute === 'Per'
          ? detail.iq + detail.perMod
          : detail[axis as 'st' | 'dx' | 'iq' | 'ht'];
  const bonusEffects = skillEffectsForRow(detail.effects, skill.name, skill.specialization);
  const source = breakdown.defaultSource;
  const sourceSkill = source?.id
    ? detail.skills.find((entry) => entry.id === source.id)
    : undefined;
  const attributeLink = (name: string) =>
    name === 'Other' ? (
      name
    ) : (
      <SheetAnchorLink className="link link-primary" kind="attribute" id={name}>
        {name}
      </SheetAnchorLink>
    );
  const effectRows = (effects: readonly ResolvedEffectOut[]) =>
    effects.map((effect, index) => (
      <li key={`${effect.sourceId}-${index}`}>
        {formatSigned(effect.value)} <EffectSource effect={effect} characterId={characterId} />
        {effect.conditionLabel ? ` (${effect.conditionLabel})` : ''}
      </li>
    ));
  return (
    <div className="space-y-2 text-left not-num">
      <p className="font-semibold">Net skill level: {skill.effectiveLevel ?? 'Unavailable'}</p>
      <p>
        <SheetAnchorLink className="link link-primary" kind="skill" id={skill.id}>
          {skillDisplayName(skill.name, skill.specialization)}
        </SheetAnchorLink>{' '}
        · {skill.attribute}/{skill.difficulty}
      </p>
      <div>
        <p className="font-medium">
          {attributeLink(attribute)}: {breakdown.attributeLevel}
        </p>
        <ul className="space-y-1">
          <li>
            Base {attributeLink(attribute)}: {baseAttribute}
          </li>
          {raceAdjustment !== 0 && (
            <li>
              {formatSigned(raceAdjustment)}{' '}
              <SheetAnchorLink className="link link-primary" kind="race" id={characterId}>
                {raceName(detail.race)}
              </SheetAnchorLink>
            </li>
          )}
          {temporary.map((effect) => (
            <li key={effect.id}>
              {formatSigned(effect.value)}{' '}
              <SheetAnchorLink className="link link-primary" kind="attribute" id={attribute}>
                {effect.name}
              </SheetAnchorLink>
            </li>
          ))}
          {effectRows(attributeEffects)}
        </ul>
      </div>
      <div>
        <p className="font-medium">Training: {breakdown.points} points</p>
        <ul className="space-y-1">
          <li>{points} personal points</li>
          {!!skill.racialTrainingPoints && (
            <li>
              {skill.racialTrainingPoints} racial points from{' '}
              <SheetAnchorLink className="link link-primary" kind="race" id={characterId}>
                {raceName(detail.race)}
              </SheetAnchorLink>
            </li>
          )}
          <li>
            {breakdown.purchasedLevel === null
              ? 'No purchased level'
              : `${attribute} ${formatSigned(breakdown.purchasedLevel - breakdown.attributeLevel)} = ${breakdown.purchasedLevel} from points (${skill.difficulty})`}
          </li>
          {source && (
            <>
              <li>
                Default:{' '}
                {source.kind === 'skill' && source.id ? (
                  <SheetAnchorLink
                    className="link link-primary"
                    kind={sourceSkill?.raceGranted ? 'race' : 'skill'}
                    id={sourceSkill?.raceGranted ? characterId : source.id}
                  >
                    {source.name}
                  </SheetAnchorLink>
                ) : (
                  attributeLink(source.name)
                )}{' '}
                {source.level} {formatSigned(source.modifier)}
                {source.techLevelPenalty ? ` ${formatSigned(source.techLevelPenalty)} for TL` : ''}{' '}
                = {source.defaultLevel}
              </li>
              {source.pointCredit > 0 && (
                <li>
                  Default credit: {source.pointCredit} points (virtual); with {breakdown.points}{' '}
                  training points, buys {formatSigned(source.boughtIncrease)} above default
                </li>
              )}
            </>
          )}
        </ul>
      </div>
      <p>Base skill level: {skill.level ?? 'Unavailable'}</p>
      {bonusEffects.length > 0 && (
        <div>
          <p className="font-medium">Skill modifiers</p>
          <ul className="space-y-1">{effectRows(bonusEffects)}</ul>
        </div>
      )}
      {skill.defaultConditionMessages?.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}
