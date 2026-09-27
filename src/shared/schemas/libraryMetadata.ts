import { z } from '@hono/zod-openapi';
import { calculationDefinition, calculationKey, ruleReference } from './calculation.ts';
import { timestamps, uuid } from './common.ts';

export const extractionRecord = z
  .object({
    rawText: z.string().max(20000).optional(),
    reviewNotes: z.string().max(20000).optional(),
    locator: z.string().max(240).optional(),
  })
  .strict()
  .openapi('LibraryExtractionRecord');
/** Optional at the compatibility boundary; persistence supplies explicit defaults. */
export const libraryMetadataShape = {
  key: calculationKey.optional(),
  sourceKey: calculationKey.nullable().optional(),
  sourceLocator: z.string().max(240).nullable().optional(),
  status: z.enum(['complete', 'needs_review', 'reference_only']).optional(),
  role: z.enum(['definition', 'template', 'example', 'reference']).optional(),
  preferredEdition: z.boolean().optional(),
  extraction: extractionRecord.nullable().optional(),
};
export const libraryMetadata = z.object(libraryMetadataShape).openapi('LibraryMetadata');
export type LibraryMetadata = z.infer<typeof libraryMetadata>;
export const librarySourceCreate = z
  .object({
    name: z.string().trim().min(1).max(160).describe('Publication title'),
    key: calculationKey,
    abbreviation: z.string().trim().min(1).max(40),
    edition: z.string().max(160).nullable().optional(),
    priority: z.number().int().min(0).max(100000).default(100),
    notes: z.string().max(20000).nullable().optional(),
  })
  .strict()
  .openapi('LibrarySourceCreate');
export const librarySourceUpdate = librarySourceCreate.partial().openapi('LibrarySourceUpdate');
export const librarySourceOut = z
  .object({
    ...librarySourceCreate.shape,
    id: uuid,
    campaignId: uuid,
    revision: z.number().int(),
    ...timestamps,
  })
  .openapi('LibrarySourceOut');
export const modifierApplicability = z
  .object({
    universal: z.boolean().default(false),
    traitKinds: z
      .array(
        z.enum(['advantage', 'disadvantage', 'perk', 'quirk', 'language', 'cultural_familiarity']),
      )
      .max(6)
      .default([]),
    traitTags: z.array(z.string().min(1).max(40)).max(100).default([]),
    traits: z.array(ruleReference).max(100).default([]),
    advisory: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .openapi('ModifierApplicability');
export const libraryModifierCreate = z
  .object({
    ...libraryMetadataShape,
    name: z.string().trim().min(1).max(160),
    category: z.enum(['enhancement', 'limitation']),
    description: z.string().max(20000).nullable().optional(),
    source: z.string().max(40).nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).max(100).default([]),
    group: z.string().max(80).nullable().optional(),
    costType: z.enum(['percent', 'flat']).default('percent'),
    calculation: calculationDefinition.nullable().optional(),
    applicability: modifierApplicability,
  })
  .strict()
  .openapi('LibraryModifierCreate');
export const libraryModifierUpdate = libraryModifierCreate
  .partial()
  .openapi('LibraryModifierUpdate');
export const libraryModifierOut = z
  .object({
    ...libraryModifierCreate.shape,
    id: uuid,
    campaignId: uuid,
    revision: z.number().int(),
    ...timestamps,
  })
  .openapi('LibraryModifierOut');
export type LibrarySourceCreate = z.infer<typeof librarySourceCreate>;
export type LibrarySourceOut = z.infer<typeof librarySourceOut>;
export type LibraryModifierCreate = z.infer<typeof libraryModifierCreate>;
export type LibraryModifierOut = z.infer<typeof libraryModifierOut>;
