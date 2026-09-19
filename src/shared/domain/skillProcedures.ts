import type {
  NumericExpression,
  RelativeLevelBenefit,
  RuleInput,
  SkillAction,
  SkillModifierRule,
} from '../schemas/skillProcedures.ts';

import type { RollOutcome } from './diceRoll.ts';

export type RuleContext = Readonly<Record<string, boolean | string | number>>;
export const inputKey = (input: RuleInput) => `${input.domain}:${input.key}`;
export function evaluateNumber(expression: NumericExpression, context: RuleContext): number | null {
  if (expression.kind === 'constant') return expression.value;
  const value = context[inputKey(expression.input)];
  return typeof value === 'number' && Number.isFinite(value)
    ? value * expression.factor + expression.offset
    : null;
}
export interface ModifierEvaluation {
  rule: SkillModifierRule;
  value: number | null;
  applied: boolean;
  origin: 'automatic' | 'selected';
  reason: string;
  needed: RuleInput[];
}
export function evaluateModifiers(
  rules: readonly SkillModifierRule[],
  context: RuleContext,
  choices: Readonly<Record<string, number>> = {},
  references: Readonly<Record<string, number>> = {},
): ModifierEvaluation[] {
  const result = rules.map((rule): ModifierEvaluation => {
    const needed: RuleInput[] = [];
    let eligible = true;
    for (const predicate of rule.when) {
      const actual = context[inputKey(predicate.input)];
      if (actual === undefined) {
        needed.push(predicate.input);
        continue;
      }
      const matches =
        predicate.operator === 'equals'
          ? actual === predicate.value
          : predicate.operator === 'not_equals'
            ? actual !== predicate.value
            : typeof actual === 'number' &&
              typeof predicate.value === 'number' &&
              (predicate.operator === 'at_least'
                ? actual >= predicate.value
                : actual <= predicate.value);
      if (!matches) eligible = false;
    }
    if (!eligible) needed.length = 0;
    let value: number | null = null;
    let origin: ModifierEvaluation['origin'] = 'automatic';
    const declaration = rule.value;
    const read = (expression: NumericExpression) => {
      if (
        expression.kind === 'input' &&
        !['character', 'skill', 'trait', 'campaign', 'tech_level'].includes(expression.input.domain)
      )
        origin = 'selected';
      const n = evaluateNumber(expression, context);
      if (n === null && expression.kind === 'input') needed.push(expression.input);
      return n;
    };
    if (eligible && needed.length === 0) {
      switch (declaration.kind) {
        case 'fixed':
          value = declaration.value;
          break;
        case 'range': {
          const selected = choices[rule.id];
          origin = 'selected';
          if (
            selected !== undefined &&
            selected >= declaration.minimum &&
            selected <= declaration.maximum
          )
            value = selected;
          break;
        }
        case 'per_difference': {
          const left = read(declaration.left);
          const right = read(declaration.right);
          if (left !== null && right !== null) {
            const difference = (left - right) / declaration.step;
            value =
              (declaration.rounding === 'floor'
                ? Math.floor(difference)
                : declaration.rounding === 'ceil'
                  ? Math.ceil(difference)
                  : Math.trunc(difference)) * declaration.factor;
          }
          break;
        }
        case 'table': {
          if (
            !['character', 'skill', 'trait', 'campaign', 'tech_level'].includes(
              declaration.input.domain,
            )
          )
            origin = 'selected';
          const input = context[inputKey(declaration.input)];
          if (typeof input !== 'number') needed.push(declaration.input);
          else
            value =
              declaration.rows.find((row) => input >= row.minimum && input <= row.maximum)?.value ??
              null;
          break;
        }
        case 'reference':
          value = references[declaration.ruleKey] ?? null;
          break;
      }
    }
    if (
      declaration.kind === 'reference' ||
      rule.when.some(
        (p) => !['character', 'skill', 'trait', 'campaign', 'tech_level'].includes(p.input.domain),
      )
    )
      origin = 'selected';
    if (value !== null && !Number.isFinite(value)) value = null;
    if (value !== null)
      value = Math.max(
        rule.cap?.minimum ?? Number.NEGATIVE_INFINITY,
        Math.min(rule.cap?.maximum ?? Number.POSITIVE_INFINITY, value),
      );
    if (value !== null) value = Math.trunc(value);
    return {
      rule,
      value,
      applied: eligible && needed.length === 0 && value !== null,
      origin,
      needed,
      reason: !eligible
        ? 'Condition not met'
        : needed.length
          ? 'Context required'
          : value === null
            ? 'Player/GM choice or reference required'
            : 'Applied',
    };
  });
  const groups = new Map<string, ModifierEvaluation[]>();
  for (const entry of result) {
    if (!entry.applied || entry.rule.stacking === 'stack') continue;
    const key = `${entry.rule.appliesTo}:${entry.rule.group}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const entries of groups.values()) {
    const policy = entries[0]?.rule.stacking;
    if (!policy) continue;
    // Mixed policies never silently choose a different interpretation.
    const consistent = entries.every((e) => e.rule.stacking === policy);
    const sorted = [...entries].sort((a, b) =>
      policy === 'lowest'
        ? (a.value ?? 0) - (b.value ?? 0) || a.rule.id.localeCompare(b.rule.id)
        : (b.value ?? 0) - (a.value ?? 0) || a.rule.id.localeCompare(b.rule.id),
    );
    const winner =
      policy === 'exclusive_group'
        ? sorted.find((e) => choices[`exclusive:${e.rule.id}`] === 1)
        : sorted[0];
    for (const entry of entries)
      if (!consistent || entry !== winner) {
        entry.applied = false;
        entry.reason = !consistent
          ? 'Conflicting group policies'
          : winner
            ? `Suppressed by ${winner.rule.label}`
            : 'Choose an alternative';
      }
  }
  // A shared group bound limits accumulated penalties/bonuses after exclusivity.
  const capped = new Map<string, ModifierEvaluation[]>();
  for (const entry of result)
    if (entry.applied && entry.rule.group) {
      const key = `${entry.rule.appliesTo}:${entry.rule.group}`;
      capped.set(key, [...(capped.get(key) ?? []), entry]);
    }
  for (const entries of capped.values()) {
    const minimum = Math.max(
      ...entries.map((e) => e.rule.groupCap?.minimum ?? Number.NEGATIVE_INFINITY),
    );
    const maximum = Math.min(
      ...entries.map((e) => e.rule.groupCap?.maximum ?? Number.POSITIVE_INFINITY),
    );
    if (minimum > maximum) {
      for (const entry of entries) {
        entry.applied = false;
        entry.reason = 'Conflicting group bounds';
      }
      continue;
    }
    const sum = entries.reduce((total, e) => total + (e.value ?? 0), 0);
    const bounded = Math.max(minimum, Math.min(maximum, sum));
    if (bounded !== sum) {
      const last = [...entries].sort((a, b) => a.rule.id.localeCompare(b.rule.id)).at(-1);
      if (last) {
        last.value = (last.value ?? 0) + bounded - sum;
        last.reason = 'Adjusted to accumulated group cap';
      }
    }
  }
  return result;
}
export function benefitUnlocked(
  benefit: RelativeLevelBenefit,
  level: number | null,
  attribute: number,
  points: number,
  specialization: string | null,
): boolean {
  const when = benefit.when;
  return (
    level !== null &&
    level >= (when.minimumAbsoluteLevel ?? Number.NEGATIVE_INFINITY) &&
    level - attribute >= (when.minimumRelativeLevel ?? Number.NEGATIVE_INFINITY) &&
    points >= (when.minimumPoints ?? 0) &&
    (!when.specialization ||
      when.specialization.trim().toLowerCase() === specialization?.trim().toLowerCase())
  );
}
export function actionTarget(
  action: SkillAction,
  skillLevel: number | null,
  attributes: Readonly<Record<string, number>>,
  skills: Readonly<Record<string, number>>,
): number | null {
  if (!action.roll || action.roll.basis === 'prose_only') return null;
  const base =
    action.roll.basis === 'skill'
      ? skillLevel
      : action.roll.basis === 'attribute'
        ? attributes[action.roll.attribute ?? '']
        : skills[action.roll.skillName ?? ''];
  return base == null ? null : base + action.roll.modifier;
}

/** Legacy flat choices remain opt-in task modifiers, preserving their prose. */
export function withLegacyModifiers(
  procedures: import('../schemas/skillProcedures.ts').SkillProcedures | undefined,
  flat: readonly { name: string; modifier: number; description?: string | undefined }[],
) {
  const declared = procedures ?? { modifiers: [], actions: [], benefits: [] };
  return {
    ...declared,
    modifiers: [
      ...declared.modifiers.filter((rule) => !rule.id.startsWith('legacy-')),
      ...flat.map(
        (entry, index): SkillModifierRule => ({
          id: `legacy-${index + 1}`,
          label: entry.name,
          when: [
            {
              input: { domain: 'task', key: `legacy-${index + 1}`, label: entry.name },
              operator: 'equals',
              value: true,
            },
          ],
          value: { kind: 'fixed', value: entry.modifier },
          appliesTo: 'task_roll',
          stacking: 'stack',
          ...(entry.description ? { sourceText: entry.description } : {}),
        }),
      ),
    ],
  };
}

/** Critical outcomes are explicit; ordinary success/failure rules also match critical rolls. */
export function evaluateActionOutcomes(
  action: SkillAction,
  roll: RollOutcome,
  context: RuleContext,
) {
  const resolved = { ...context, 'task:margin': roll.margin };
  return action.outcomes
    .filter((outcome) => {
      const matches =
        outcome.on === 'critical_success'
          ? roll.crit === 'success'
          : outcome.on === 'critical_failure'
            ? roll.crit === 'failure'
            : outcome.on === 'success'
              ? roll.success
              : !roll.success;
      return (
        matches &&
        roll.margin >= (outcome.minimumMargin ?? Number.NEGATIVE_INFINITY) &&
        roll.margin <= (outcome.maximumMargin ?? Number.POSITIVE_INFINITY)
      );
    })
    .map((outcome) => ({
      ...outcome,
      resolvedAmount: outcome.amount ? evaluateNumber(outcome.amount, resolved) : null,
    }));
}
