import { z } from '@hono/zod-openapi';
import { SKILL_ATTRIBUTES } from '../constants/skills.ts';

const skillAttributeEnum = z.enum(SKILL_ATTRIBUTES);

/** A library definition's relationship to Tech Level. Character skills always
 * store the resolved concrete TL in `techLevel`; this policy belongs to the
 * reusable definition and is snapshotted when learned. */
export const skillTechLevelPolicy = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('not_applicable') }).strict(),
    z
      .object({
        kind: z.literal('required'),
        suggestedFrom: z.enum(['campaign', 'character', 'none']).default('campaign'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('fixed'),
        techLevel: z.number().int().min(0).max(12),
      })
      .strict(),
  ])
  .openapi('SkillTechLevelPolicy');
export type SkillTechLevelPolicy = z.infer<typeof skillTechLevelPolicy>;

export const prerequisiteSpecialization = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('exact'),
        value: z.string().trim().min(1).max(160),
      })
      .strict(),
    z.object({ kind: z.literal('same') }).strict(),
    z.object({ kind: z.literal('any') }).strict(),
  ])
  .openapi('SkillPrerequisiteSpecialization');

export type SkillPrerequisite =
  | { kind: 'all'; children: SkillPrerequisite[] }
  | { kind: 'any'; children: SkillPrerequisite[] }
  | {
      kind: 'skill';
      name: string;
      specialization?: z.infer<typeof prerequisiteSpecialization> | undefined;
      minimumLevel?: number | undefined;
      minimumRelativeLevel?: number | undefined;
      minimumPoints?: number | undefined;
    }
  | { kind: 'trait'; name: string; minimumLevel?: number | undefined }
  | {
      kind: 'attribute';
      attribute: z.infer<typeof skillAttributeEnum>;
      minimum: number;
    }
  | {
      kind: 'tech_level';
      minimum?: number | undefined;
      maximum?: number | undefined;
    }
  | {
      kind: 'campaign_rule';
      ruleKey: string;
      expectedValue?: boolean | string | number | undefined;
    }
  | { kind: 'gm_permission'; label: string };

const prerequisiteLeaf = z.union([
  z
    .object({
      kind: z.literal('skill'),
      name: z.string().trim().min(1).max(160),
      specialization: prerequisiteSpecialization.optional(),
      minimumLevel: z.number().int().min(-100).max(100).optional(),
      minimumRelativeLevel: z.number().int().min(-50).max(50).optional(),
      minimumPoints: z.number().int().min(0).max(1000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('trait'),
      name: z.string().trim().min(1).max(160),
      minimumLevel: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('attribute'),
      attribute: skillAttributeEnum,
      minimum: z.number().int().min(0).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tech_level'),
      minimum: z.number().int().min(0).max(12).optional(),
      maximum: z.number().int().min(0).max(12).optional(),
    })
    .strict()
    .refine((value) => value.minimum !== undefined || value.maximum !== undefined, {
      message: 'a tech-level prerequisite needs a minimum or maximum',
    })
    .refine(
      (value) =>
        value.minimum === undefined ||
        value.maximum === undefined ||
        value.minimum <= value.maximum,
      { message: 'minimum Tech Level cannot exceed maximum Tech Level' },
    ),
  z
    .object({
      kind: z.literal('campaign_rule'),
      ruleKey: z.string().trim().min(1).max(120),
      expectedValue: z.union([z.boolean(), z.string().max(200), z.number()]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('gm_permission'),
      label: z.string().trim().min(1).max(200),
    })
    .strict(),
]);

/** Recursive runtime validation; OpenAPI uses a named object reference because
 * recursive JSON Schema is not portable across all delegated clients. */
export const skillPrerequisite: z.ZodType<SkillPrerequisite> = z
  .lazy(() =>
    z.union([
      prerequisiteLeaf,
      z
        .object({ kind: z.literal('all'), children: z.array(skillPrerequisite).min(1).max(50) })
        .strict(),
      z
        .object({ kind: z.literal('any'), children: z.array(skillPrerequisite).min(1).max(50) })
        .strict(),
    ]),
  )
  .openapi('SkillPrerequisite', {
    type: 'object',
    oneOf: [
      ...(['all', 'any'] as const).map((kind) => ({
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          kind: { type: 'string' as const, enum: [kind] },
          children: {
            type: 'array' as const,
            minItems: 1,
            maxItems: 50,
            items: { $ref: '#/components/schemas/SkillPrerequisite' },
          },
        },
        required: ['kind', 'children'],
      })),
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['skill'] },
          name: { type: 'string', minLength: 1, maxLength: 160 },
          specialization: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', enum: ['exact'] },
                  value: { type: 'string', minLength: 1, maxLength: 160 },
                },
                required: ['kind', 'value'],
              },
              ...(['same', 'any'] as const).map((kind) => ({
                type: 'object' as const,
                additionalProperties: false,
                properties: { kind: { type: 'string' as const, enum: [kind] } },
                required: ['kind'],
              })),
            ],
          },
          minimumLevel: { type: 'integer', minimum: -100, maximum: 100 },
          minimumRelativeLevel: { type: 'integer', minimum: -50, maximum: 50 },
          minimumPoints: { type: 'integer', minimum: 0, maximum: 1000 },
        },
        required: ['kind', 'name'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['trait'] },
          name: { type: 'string', minLength: 1, maxLength: 160 },
          minimumLevel: { type: 'integer', minimum: 0, maximum: 100 },
        },
        required: ['kind', 'name'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['attribute'] },
          attribute: { type: 'string', enum: [...SKILL_ATTRIBUTES] },
          minimum: { type: 'integer', minimum: 0, maximum: 100 },
        },
        required: ['kind', 'attribute', 'minimum'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['tech_level'] },
          minimum: { type: 'integer', minimum: 0, maximum: 12 },
          maximum: { type: 'integer', minimum: 0, maximum: 12 },
        },
        required: ['kind'],
        anyOf: [{ required: ['minimum'] }, { required: ['maximum'] }],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['campaign_rule'] },
          ruleKey: { type: 'string', minLength: 1, maxLength: 120 },
          expectedValue: {
            oneOf: [{ type: 'boolean' }, { type: 'string', maxLength: 200 }, { type: 'number' }],
          },
        },
        required: ['kind', 'ruleKey'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['gm_permission'] },
          label: { type: 'string', minLength: 1, maxLength: 200 },
        },
        required: ['kind', 'label'],
      },
    ],
  });
