import { z } from '@hono/zod-openapi';
import { revision, timestamps, uuid } from './common.ts';
import { libraryTraitEffect, traitEffect } from './effects.ts';

export const capabilityEffect = z
  .object({
    kind: z.enum(['sense', 'resistance', 'capability']),
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(160),
    parameters: z
      .object({
        type: z.string().max(80).optional(),
        range: z.number().min(0).max(10000).optional(),
        notes: z.string().max(1000).optional(),
      })
      .strict()
      .optional(),
    conditionGroup: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(40)
      .optional(),
    conditionLabel: z.string().max(120).optional(),
  })
  .strict()
  .openapi('CapabilityEffect');
export const activeEffectDuration = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('indefinite') }).strict(),
    z.object({ kind: z.literal('rounds'), amount: z.number().int().min(1).max(100000) }).strict(),
    z.object({ kind: z.literal('minutes'), amount: z.number().int().min(1).max(100000) }).strict(),
    z.object({ kind: z.literal('hours'), amount: z.number().int().min(1).max(100000) }).strict(),
  ])
  .openapi('ActiveEffectDuration');
export const activeEffectStacking = z
  .object({
    kind: z.enum(['additive', 'highest', 'replace']),
    key: z.string().trim().min(1).max(120),
  })
  .strict()
  .openapi('ActiveEffectStacking');
export const activeEffectDefinitionCreate = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().max(20000).nullable().optional(),
    source: z.string().max(160).nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).max(100).default([]),
    effects: z.array(libraryTraitEffect).max(30).default([]),
    capabilities: z.array(capabilityEffect).max(30).default([]),
    duration: activeEffectDuration.default({ kind: 'indefinite' }),
    stacking: activeEffectStacking,
  })
  .strict()
  .openapi('ActiveEffectDefinitionCreate');
export const activeEffectDefinitionUpdate = z
  .object({ ...activeEffectDefinitionCreate.shape })
  .partial()
  .openapi('ActiveEffectDefinitionUpdate');
export const activeEffectDefinitionOut = z
  .object({
    ...activeEffectDefinitionCreate.shape,
    id: uuid,
    campaignId: uuid,
    revision,
    ...timestamps,
  })
  .openapi('ActiveEffectDefinitionOut');
export const activeEffectInstance = z
  .object({
    id: uuid,
    definitionId: uuid.nullable(),
    sourceRevision: revision.nullable(),
    sourceCampaignId: uuid.nullable(),
    name: z.string().min(1).max(160),
    description: z.string().max(20000).nullable(),
    source: z.string().max(160).nullable(),
    tags: z.array(z.string().min(1).max(40)).max(100),
    effects: z.array(traitEffect).max(30),
    capabilities: z.array(capabilityEffect).max(30),
    stacking: activeEffectStacking,
    state: z.enum(['active', 'inactive', 'expired']),
    appliedAt: z.string().datetime(),
    duration: activeEffectDuration,
    remainingRounds: z.number().int().min(0).max(100000).nullable(),
    expiresAt: z.string().datetime().nullable(),
    sourceInventoryId: uuid.nullable(),
    notes: z.string().max(4000).nullable(),
  })
  .strict()
  .openapi('ActiveEffectInstance');
export const activeEffectsField = z
  .array(activeEffectInstance)
  .max(100)
  .refine(
    (entries) => new Set(entries.map((e) => e.id)).size === entries.length,
    'Active effect IDs must be unique',
  )
  .openapi('ActiveEffectsField');
export type ActiveEffectDefinition = z.infer<typeof activeEffectDefinitionCreate>;
export type ActiveEffectDefinitionOut = z.infer<typeof activeEffectDefinitionOut>;
export type ActiveEffectInstance = z.infer<typeof activeEffectInstance>;
