import { describe, expect, it } from 'bun:test';
import { librarySkillCreate } from '../schemas/campaignLibrary.ts';
import {
  relativeLevelBenefit,
  skillAction,
  skillModifierRule,
  skillProcedures,
} from '../schemas/skillProcedures.ts';
import { emitLibraryYaml, parseLibraryYaml } from '../yaml/library.ts';
import {
  actionTarget,
  benefitUnlocked,
  evaluateActionOutcomes,
  evaluateModifiers,
  evaluateNumber,
  withLegacyModifiers,
} from './skillProcedures.ts';
const input = { domain: 'equipment' as const, key: 'quality', label: 'Equipment quality' };
const rule = (value: unknown, extra: object = {}) =>
  skillModifierRule.parse({
    id: 'rule',
    label: 'Equipment',
    value,
    appliesTo: 'task_roll',
    ...extra,
  });
describe('bounded skill modifiers', () => {
  it('covers fixed, selected range, stepped difference, table and reference values', () => {
    expect(evaluateModifiers([rule({ kind: 'fixed', value: -3 })], {})[0]?.value).toBe(-3);
    const range = rule({ kind: 'range', minimum: -5, maximum: 2 });
    expect(evaluateModifiers([range], {})[0]?.applied).toBe(false);
    expect(evaluateModifiers([range], {}, { rule: -2 })[0]).toMatchObject({
      value: -2,
      origin: 'selected',
      applied: true,
    });
    expect(evaluateModifiers([range], {}, { rule: 8 })[0]?.applied).toBe(false);
    const scaling = rule({
      kind: 'per_difference',
      left: { kind: 'input', input },
      right: { kind: 'constant', value: 2 },
      factor: -2,
      step: 2,
    });
    expect(evaluateModifiers([scaling], {})[0]?.needed).toEqual([input]);
    expect(evaluateModifiers([scaling], { 'equipment:quality': 7 })[0]?.value).toBe(-4);
    const table = rule({
      kind: 'table',
      input,
      rows: [
        { minimum: 0, maximum: 1, value: -5 },
        { minimum: 2, maximum: 3, value: 0 },
      ],
    });
    expect(evaluateModifiers([table], { 'equipment:quality': 1 })[0]?.value).toBe(-5);
    expect(evaluateModifiers([table], { 'equipment:quality': 4 })[0]?.applied).toBe(false);
    const reference = rule({ kind: 'reference', ruleKey: 'cultural-familiarity' });
    expect(evaluateModifiers([reference], {})[0]?.applied).toBe(false);
    expect(evaluateModifiers([reference], {}, {}, { 'cultural-familiarity': -3 })[0]?.value).toBe(
      -3,
    );
  });
  it('never applies unknown or false conditions across every context category', () => {
    for (const domain of [
      'task',
      'equipment',
      'environment',
      'familiarity',
      'movement',
      'tech_level',
      'character',
      'skill',
      'trait',
      'campaign',
    ]) {
      const r = rule(
        { kind: 'fixed', value: -2 },
        { when: [{ input: { ...input, domain }, operator: 'equals', value: true }] },
      );
      expect(evaluateModifiers([r], {})[0]?.applied).toBe(false);
      expect(evaluateModifiers([r], { [`${domain}:quality`]: false })[0]?.applied).toBe(false);
      expect(evaluateModifiers([r], { [`${domain}:quality`]: true })[0]?.applied).toBe(true);
    }
  });
  it('caps values and resolves deterministic highest, lowest and explicit alternatives', () => {
    for (const policy of ['highest', 'lowest', 'exclusive_group']) {
      const rules = [
        rule(
          { kind: 'fixed', value: 9 },
          { id: 'a', stacking: policy, group: 'tools', cap: { maximum: 3 } },
        ),
        rule({ kind: 'fixed', value: -2 }, { id: 'b', stacking: policy, group: 'tools' }),
      ];
      const evaluated = evaluateModifiers(
        rules,
        {},
        policy === 'exclusive_group' ? { 'exclusive:b': 1 } : {},
      );
      expect(evaluated.filter((e) => e.applied).map((e) => e.value)).toEqual([
        policy === 'highest' ? 3 : -2,
      ]);
      expect(
        evaluateModifiers(
          [...rules].reverse(),
          {},
          policy === 'exclusive_group' ? { 'exclusive:b': 1 } : {},
        )
          .filter((e) => e.applied)
          .map((e) => e.value),
      ).toEqual([policy === 'highest' ? 3 : -2]);
    }
  });
  it('rejects overlapping tables, duplicate IDs, unbounded expressions and reversed ranges', () => {
    expect(() =>
      rule({
        kind: 'table',
        input,
        rows: [
          { minimum: 0, maximum: 2, value: 1 },
          { minimum: 2, maximum: 4, value: 2 },
        ],
      }),
    ).toThrow();
    expect(() => rule({ kind: 'range', minimum: 5, maximum: 1 })).toThrow();
    expect(() => rule({ kind: 'script', expression: 'eval(x)' })).toThrow();
    expect(
      skillProcedures.safeParse({
        modifiers: [rule({ kind: 'fixed', value: 1 }), rule({ kind: 'fixed', value: 2 })],
      }).success,
    ).toBe(false);
  });
});
it('previews combat, recovery, movement, healing, throwing and contests without English-name behavior', () => {
  for (const [label, kind] of [
    ['Combat', 'damage'],
    ['Recovery', 'recovery'],
    ['Movement', 'distance'],
    ['Healing', 'healing'],
    ['Throwing', 'distance'],
    ['Social', 'note'],
  ] as const) {
    const action = skillAction.parse({
      id: kind,
      label,
      roll: { basis: 'attribute', attribute: 'IQ', modifier: -2 },
      time: { amount: { kind: 'constant', value: 10 }, unit: 'minutes' },
      costs: [{ resource: 'fp', amount: { kind: 'constant', value: 1 } }],
      contest: { kind: 'quick', opponent: 'Will' },
      outcomes: [
        {
          on: 'success',
          kind,
          text: 'Resolve with GM',
          amount: {
            kind: 'input',
            input: { domain: 'task', key: 'margin', label: 'Margin' },
            factor: 2,
          },
        },
      ],
    });
    expect(actionTarget(action, 14, { IQ: 12 }, {})).toBe(10);
    const amount = action.outcomes[0]?.amount;
    if (!amount) throw new Error('Fixture amount missing');
    expect(evaluateNumber(amount, { 'task:margin': 3 })).toBe(6);
    expect(evaluateNumber(amount, {})).toBeNull();
  }
  expect(
    actionTarget(
      skillAction.parse({ id: 'prose', label: 'Prose', roll: { basis: 'prose_only' } }),
      14,
      {},
      {},
    ),
  ).toBeNull();
  const benefit = relativeLevelBenefit.parse({
    id: 'trained',
    label: 'Trained defense',
    when: {
      minimumRelativeLevel: 1,
      minimumAbsoluteLevel: 12,
      minimumPoints: 2,
      specialization: 'A',
    },
    effects: [{ target: 'parry', value: 1 }],
  });
  expect(benefitUnlocked(benefit, 12, 11, 2, 'a')).toBe(true);
  expect(benefitUnlocked(benefit, 12, 12, 2, 'a')).toBe(false);
  expect(benefitUnlocked(benefit, 12, 11, 1, 'a')).toBe(false);
  expect(benefitUnlocked(benefit, 12, 11, 2, 'b')).toBe(false);
});
it('round-trips complete skill procedures and accepts legacy absent arrays', () => {
  const procedures = skillProcedures.parse({
    modifiers: [rule({ kind: 'fixed', value: 2 })],
    actions: [{ id: 'act', label: 'Act', sourceText: 'Prose remains' }],
    benefits: [
      {
        id: 'benefit',
        label: 'Benefit',
        when: { minimumRelativeLevel: 0 },
        effects: [{ target: 'parry', value: 1 }],
      },
    ],
  });
  const skill = librarySkillCreate.parse({
    name: 'Example',
    attribute: 'DX',
    difficulty: 'A',
    procedures,
  });
  const yaml = emitLibraryYaml({
    traits: [],
    skills: [skill],
    spells: [],
    items: [],
    languages: [],
    techniques: [],
    styles: [],
  });
  expect(parseLibraryYaml(yaml).library.skills[0]?.procedures).toEqual(procedures);
  expect(
    librarySkillCreate.parse({ name: 'Legacy', attribute: 'DX', difficulty: 'A' }).procedures,
  ).toBeUndefined();
});
it('caps accumulated penalties deterministically after stacking', () => {
  const rules = [
    rule({ kind: 'fixed', value: -4 }, { id: 'a', group: 'penalties', groupCap: { minimum: -5 } }),
    rule({ kind: 'fixed', value: -4 }, { id: 'b', group: 'penalties', groupCap: { minimum: -5 } }),
  ];
  for (const ordered of [rules, [...rules].reverse()])
    expect(
      evaluateModifiers(ordered, {})
        .filter((e) => e.applied)
        .reduce((sum, e) => sum + (e.value ?? 0), 0),
    ).toBe(-5);
});

