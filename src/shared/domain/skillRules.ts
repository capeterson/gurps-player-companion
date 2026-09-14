import type { SkillAttribute } from '../constants/skills.ts';
import type {
  SkillDefaultCondition,
  SkillPrerequisite,
  SkillTechLevelPolicy,
} from '../schemas/skill.ts';

export type RuleTruth = 'met' | 'unmet' | 'unknown';

export interface PrerequisiteSkill {
  name: string;
  specialization?: string | null;
  level?: number | null;
  relativeLevel?: number | null;
  points: number;
}

export interface PrerequisiteTrait {
  name: string;
  level?: number | null;
}

export interface PrerequisiteContext {
  skills: readonly PrerequisiteSkill[];
  traits: readonly PrerequisiteTrait[];
  attributes: Partial<Record<SkillAttribute, number>>;
  techLevel: number | null;
  campaignRules?: Readonly<Record<string, boolean | string | number | undefined>>;
  gmPermissions?: ReadonlySet<string>;
  targetSpecialization?: string | null;
}

export interface RuleEvaluation {
  truth: RuleTruth;
  message: string;
  children?: readonly RuleEvaluation[];
}

const normalize = (value: string | null | undefined) =>
  value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '';

function combine(kind: 'all' | 'any', children: readonly RuleEvaluation[]): RuleTruth {
  if (kind === 'all') {
    if (children.some((child) => child.truth === 'unmet')) return 'unmet';
    return children.some((child) => child.truth === 'unknown') ? 'unknown' : 'met';
  }
  if (children.some((child) => child.truth === 'met')) return 'met';
  return children.some((child) => child.truth === 'unknown') ? 'unknown' : 'unmet';
}

/** Pure three-valued prerequisite evaluator shared by optimistic UI and server. */
export function evaluateSkillPrerequisite(
  prerequisite: SkillPrerequisite,
  context: PrerequisiteContext,
): RuleEvaluation {
  if (prerequisite.kind === 'all' || prerequisite.kind === 'any') {
    const children = prerequisite.children.map((child) =>
      evaluateSkillPrerequisite(child, context),
    );
    return {
      truth: combine(prerequisite.kind, children),
      message: prerequisite.kind === 'all' ? 'All prerequisites' : 'Any prerequisite',
      children,
    };
  }
  if (prerequisite.kind === 'skill') {
    const candidates = context.skills.filter((skill) => {
      if (normalize(skill.name) !== normalize(prerequisite.name)) return false;
      const selector = prerequisite.specialization;
      if (!selector || selector.kind === 'any') return true;
      const expected = selector.kind === 'same' ? context.targetSpecialization : selector.value;
      return normalize(skill.specialization) === normalize(expected);
    });
    const met = candidates.some(
      (skill) =>
        (prerequisite.minimumLevel === undefined ||
          (skill.level !== null &&
            skill.level !== undefined &&
            skill.level >= prerequisite.minimumLevel)) &&
        (prerequisite.minimumRelativeLevel === undefined ||
          (skill.relativeLevel !== null &&
            skill.relativeLevel !== undefined &&
            skill.relativeLevel >= prerequisite.minimumRelativeLevel)) &&
        (prerequisite.minimumPoints === undefined || skill.points >= prerequisite.minimumPoints),
    );
    const requirements = [
      prerequisite.minimumLevel === undefined ? null : `level ${prerequisite.minimumLevel}`,
      prerequisite.minimumRelativeLevel === undefined
        ? null
        : `relative level ${prerequisite.minimumRelativeLevel >= 0 ? '+' : ''}${prerequisite.minimumRelativeLevel}`,
      prerequisite.minimumPoints === undefined ? null : `${prerequisite.minimumPoints} points`,
    ].filter(Boolean);
    return {
      truth: met ? 'met' : 'unmet',
      message: `${prerequisite.name}${requirements.length ? ` at ${requirements.join(', ')}` : ''}`,
    };
  }
  if (prerequisite.kind === 'trait') {
    const met = context.traits.some(
      (trait) =>
        normalize(trait.name) === normalize(prerequisite.name) &&
        (prerequisite.minimumLevel === undefined ||
          (trait.level ?? 0) >= prerequisite.minimumLevel),
    );
    return {
      truth: met ? 'met' : 'unmet',
      message: `${prerequisite.name}${prerequisite.minimumLevel === undefined ? '' : ` ${prerequisite.minimumLevel}`}`,
    };
  }
  if (prerequisite.kind === 'attribute') {
    const actual = context.attributes[prerequisite.attribute];
    return {
      truth: actual === undefined ? 'unknown' : actual >= prerequisite.minimum ? 'met' : 'unmet',
      message: `${prerequisite.attribute} ${prerequisite.minimum}+`,
    };
  }
  if (prerequisite.kind === 'tech_level') {
    const actual = context.techLevel;
    const met =
      actual !== null &&
      (prerequisite.minimum === undefined || actual >= prerequisite.minimum) &&
      (prerequisite.maximum === undefined || actual <= prerequisite.maximum);
    const range =
      prerequisite.minimum !== undefined && prerequisite.maximum !== undefined
        ? `TL${prerequisite.minimum}-${prerequisite.maximum}`
        : prerequisite.minimum !== undefined
          ? `TL${prerequisite.minimum}+`
          : `TL${prerequisite.maximum} or lower`;
    return { truth: actual === null ? 'unknown' : met ? 'met' : 'unmet', message: range };
  }
  if (prerequisite.kind === 'campaign_rule') {
    const actual = context.campaignRules?.[prerequisite.ruleKey];
    const expected = prerequisite.expectedValue ?? true;
    return {
      truth: actual === undefined ? 'unknown' : actual === expected ? 'met' : 'unmet',
      message: `Campaign rule ${prerequisite.ruleKey} = ${String(expected)}`,
    };
  }
  const granted = context.gmPermissions?.has(prerequisite.label);
  return {
    truth: granted === undefined ? 'unknown' : granted ? 'met' : 'unmet',
    message: `GM permission: ${prerequisite.label}`,
  };
}

