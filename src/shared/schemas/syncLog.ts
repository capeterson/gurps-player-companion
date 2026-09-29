import { z } from 'zod';

/** Device-local diagnostic snapshots; values deliberately have arbitrary shapes. */
export const syncLogPayload = z.object({
  previousValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  details: z.unknown().optional(),
  request: z.unknown().optional(),
});

/** Enough metadata to group the journal without reading/decompressing its bodies. */
export const syncLogPayloadMetadata = z.object({
  hasValueSnapshot: z.boolean(),
  newRevision: z.number().optional(),
  revision: z.number().optional(),
  appliedFields: z.array(z.string()).optional(),
  hasRequest: z.boolean().optional(),
  previousNumber: z.number().finite().optional(),
  newNumber: z.number().finite().optional(),
});

export type SyncLogPayload = z.infer<typeof syncLogPayload>;
export type SyncLogPayloadMetadata = z.infer<typeof syncLogPayloadMetadata>;
