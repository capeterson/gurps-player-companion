import { z } from '@hono/zod-openapi';
import { uuid } from './common.ts';

export const calculationKey = z.string().trim().min(1).max(160);
export const calculationValue = z
  .union([z.number().finite(), z.string().max(160), z.boolean()])
  .openapi('CalculationValue');
export const calculationInputs = z.record(calculationKey, calculationValue);
export const ruleReference = z
  .object({
    section: z.enum(['traits', 'items', 'modifiers']),
    key: calculationKey,
    sourceId: uuid.nullable().default(null),
    kind: z.string().max(40).optional(),
  })
  .strict()
  .openapi('LibraryRuleReference');
const unit = z.enum([
  'level',
  'dice',
  'count',
  'divisor',
  'percentage',
  'points',
  'currency',
  'pounds',
]);
const inputBase = { key: calculationKey, label: z.string().min(1).max(160) };
export const calculationInput = z
  .discriminatedUnion('kind', [
    z
      .object({
        ...inputBase,
        kind: z.literal('number'),
        unit,
        min: z.number().finite(),
        max: z.number().finite(),
        step: z.number().positive().finite(),
        default: z.number().finite().optional(),
      })
      .strict(),
    z
      .object({
        ...inputBase,
        kind: z.literal('choice'),
        options: z
          .array(z.object({ label: z.string().min(1).max(160), value: calculationValue }).strict())
          .min(1)
          .max(500),
        default: calculationValue.optional(),
      })
      .strict(),
    z
      .object({ ...inputBase, kind: z.literal('boolean'), default: z.boolean().optional() })
      .strict(),
  ])
  .openapi('CalculationInput');
const nodeBase = { id: calculationKey };
/** A flat, named expression graph keeps the public schema non-recursive and bounded. */
export const calculationNode = z
  .discriminatedUnion('op', [
    z.object({ ...nodeBase, op: z.literal('constant'), value: calculationValue }).strict(),
    z.object({ ...nodeBase, op: z.literal('input'), key: calculationKey }).strict(),
    z
      .object({
        ...nodeBase,
        op: z.enum(['add', 'multiply', 'min', 'max']),
        args: z.array(calculationKey).min(1).max(50),
      })
      .strict(),
    z
      .object({
        ...nodeBase,
        op: z.enum(['subtract', 'divide', 'eq', 'lt', 'lte']),
        left: calculationKey,
        right: calculationKey,
      })
      .strict(),
    z
      .object({ ...nodeBase, op: z.enum(['abs', 'ceil', 'floor', 'round']), arg: calculationKey })
      .strict(),
    z
      .object({
        ...nodeBase,
        op: z.literal('if'),
        condition: calculationKey,
        // biome-ignore lint/suspicious/noThenProperty: declarative node ID, never a callable thenable.
        then: calculationKey,
        else: calculationKey,
      })
      .strict(),
    z
      .object({ ...nodeBase, op: z.literal('lookup'), table: calculationKey, key: calculationKey })
      .strict(),
    z
      .object({
        ...nodeBase,
        op: z.literal('call'),
        reference: ruleReference,
        output: calculationKey,
        arguments: z.record(calculationKey, calculationKey),
      })
      .strict(),
  ])
  .openapi('CalculationNode');
export const calculationDefinition = z
  .object({
    version: z.literal(1),
    inputs: z.array(calculationInput).max(50),
    tables: z
      .array(
        z
          .object({
            key: calculationKey,
            rows: z
              .array(z.object({ key: calculationValue, value: z.number().finite() }).strict())
              .min(1)
              .max(500),
          })
          .strict(),
      )
      .max(20),
    nodes: z.array(calculationNode).min(1).max(500),
    outputs: z
      .array(
        z
          .object({
            key: calculationKey,
            unit: z.enum(['points', 'percentage', 'currency', 'pounds']),
            node: calculationKey,
            rounding: z.enum(['ceil', 'floor', 'nearest', 'exact']),
            increment: z.number().positive().finite(),
            min: z.number().finite(),
            max: z.number().finite(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict()
  .openapi('CalculationDefinitionV1');
export type CalculationDefinitionV1 = z.infer<typeof calculationDefinition>;
export type CalculationNode = z.infer<typeof calculationNode>;
export type CalculationInputs = z.infer<typeof calculationInputs>;
export type RuleReference = z.infer<typeof ruleReference>;
export const pricingResolution = z
  .object({
    reference: ruleReference,
    definitionId: z.string().uuid(),
    localModifier: calculationKey.optional(),
    revision: z.number().int().min(0).nullable(),
    inputs: calculationInputs,
    outputs: z.record(calculationKey, z.number().finite()),
    definition: calculationDefinition,
    dependencies: z
      .array(
        z
          .object({
            reference: ruleReference,
            definition: calculationDefinition,
            revision: z.number().int().min(0).nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .openapi('PricingResolution');
export type PricingResolution = z.infer<typeof pricingResolution>;
