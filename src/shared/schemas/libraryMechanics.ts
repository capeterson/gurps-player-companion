import { z } from 'zod';
import { revision, uuid } from './common.ts';
import { traitEffect } from './effects.ts';

/** Read-only owned declarations. Null effects mean unresolved; detached copies retain provenance. */
export const libraryMechanics = z.object({
  sourceId: uuid,
  campaignId: uuid.nullable(),
  sourceRevision: revision.nullable(),
  effects: z.array(traitEffect).nullable(),
  detached: z.boolean().optional(),
});
export type LibraryMechanics = z.infer<typeof libraryMechanics>;

export function ownedLibraryEffects(
  sourceId: string | null,
  campaignId: string | null,
  snapshot: unknown,
): z.infer<typeof traitEffect>[] | null {
  const parsed = libraryMechanics.safeParse(snapshot);
  if (!sourceId) return parsed.success && parsed.data.detached ? parsed.data.effects : [];
  if (!parsed.success || parsed.data.sourceId !== sourceId || parsed.data.campaignId !== campaignId)
    return null;
  return parsed.data.effects;
}
