import type { SkillAttribute } from '../../../shared/constants/skills.ts';
import { attributeLevelFor } from '../../../shared/domain/skillCalc.ts';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';

/** Core stats offered as quick picks in the skill lookup, in display order. */
export const STAT_LOOKUP_NAMES: SkillAttribute[] = ['ST', 'DX', 'IQ', 'HT', 'Will', 'Per'];

function isStatName(name: string): name is SkillAttribute {
  return (STAT_LOOKUP_NAMES as string[]).includes(name);
}

export interface SkillLookupResult {
  label: string;
  level: number | null;
}

/** Resolve a GM skill-lookup term against one character: a core stat or a named skill. */
export function resolveSkillLookup(
  character: CharacterDetail,
  lookup: string,
): SkillLookupResult | null {
  if (isStatName(lookup)) {
    return { label: lookup, level: attributeLevelFor(lookup, character.derived) };
  }
  const skill = character.skills.find((s) => s.name.toLowerCase() === lookup.toLowerCase());
  if (!skill) return null;
  return { label: skill.name, level: skill.level };
}