it('matches bounded outcomes using the actual margin and retains prose-only declarations', () => {
  const action = skillAction.parse({
    id: 'heal',
    label: 'Healing',
    outcomes: [
      {
        on: 'success',
        minimumMargin: 2,
        maximumMargin: 5,
        kind: 'healing',
        text: 'Recover HP',
        amount: {
          kind: 'input',
          input: { domain: 'task', key: 'margin', label: 'Margin' },
          factor: 2,
        },
      },
      { on: 'failure', kind: 'note', text: 'Try again later' },
      { on: 'critical_success', kind: 'note', text: 'Special result' },
    ],
  });
  expect(
    evaluateActionOutcomes(
      action,
      { success: true, crit: null, margin: 3 },
      { 'task:margin': 99 },
    )[0]?.resolvedAmount,
  ).toBe(6);
  expect(evaluateActionOutcomes(action, { success: true, crit: null, margin: 6 }, {})).toEqual([]);
  expect(
    evaluateActionOutcomes(action, { success: true, crit: 'success', margin: 3 }, {}),
  ).toHaveLength(2);
  expect(
    evaluateActionOutcomes(action, { success: false, crit: null, margin: -2 }, {})[0]?.text,
  ).toBe('Try again later');
  expect(
    skillAction.safeParse({
      ...action,
      outcomes: [
        { on: 'success', kind: 'note', text: 'Invalid', minimumMargin: 5, maximumMargin: 2 },
      ],
    }).success,
  ).toBe(false);
});
it('preserves modern actions and benefits when legacy modifiers are edited', () => {
  const procedures = skillProcedures.parse({
    actions: [{ id: 'action', label: 'Action' }],
    benefits: [{ id: 'benefit', label: 'Benefit', when: { minimumPoints: 1 } }],
  });
  const migrated = withLegacyModifiers(procedures, [
    { name: 'Tools', modifier: -2, description: 'Improvised' },
  ]);
  expect(migrated.actions).toEqual(procedures.actions);
  expect(migrated.benefits).toEqual(procedures.benefits);
  expect(evaluateModifiers(migrated.modifiers, {})[0]?.applied).toBe(false);
  expect(evaluateModifiers(migrated.modifiers, { 'task:legacy-1': true })[0]?.value).toBe(-2);
});
it('does not request irrelevant context after a condition is known false', () => {
  const r = rule(
    { kind: 'fixed', value: -1 },
    {
      when: [
        { input: { domain: 'task', key: 'one', label: 'One' }, operator: 'equals', value: true },
        { input: { domain: 'task', key: 'two', label: 'Two' }, operator: 'equals', value: true },
      ],
    },
  );
  expect(evaluateModifiers([r], { 'task:one': false })[0]).toMatchObject({
    applied: false,
    needed: [],
    reason: 'Condition not met',
  });
});