export function failedPrerequisiteMessages(evaluation: RuleEvaluation): string[] {
  if (evaluation.children) {
    if (evaluation.truth === 'met') return [];
    return evaluation.children.flatMap(failedPrerequisiteMessages);
  }
  return evaluation.truth === 'met' ? [] : [evaluation.message];
}

export interface DefaultConditionContext {
  task?: string;
  campaignRules?: Readonly<Record<string, boolean | string | number | undefined>>;
  specializationDimensions?: Readonly<Record<string, boolean | undefined>>;
  characterFacts?: ReadonlySet<string>;
}

export function evaluateSkillDefaultConditions(
  conditions: readonly SkillDefaultCondition[] | undefined,
  context: DefaultConditionContext = {},
): RuleEvaluation[] {
  return (conditions ?? []).map((condition) => {
    if (condition.kind === 'task') {
      return {
        truth:
          context.task === undefined
            ? 'unknown'
            : normalize(context.task) === normalize(condition.task)
              ? 'met'
              : 'unmet',
        message: `Task: ${condition.task}`,
      };
    }
    if (condition.kind === 'campaign_rule') {
      const actual = context.campaignRules?.[condition.rule];
      return {
        truth: actual === undefined ? 'unknown' : actual === condition.value ? 'met' : 'unmet',
        message: `Campaign rule ${condition.rule} = ${String(condition.value)}`,
      };
    }
    if (condition.kind === 'same_specialization_dimension') {
      const actual = context.specializationDimensions?.[condition.dimension];
      return {
        truth: actual === undefined ? 'unknown' : actual ? 'met' : 'unmet',
        message: `Same ${condition.dimension}`,
      };
    }
    const actual = context.characterFacts?.has(condition.fact);
    return {
      truth: actual === undefined ? 'unknown' : actual ? 'met' : 'unmet',
      message: `Character fact: ${condition.fact}`,
    };
  });
}

export function conditionsProven(
  conditions: readonly SkillDefaultCondition[] | undefined,
  context?: DefaultConditionContext,
): boolean {
  return evaluateSkillDefaultConditions(conditions, context).every(
    (result) => result.truth === 'met',
  );
}

export function resolvedTechLevel(
  policy: SkillTechLevelPolicy,
  requested: number | null | undefined,
  suggested: { campaign?: number | null; character?: number | null } = {},
): number | null {
  if (policy.kind === 'not_applicable') return null;
  if (policy.kind === 'fixed') return policy.techLevel;
  if (requested !== null && requested !== undefined) return requested;
  const suggestion =
    policy.suggestedFrom === 'campaign'
      ? suggested.campaign
      : policy.suggestedFrom === 'character'
        ? suggested.character
        : null;
  if (suggestion === null || suggestion === undefined)
    throw new Error('A concrete Tech Level is required');
  return suggestion;
}

/** Basic Set cross-TL use. `null` means the IQ-based table makes use impossible. */
export function crossTechLevelPenalty(
  attribute: SkillAttribute,
  learnedTechLevel: number,
  taskTechLevel: number,
): number | null {
  const difference = taskTechLevel - learnedTechLevel;
  if (difference === 0) return 0;
  if (attribute !== 'IQ') return -Math.abs(difference);
  if (difference > 0) return difference >= 4 ? null : -5 * difference;
  return -(2 * Math.abs(difference) - 1);
}
