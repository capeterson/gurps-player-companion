import type { LibrarySkillOut } from '../../../shared/schemas/campaignLibrary.ts';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { MechanicalEffectList } from './MechanicalEffectList.tsx';

export function librarySkillMeta(
  skill: Pick<LibrarySkillOut, 'attribute' | 'difficulty' | 'techLevel' | 'techLevelPolicy'>,
): string {
  const techLevel =
    skill.techLevelPolicy?.kind === 'required'
      ? '/TL'
      : skill.techLevel != null
        ? `TL${skill.techLevel}`
        : '';
  return [`${skill.attribute}/${skill.difficulty}`, techLevel].filter(Boolean).join(' · ');
}

/** Definition presentation shared by the campaign library and focused MCP cards. */
export function LibrarySkillDetails({
  skill,
  activeEffectsSnapshot,
}: {
  skill: LibrarySkillOut;
  activeEffectsSnapshot?: boolean | undefined;
}) {
  return (
    <>
      {skill.description && <Markdown source={skill.description} className="text-sm text-muted" />}
      {skill.specializationPolicy.kind !== 'none' && (
        <p className="text-xs text-dim">
          Specialization ·{' '}
          {skill.specializationPolicy.kind.startsWith('required') ? 'required' : 'optional'}
          {(skill.specializationPolicy.kind === 'required_catalog' ||
            skill.specializationPolicy.kind === 'optional_catalog') &&
            ` · ${skill.specializationPolicy.options.map((option) => option.name).join(', ')}`}
        </p>
      )}
      {skill.source && <p className="text-xs text-dim">Source · {skill.source}</p>}
      {skill.prerequisites && (
        <p className="text-xs text-dim">Prerequisites · {skill.prerequisites}</p>
      )}
      {skill.prerequisiteRules && (
        <p className="text-xs text-warning">Structured prerequisite rules active</p>
      )}
      {skill.defaults?.some((rule) => (rule.conditions?.length ?? 0) > 0) && (
        <p className="text-xs text-info">Includes conditional default candidates</p>
      )}
      <MechanicalEffectList
        effects={skill.effects}
        campaignId={skill.campaignId}
        activeEffectsSnapshot={activeEffectsSnapshot}
      />
    </>
  );
}
