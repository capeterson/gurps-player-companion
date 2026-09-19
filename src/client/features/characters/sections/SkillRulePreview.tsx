import { useState } from 'react';
import {
  type RuleContext,
  evaluateModifiers,
  evaluateNumber,
  inputKey,
} from '../../../../shared/domain/skillProcedures.ts';
import type {
  RuleInput,
  SkillAction,
  SkillModifierRule,
} from '../../../../shared/schemas/skillProcedures.ts';

export function SkillRulePreview({
  rules,
  source,
  context,
  choices,
  onContext,
  onChoices,
  action,
}: {
  rules: readonly SkillModifierRule[];
  source: string;
  context: RuleContext;
  choices: Record<string, number>;
  onContext: (context: RuleContext) => void;
  onChoices: (choices: Record<string, number>) => void;
  action?: SkillAction;
}) {
  const entries = evaluateModifiers(
    rules,
    context,
    choices,
    Object.fromEntries(
      Object.entries(choices)
        .filter(([k]) => k.startsWith('reference:'))
        .map(([k, v]) => [k.slice(10), v]),
    ),
  );
  const inputs = new Map<string, { input: RuleInput; type: 'number' | 'boolean' | 'string' }>();
  for (const entry of entries)
    for (const input of entry.needed) {
      const predicate = entry.rule.when.find((p) => inputKey(p.input) === inputKey(input));
      inputs.set(inputKey(input), {
        input,
        type: predicate ? (typeof predicate.value as 'number' | 'boolean' | 'string') : 'number',
      });
    }
  // Keep answered fields editable while the preview is open, but omit known character inputs.
  for (const entry of entries) {
    const rule = entry.rule;
    for (const p of rule.when)
      if (
        context[inputKey(p.input)] !== undefined &&
        !['character', 'skill', 'trait', 'campaign', 'tech_level'].includes(p.input.domain)
      )
        inputs.set(inputKey(p.input), {
          input: p.input,
          type: typeof p.value as 'number' | 'boolean' | 'string',
        });
    if (
      entry.reason === 'Condition not met' ||
      entry.needed.some((input) => rule.when.some((p) => inputKey(p.input) === inputKey(input)))
    )
      continue;
    const v = rule.value;
    if (
      v.kind === 'table' &&
      (context[inputKey(v.input)] === undefined ||
        !['character', 'skill', 'trait', 'campaign', 'tech_level'].includes(v.input.domain))
    )
      inputs.set(inputKey(v.input), { input: v.input, type: 'number' });
    if (v.kind === 'per_difference')
      for (const expr of [v.left, v.right])
        if (
          expr.kind === 'input' &&
          !['character', 'skill', 'trait', 'campaign', 'tech_level'].includes(expr.input.domain)
        )
          inputs.set(inputKey(expr.input), { input: expr.input, type: 'number' });
  }
  const actionNumbers = action
    ? [
        ...(action.time ? [action.time.amount] : []),
        ...action.costs.map((c) => c.amount),
        ...action.outcomes.flatMap((o) => (o.amount ? [o.amount] : [])),
      ]
    : [];
  for (const expression of actionNumbers)
    if (
      expression.kind === 'input' &&
      (context[inputKey(expression.input)] === undefined ||
        !['character', 'skill', 'trait', 'campaign', 'tech_level'].includes(
          expression.input.domain,
        ))
    )
      inputs.set(inputKey(expression.input), { input: expression.input, type: 'number' });
  return (
    <div className="space-y-2 text-sm">
      {[...inputs].map(([key, { input, type }]) => (
        <label className="block" key={key} htmlFor={`rule-${key}`}>
          {input.label}
          {type === 'boolean' ? (
            <select
              id={`rule-${key}`}
              aria-label={input.label}
              className="select select-bordered w-full"
              value={context[key] === undefined ? '' : String(context[key])}
              onChange={(e) => {
                const next = { ...context };
                if (e.target.value === '') delete next[key];
                else next[key] = e.target.value === 'true';
                onContext(next);
              }}
            >
              <option value="">Unknown / leave unapplied</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              id={`rule-${key}`}
              aria-label={input.label}
              className="input input-bordered w-full"
              type={type === 'number' ? 'number' : 'text'}
              value={String(context[key] ?? '')}
              onChange={(e) => {
                const next = { ...context };
                if (e.target.value === '') delete next[key];
                else next[key] = type === 'number' ? Number(e.target.value) : e.target.value;
                onContext(next);
              }}
            />
          )}
        </label>
      ))}
      {entries.map((entry) => (
        <div key={entry.rule.id} className="border border-base-300 rounded p-2">
          <p>
            {entry.rule.label}:{' '}
            {entry.applied ? `${(entry.value ?? 0) >= 0 ? '+' : ''}${entry.value}` : entry.reason}
          </p>
          <p className="text-xs text-dim">
            {source} · {entry.origin === 'automatic' ? 'Calculated' : 'Player/GM choice'} ·{' '}
            {entry.rule.when
              .map((p) => `${p.input.label} ${p.operator.replaceAll('_', ' ')} ${p.value}`)
              .join(', ') || 'Always'}{' '}
            · {entry.rule.appliesTo.replaceAll('_', ' ')}
          </p>
          {entry.applied && entry.reason !== 'Applied' && <p>{entry.reason}</p>}
          {entry.rule.sourceText && <p className="text-xs">{entry.rule.sourceText}</p>}
          {entry.rule.value.kind === 'range' && (
            <label>
              Choose {entry.rule.value.minimum} to {entry.rule.value.maximum}
              <input
                aria-label={`${entry.rule.label} value`}
                type="number"
                className="input input-bordered w-full"
                min={entry.rule.value.minimum}
                max={entry.rule.value.maximum}
                value={choices[entry.rule.id] ?? ''}
                onChange={(e) => {
                  const next = { ...choices };
                  if (e.target.value === '') delete next[entry.rule.id];
                  else next[entry.rule.id] = Number(e.target.value);
                  onChoices(next);
                }}
              />
            </label>
          )}
          {entry.rule.value.kind === 'reference' && (
            <label>
              GM value for {entry.rule.value.ruleKey}
              <input
                type="number"
                className="input input-bordered w-full"
                value={choices[`reference:${entry.rule.value.ruleKey}`] ?? ''}
                onChange={(e) => {
                  if (entry.rule.value.kind !== 'reference') return;
                  const next = { ...choices };
                  const key = `reference:${entry.rule.value.ruleKey}`;
                  if (e.target.value === '') delete next[key];
                  else next[key] = Number(e.target.value);
                  onChoices(next);
                }}
              />
            </label>
          )}
          {entry.rule.stacking === 'exclusive_group' && (
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => {
                const next = { ...choices };
                for (const rule of rules)
                  if (rule.group === entry.rule.group && rule.appliesTo === entry.rule.appliesTo)
                    delete next[`exclusive:${rule.id}`];
                next[`exclusive:${entry.rule.id}`] = 1;
                onChoices(next);
              }}
            >
              Choose {entry.rule.label}
            </button>
          )}
        </div>
      ))}
      {action && (
        <div className="border border-base-300 rounded p-2">
          <p>{action.sourceText}</p>
          <p>
            {action.roll
              ? `Roll basis: ${action.roll.basis.replaceAll('_', ' ')} ${action.roll.attribute ?? action.roll.skillName ?? ''} ${action.roll.modifier >= 0 ? '+' : ''}${action.roll.modifier}`
              : 'No automated roll'}
          </p>
          {action.time && (
            <p>
              Time: {evaluateNumber(action.time.amount, context) ?? 'Context required'}{' '}
              {action.time.unit}
            </p>
          )}
          {action.costs.map((cost) => (
            <p key={JSON.stringify(cost)}>
              Cost: {evaluateNumber(cost.amount, context) ?? 'Context required'} {cost.resource}{' '}
              {cost.label}
            </p>
          ))}
          {action.contest && (
            <p>
              {action.contest.kind} contest vs {action.contest.opponent}
            </p>
          )}
          {action.outcomes.map((outcome) => (
            <p key={JSON.stringify(outcome)}>
              {outcome.on.replaceAll('_', ' ')}
              {outcome.minimumMargin !== undefined ? `, margin ≥ ${outcome.minimumMargin}` : ''}
              {outcome.maximumMargin !== undefined ? `, margin ≤ ${outcome.maximumMargin}` : ''}:{' '}
              {outcome.text}
              {outcome.amount
                ? ` (${evaluateNumber(outcome.amount, context) ?? 'Context required'})`
                : ''}
            </p>
          ))}
          <p className="text-xs text-dim">
            Time, costs and outcomes are previews. Apply agreed changes on the sheet after resolving
            the action.
          </p>
        </div>
      )}
    </div>
  );
}

export function ProseActionPreview({
  action,
  source,
  context: initial,
}: { action: SkillAction; source: string; context: RuleContext }) {
  const [answers, setAnswers] = useState<RuleContext>({});
  const [choices, setChoices] = useState<Record<string, number>>({});
  return (
    <details>
      <summary>Procedure details</summary>
      <SkillRulePreview
        rules={[]}
        source={source}
        context={{ ...initial, ...answers }}
        choices={choices}
        onContext={(next) =>
          setAnswers(
            Object.fromEntries(
              Object.entries(next).filter(([key, value]) => initial[key] !== value),
            ),
          )
        }
        onChoices={setChoices}
        action={action}
      />
    </details>
  );
}
