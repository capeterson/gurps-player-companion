import { z } from '@hono/zod-openapi';
import { SKILL_ATTRIBUTES } from '../constants/skills.ts';
import { libraryTraitEffect } from './effects.ts';

const key = z.string().trim().min(1).max(120);
const number = z.number().finite().min(-10000).max(10000);
const bounds = z
  .object({ minimum: number.optional(), maximum: number.optional() })
  .strict()
  .refine(
    (v) => v.minimum === undefined || v.maximum === undefined || v.minimum <= v.maximum,
    'Minimum exceeds maximum',
  );
export const ruleInput = z
  .object({
    domain: z.enum([
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
    ]),
    key,
    label: z.string().min(1).max(200),
  })
  .strict()
  .openapi('RuleInput');
export const rulePredicate = z
  .object({
    input: ruleInput,
    operator: z.enum(['equals', 'not_equals', 'at_least', 'at_most']),
    value: z.union([number, z.boolean(), z.string().max(200)]),
  })
  .strict()
  .openapi('RulePredicate');
export const numericExpression = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('constant'), value: number }).strict(),
    z
      .object({
        kind: z.literal('input'),
        input: ruleInput,
        factor: number.default(1),
        offset: number.default(0),
      })
      .strict(),
  ])
  .openapi('NumericExpression');
export const modifierValue = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('fixed'), value: number }).strict(),
    z.object({ kind: z.literal('range'), minimum: number, maximum: number }).strict(),
    z
      .object({
        kind: z.literal('per_difference'),
        left: numericExpression,
        right: numericExpression,
        factor: number,
        step: z.number().positive().max(10000).default(1),
        rounding: z.enum(['floor', 'ceil', 'truncate']).default('floor'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('table'),
        input: ruleInput,
        rows: z
          .array(z.object({ minimum: number, maximum: number, value: number }).strict())
          .min(1)
          .max(50),
      })
      .strict(),
    z.object({ kind: z.literal('reference'), ruleKey: key }).strict(),
  ])
  .superRefine((v, ctx) => {
    if (v.kind === 'range' && v.minimum > v.maximum)
      ctx.addIssue({ code: 'custom', message: 'Minimum exceeds maximum' });
    if (v.kind === 'table') {
      const rows = [...v.rows].sort((a, b) => a.minimum - b.minimum);
      if (
        rows.some(
          (r, i) =>
            r.minimum > r.maximum ||
            (i > 0 && r.minimum <= (rows[i - 1]?.maximum ?? Number.NEGATIVE_INFINITY)),
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Table intervals must be ordered bounds without overlap',
        });
    }
  })
  .openapi('ModifierValue');
export const skillModifierRule = z
  .object({
    id: key,
    label: z.string().min(1).max(200),
    when: z.array(rulePredicate).max(20).default([]),
    value: modifierValue,
    appliesTo: z.enum(['base_level', 'task_roll', 'contest', 'damage', 'time']),
    stacking: z.enum(['stack', 'highest', 'lowest', 'exclusive_group']).default('stack'),
    group: key.optional(),
    cap: bounds.optional(),
    groupCap: bounds.optional(),
    sourceText: z.string().max(4000).optional(),
  })
  .strict()
  .refine(
    (v) => (v.stacking === 'stack' && !v.groupCap) || !!v.group,
    'A stacking group is required',
  )
  .openapi('SkillModifierRule');
export const actionRoll = z
  .object({
    basis: z.enum(['skill', 'attribute', 'other_skill', 'prose_only']),
    attribute: z.enum(SKILL_ATTRIBUTES).optional(),
    skillName: key.optional(),
    modifier: number.default(0),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.basis !== 'attribute' || !!v.attribute) && (v.basis !== 'other_skill' || !!v.skillName),
    'Roll basis needs an attribute or skill',
  )
  .openapi('ActionRoll');
export const skillAction = z
  .object({
    id: key,
    label: z.string().min(1).max(200),
    roll: actionRoll.optional(),
    time: z
      .object({ amount: numericExpression, unit: z.enum(['seconds', 'minutes', 'hours', 'days']) })
      .strict()
      .optional(),
    costs: z
      .array(
        z
          .object({
            resource: z.enum(['hp', 'fp', 'quantity']),
            amount: numericExpression,
            label: key.optional(),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    contest: z
      .object({ kind: z.enum(['quick', 'regular']), opponent: key })
      .strict()
      .optional(),
    outcomes: z
      .array(
        z
          .object({
            on: z.enum(['success', 'failure', 'critical_success', 'critical_failure']),
            minimumMargin: number.optional(),
            maximumMargin: number.optional(),
            kind: z.enum(['healing', 'recovery', 'damage', 'distance', 'time', 'note']),
            amount: numericExpression.optional(),
            text: z.string().min(1).max(2000),
          })
          .strict()
          .refine(
            (v) =>
              v.minimumMargin === undefined ||
              v.maximumMargin === undefined ||
              v.minimumMargin <= v.maximumMargin,
            'Minimum margin exceeds maximum',
          ),
      )
      .max(20)
      .default([]),
    sourceText: z.string().max(4000).optional(),
  })
  .strict()
  .openapi('SkillAction');
export const relativeLevelBenefit = z
  .object({
    id: key,
    label: z.string().min(1).max(200),
    when: z
      .object({
        minimumRelativeLevel: number.optional(),
        minimumAbsoluteLevel: number.optional(),
        minimumPoints: z.number().int().min(0).max(1000).optional(),
        specialization: key.optional(),
      })
      .strict(),
    effects: z.array(libraryTraitEffect).max(30).default([]),
    sourceText: z.string().max(4000).optional(),
  })
  .strict()
  .openapi('RelativeLevelBenefit');
export const skillProcedures = z
  .object({
    modifiers: z.array(skillModifierRule).max(100).default([]),
    actions: z.array(skillAction).max(50).default([]),
    benefits: z.array(relativeLevelBenefit).max(50).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const field of ['modifiers', 'actions', 'benefits'] as const) {
      if (new Set(v[field].map((x) => x.id)).size !== v[field].length)
        ctx.addIssue({ code: 'custom', path: [field], message: 'IDs must be unique' });
    }
  })
  .openapi('SkillProcedures');
export type RuleInput = z.infer<typeof ruleInput>;
export type NumericExpression = z.infer<typeof numericExpression>;
export type SkillModifierRule = z.infer<typeof skillModifierRule>;
export type SkillAction = z.infer<typeof skillAction>;
export type RelativeLevelBenefit = z.infer<typeof relativeLevelBenefit>;
export type SkillProcedures = z.infer<typeof skillProcedures>;