export const skillPrerequisites = z
  .union([skillPrerequisite, z.null()])
  .openapi({
    oneOf: [{ $ref: '#/components/schemas/SkillPrerequisite' }, { enum: [null] }],
  })
  .openapi('NullableSkillPrerequisite');

/** Conditions are three-valued: unknown inputs make a candidate explainable,
 * but never eligible for automatic level calculation. */
export const skillDefaultCondition = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('task'),
        task: z.string().trim().min(1).max(200),
      })
      .strict(),
    z
      .object({
        kind: z.literal('campaign_rule'),
        rule: z.string().trim().min(1).max(120),
        value: z.union([z.boolean(), z.string().max(200), z.number()]),
      })
      .strict(),
    z
      .object({
        kind: z.literal('same_specialization_dimension'),
        dimension: z.string().trim().min(1).max(80),
      })
      .strict(),
    z
      .object({
        kind: z.literal('character_fact'),
        fact: z.string().trim().min(1).max(200),
      })
      .strict(),
  ])
  .openapi('SkillDefaultCondition');
export type SkillDefaultCondition = z.infer<typeof skillDefaultCondition>;

/** How a skill default selects a specialization of its source skill. */
export const skillDefaultSpecialization = z
  .union([
    z.string().trim().min(1).max(160),
    z
      .object({
        kind: z.literal('exact'),
        value: z.string().trim().min(1).max(160),
      })
      .strict(),
    z.object({ kind: z.literal('same') }).strict(),
    z.object({ kind: z.literal('any') }).strict(),
  ])
  .openapi('SkillDefaultSpecialization');

/** Null/absent = legacy unknown; [] = explicitly no defaults. */
export const skillDefault = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('attribute'),
        attribute: skillAttributeEnum,
        modifier: z.number().int().min(-50).max(0),
        conditions: z.array(skillDefaultCondition).max(10).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('skill'),
        name: z.string().trim().min(1).max(160),
        specialization: skillDefaultSpecialization.optional(),
        modifier: z.number().int().min(-50).max(0),
        conditions: z.array(skillDefaultCondition).max(10).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('skill_group'),
        group: z.string().trim().min(1).max(160),
        modifier: z.number().int().min(-50).max(0),
        specialization: skillDefaultSpecialization.optional(),
        conditions: z.array(skillDefaultCondition).max(10).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('skill_tag'),
        tag: z.string().trim().min(1).max(40),
        modifier: z.number().int().min(-50).max(0),
        specialization: skillDefaultSpecialization.optional(),
        conditions: z.array(skillDefaultCondition).max(10).optional(),
      })
      .strict(),
  ])
  .openapi('SkillDefault');
export const skillDefaults = z.array(skillDefault).max(20).nullable().openapi('SkillDefaults');
export type SkillDefaults = z.infer<typeof skillDefaults>;
